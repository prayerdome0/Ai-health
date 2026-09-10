"""Unified streaming interface over Ollama / llama.cpp / Transformers."""
from __future__ import annotations

import json, sys, urllib.error, urllib.request
from typing import Iterator, Sequence

from .config import Settings

Message = dict     # {"role": "system"|"user"|"assistant", "content": str}


class LLM:
    """Base contract: stream(messages) -> Iterator[str]."""

    def stream(self, messages: Sequence[Message], **kw) -> Iterator[str]:
        raise NotImplementedError

    def chat(self, messages: Sequence[Message], **kw) -> str:
        return "".join(self.stream(messages, **kw))

    def ask(self, prompt: str, system: str | None = None, **kw) -> str:
        msgs: list[Message] = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": prompt})
        return self.chat(msgs, **kw)


# --------------------------------------------------------------- Ollama
class OllamaLLM(LLM):
    """Pure-stdlib client. No `ollama` pip package required."""

    def __init__(self, s: Settings):
        self.s, self.host, self.model = s, s.ollama_host.rstrip("/"), s.model

    def _post(self, path: str, payload: dict, timeout: int = 600):
        req = urllib.request.Request(
            self.host + path,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        return urllib.request.urlopen(req, timeout=timeout)

    def stream(self, messages, **kw) -> Iterator[str]:
        payload = {
            "model": kw.get("model", self.model),
            "messages": list(messages),
            "stream": True,
            "options": {
                "temperature": kw.get("temperature", self.s.temperature),
                "top_p": kw.get("top_p", self.s.top_p),
                "num_ctx": kw.get("n_ctx", self.s.n_ctx),
                "num_predict": kw.get("max_tokens", self.s.max_tokens),
                "repeat_penalty": 1.05,
            },
        }
        if kw.get("stop"):
            payload["options"]["stop"] = kw["stop"]
        try:
            resp = self._post("/api/chat", payload)
        except urllib.error.URLError as e:
            raise RuntimeError(
                f"Cannot reach Ollama at {self.host} ({e}). "
                "Start it with `ollama serve`, or run `python main.py doctor`."
            ) from e
        with resp:
            for raw in resp:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if obj.get("error"):
                    raise RuntimeError(f"Ollama error: {obj['error']}")
                piece = (obj.get("message") or {}).get("content", "")
                if piece:
                    yield piece
                if obj.get("done"):
                    break

    def embed(self, texts: list[str], model: str) -> list[list[float]]:
        with self._post("/api/embed", {"model": model, "input": texts}, timeout=300) as r:
            return json.loads(r.read())["embeddings"]

    def ensure_model(self) -> None:
        from .config import ollama_models
        have = ollama_models(self.host)
        if self.model in have:
            return
        base = self.model.split(":")[0]
        if any(m.split(":")[0] == base for m in have):
            self.model = next(m for m in have if m.split(":")[0] == base)
            return
        print(f"→ pulling {self.model} (one-time download)…", file=sys.stderr)
        with self._post("/api/pull", {"model": self.model, "stream": True}, timeout=None) as r:
            last = ""
            for raw in r:
                try:
                    o = json.loads(raw)
                except Exception:
                    continue
                st = o.get("status", "")
                if o.get("total"):
                    pct = 100 * o.get("completed", 0) / o["total"]
                    st = f"{st} {pct:5.1f}%"
                if st != last:
                    print("\r  " + st.ljust(60), end="", file=sys.stderr, flush=True)
                    last = st
            print(file=sys.stderr)


# ------------------------------------------------------------ llama.cpp
class LlamaCppLLM(LLM):
    def __init__(self, s: Settings):
        from llama_cpp import Llama
        self.s = s
        kw = dict(n_ctx=s.n_ctx, n_gpu_layers=-1, n_threads=None,
                  flash_attn=True, verbose=False)
        if s.gguf_repo:
            self.llm = Llama.from_pretrained(repo_id=s.gguf_repo,
                                             filename=s.gguf_file, **kw)
        else:
            self.llm = Llama(model_path=s.model, **kw)

    def stream(self, messages, **kw) -> Iterator[str]:
        for ch in self.llm.create_chat_completion(
            messages=list(messages), stream=True,
            temperature=kw.get("temperature", self.s.temperature),
            top_p=kw.get("top_p", self.s.top_p),
            max_tokens=kw.get("max_tokens", self.s.max_tokens),
            stop=kw.get("stop"),
        ):
            d = ch["choices"][0].get("delta", {}).get("content")
            if d:
                yield d


# ---------------------------------------------------------- Transformers
class TransformersLLM(LLM):
    def __init__(self, s: Settings):
        import torch
        from threading import Thread  # noqa: F401  (used in stream)
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        self.s, self.torch = s, torch
        mid = s.hf_id or s.model
        quant = None
        if torch.cuda.is_available():
            try:
                import bitsandbytes  # noqa
                quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                           bnb_4bit_compute_dtype=torch.bfloat16,
                                           bnb_4bit_use_double_quant=True)
            except Exception:
                pass
        self.tok = AutoTokenizer.from_pretrained(mid)
        self.model = AutoModelForCausalLM.from_pretrained(
            mid, quantization_config=quant, device_map="auto",
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32)
        self.model.eval()

    def stream(self, messages, **kw) -> Iterator[str]:
        from threading import Thread
        from transformers import TextIteratorStreamer
        ids = self.tok.apply_chat_template(list(messages), add_generation_prompt=True,
                                           return_tensors="pt").to(self.model.device)
        streamer = TextIteratorStreamer(self.tok, skip_prompt=True, skip_special_tokens=True)
        gen = dict(input_ids=ids, streamer=streamer,
                   max_new_tokens=kw.get("max_tokens", self.s.max_tokens),
                   do_sample=True, temperature=kw.get("temperature", self.s.temperature),
                   top_p=kw.get("top_p", self.s.top_p), repetition_penalty=1.05)
        Thread(target=self.model.generate, kwargs=gen, daemon=True).start()
        stops = kw.get("stop") or []
        buf = ""
        for tok in streamer:
            buf += tok
            if any(st in buf for st in stops):
                cut = min(buf.index(st) for st in stops if st in buf)
                yield buf[len(buf) - len(tok):cut] if cut > len(buf) - len(tok) else ""
                return
            yield tok


# ------------------------------------------------------------- factory
_CACHE: dict[str, LLM] = {}


def get_llm(s: Settings | None = None, fresh: bool = False) -> LLM:
    s = s or Settings.load()
    key = f"{s.backend}:{s.model}"
    if not fresh and key in _CACHE:
        return _CACHE[key]
    if s.backend == "ollama":
        llm: LLM = OllamaLLM(s)
        llm.ensure_model()                      # type: ignore[attr-defined]
    elif s.backend == "llamacpp":
        llm = LlamaCppLLM(s)
    elif s.backend == "transformers":
        llm = TransformersLLM(s)
    else:
        raise ValueError(f"unknown backend: {s.backend}")
    _CACHE[key] = llm
    return llm
