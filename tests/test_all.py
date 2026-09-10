"""End-to-end self-test for Pulse — run with:  python main.py selftest

Checks (all on this machine, no network):
  1. word tokenizer: encoding, decoding, unknown words, determinism
  2. autodiff gradients vs finite differences (the whole GPT graph)
  3. causal masking really is causal
  4. KV-cache inference logits == batched training logits
  5. pure-python backend == numpy backend
  6. training actually learns (loss falls fast on a toy corpus)
  7. checkpoint save/load round-trip
  8. chat layer: prompt building, reply cleaning, sampling
  9. web UI server: /api/health + /api/chat
"""
from __future__ import annotations

import json
import sys
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ai.autodiff import Tensor                      # noqa: E402
from ai.chat import build_prompt, clean_reply, generate_reply  # noqa: E402
from ai.config import ModelConfig                   # noqa: E402
from ai.data import Batcher, build_tokenizer        # noqa: E402
from ai.model import GPT, init_params, save_checkpoint  # noqa: E402
from ai.tokenizer import WordTokenizer              # noqa: E402
from ai.train import forward                        # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, cond: bool, extra: str = "") -> bool:
    RESULTS.append((name, bool(cond), extra))
    print(f"  {'✔' if cond else '✘ FAIL'} {name}" + (f"  ({extra})" if extra and not cond else ""))
    return bool(cond)


# --------------------------------------------------------------- 1. tokenizer
def test_tokenizer():
    tok = WordTokenizer.from_text("hello world! don't stop.\n\nuser: hi\nai: hello")
    ids = tok.encode("hello world!")
    check("tokenizer round-trip (canonical form)",
          tok.decode(ids) == "hello world!")
    check("contractions stay one token",
          len(tok.encode("don't stop")) == 2)
    check("unknown words map to <unk> and vanish in output",
          tok.decode(tok.encode("hello zzyqxx")) == "hello")
    check("line breaks are tokens",
          tok.id_of("\n") is not None and tok.id_of("\n\n") is not None)
    check("re-encoding decoded text is stable",
          tok.encode(tok.decode(tok.encode("user: hi\nai: hello !"))) ==
          tok.encode("user: hi\nai: hello !"))
    t2 = WordTokenizer.from_dict(tok.to_dict())
    check("tokenizer save/load is identity", t2.vocab == tok.vocab)


# --------------------------------------------------- 2. gradients vs numerics
def test_gradients():
    rng = np.random.default_rng(7)
    cfg = ModelConfig(vocab_size=11, d_model=8, n_layers=2, n_heads=2, block_size=6)
    params = {k: Tensor(v.astype(np.float64)) for k, v in init_params(cfg, rng).items()}
    idx = np.random.randint(0, cfg.vocab_size, (2, cfg.block_size))
    tgt = np.random.randint(0, cfg.vocab_size, (2, cfg.block_size))

    def loss_fn() -> Tensor:
        return forward(cfg, params, Tensor(idx), Tensor(tgt))

    loss = loss_fn()
    loss.backward()
    analytic, numeric = [], []
    eps = 1e-5
    for key in ["wte", "wpe", "0.attn.wqkv", "0.attn.wo", "0.mlp.w1", "0.mlp.w2",
                "0.ln1.g", "1.ln1.b", "lnf.g", "0.attn.bqkv", "0.mlp.b2"]:
        w = params[key].value
        flat = w.reshape(-1)
        for j in rng.choice(flat.size, size=min(5, flat.size), replace=False):
            j = int(j)
            orig = flat[j]
            flat[j] = orig + eps; lp = float(loss_fn().value)
            flat[j] = orig - eps; lm = float(loss_fn().value)
            flat[j] = orig
            analytic.append(params[key].grad.reshape(-1)[j])
            numeric.append((lp - lm) / (2 * eps))
    a, n = np.array(analytic), np.array(numeric)
    err = float(np.max(np.abs(a - n) / (np.abs(a) + np.abs(n) + 1e-4)))
    check("backprop matches finite differences", err < 1e-4, f"max rel err {err:.2e}")


# -------------------------------------------------------- 3. causal masking
def test_causality():
    rng = np.random.default_rng(3)
    cfg = ModelConfig(vocab_size=9, d_model=16, n_layers=2, n_heads=2, block_size=8)
    params = {k: Tensor(v) for k, v in init_params(cfg, rng).items()}
    x1 = np.random.randint(0, 9, (1, 8))
    x2 = x1.copy(); x2[0, 5:] = (x2[0, 5:] + 1) % 9      # change only the future
    l1 = forward(cfg, params, Tensor(x1)).value
    l2 = forward(cfg, params, Tensor(x2)).value
    check("future tokens don't leak into the past",
          np.allclose(l1[0, :5], l2[0, :5], atol=1e-4) and
          not np.allclose(l1[0, 6], l2[0, 6], atol=1e-2))


# ------------------------------------- 4. KV-cache inference == batched math
def test_inference_matches_training():
    rng = np.random.default_rng(11)
    tok = WordTokenizer.from_text("user: hello world , how are you ?\nai: fine !\n\n")
    cfg = ModelConfig(vocab_size=tok.vocab_size, d_model=16, n_layers=2, n_heads=2, block_size=12)
    raw = init_params(cfg, rng)
    params = {k: Tensor(v) for k, v in raw.items()}
    ids = tok.encode("user: hello world , how are you ?")[:10]

    logits_batched = forward(cfg, params, Tensor(np.array([ids]))).value[0]
    g = GPT(cfg, raw, tok)
    ok, errs = True, 0.0
    for i, t in enumerate(ids):
        g.feed(t)
        errs = max(errs, float(np.max(np.abs(np.asarray(g.logits) - logits_batched[i]))))
        ok = ok and errs < 2e-3
    check("KV-cache forward equals batched forward", ok, f"max err {errs:.4f}")

    g.feed(ids[0])
    check("cache advances one position per token", g.pos == len(ids) + 1)


# ------------------------------------------------ 5. pure-python vs numpy
def test_pure_backend():
    rng = np.random.default_rng(5)
    tok = WordTokenizer.from_text("user: hello world , how are you ?\nai: fine !\n\n")
    cfg = ModelConfig(vocab_size=tok.vocab_size, d_model=16, n_layers=2, n_heads=2, block_size=10)
    raw = init_params(cfg, rng)
    ids = tok.encode("user: hello world , how are you ?")[:8]
    g_np = GPT(cfg, raw, tok); g_np.prime(ids)
    g_py = GPT(cfg, raw, tok, force_pure=True); g_py.prime(ids)
    err = float(np.max(np.abs(np.asarray(g_np.logits) - np.asarray(g_py.logits))))
    check("pure-python backend matches numpy", err < 1e-2, f"max err {err:.4f}")


# ------------------------------------------------------- 6. it really learns
def test_training_learns():
    text = ("user: hello\nai: hi there, how are you feeling today?\n\n"
            "user: i have a headache\nai: rest, drink some water and take a break "
            "from screens. see a doctor if it gets worse.\n\n") * 20
    tok = build_tokenizer(text)
    cfg = ModelConfig(vocab_size=tok.vocab_size, d_model=32, n_layers=2,
                      n_heads=2, block_size=48)
    params = {k: Tensor(v) for k, v in init_params(cfg, np.random.default_rng(0)).items()}
    data = Batcher(text, tok, cfg.block_size)
    from ai.autodiff import AdamW
    opt = AdamW(params, lr=3e-3, weight_decay=0.0)

    def val_loss():
        x, y = data.val_batch(8)
        with np.errstate(all="ignore"):
            return float(forward(cfg, params, Tensor(x), Tensor(y)).value)

    v0 = val_loss()
    for i in range(200):
        x, y = data.train_batch(8)
        loss = forward(cfg, params, Tensor(x), Tensor(y))
        opt.zero_grad(); loss.backward(); loss.release_graph()
        opt.clip_grad_norm(1.0); opt.step()
        del loss
    v1 = val_loss()
    check("training reduces loss (it learns)", v1 < v0 - 1.0,
          f"val {v0:.2f} -> {v1:.2f}")


# --------------------------------------------------- 7. checkpoint round-trip
def test_checkpoint(tmp: Path):
    rng = np.random.default_rng(2)
    cfg = ModelConfig(vocab_size=10, d_model=16, n_layers=1, n_heads=2, block_size=8)
    raw = init_params(cfg, rng)
    tok = WordTokenizer.from_text("user : hello world !\nai : hi there ,\n\n")
    p = tmp / "rt.npz"
    save_checkpoint(p, cfg, raw, tok, meta={"step": 42})
    from ai.model import load_checkpoint
    cfg2, tok2, raw2, meta = load_checkpoint(p)
    g1 = GPT(cfg, raw, tok); g1.prime([1, 2, 3])
    g2 = GPT(cfg2, raw2, tok2); g2.prime([1, 2, 3])
    check("checkpoint save/load is lossless (fp16)",
          np.allclose(g1.logits, g2.logits, atol=5e-2) and meta["step"] == 42)


# ------------------------------------------------------------- 8. chat layer
def test_chat_layer():
    text = ("user: hello\nai: hi there, how are you feeling today?\n\n"
            "user: i have a headache\nai: rest, drink some water and take a break "
            "from screens. see a doctor if it gets worse.\n\n") * 10
    tok = build_tokenizer(text)
    cfg = ModelConfig(vocab_size=tok.vocab_size, d_model=32, n_layers=2,
                      n_heads=2, block_size=64)
    raw = init_params(cfg, np.random.default_rng(1))
    g = GPT(cfg, raw, tok)

    prompt = build_prompt(g, [{"user": "hi", "ai": "hello!"}], "how do I sleep better?",
                          answer_room=30)
    check("prompt ends with the answer slot", prompt.endswith("ai:"))
    check("prompt is lower-cased", prompt == prompt.lower())
    check("prompt fits the token budget",
          len(tok.encode(prompt)) <= 64 - 30)

    check("clean_reply strips stop strings",
          clean_reply("drink water\nuser: what") == "drink water")
    check("clean_reply drops dangling speaker tags",
          clean_reply("rest well\nai:") == "rest well")

    reply = generate_reply(g, [], "hello", max_new=24)
    check("generate_reply returns text without speaker tags",
          isinstance(reply, str) and "user:" not in reply and "ai:" not in reply,
          repr(reply[:40]))


# -------------------------------------------------------------- 9. web server
def test_webui():
    from ai.webui import Handler, _state
    from http.server import ThreadingHTTPServer
    text = ("user: hello\nai: hi there, how are you feeling today?\n\n") * 10
    tok = build_tokenizer(text)
    cfg = ModelConfig(vocab_size=tok.vocab_size, d_model=32, n_layers=2,
                      n_heads=2, block_size=64)
    raw = init_params(cfg, np.random.default_rng(9))
    _state["model"] = GPT(cfg, raw, tok)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=10) as r:
            health = json.loads(r.read())
        check("GET /api/health", health.get("ok") is True)

        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/chat",
            data=json.dumps({"message": "hello", "history": []}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            chat = json.loads(r.read())
        check("POST /api/chat returns a reply",
              isinstance(chat.get("reply"), str) and len(chat["reply"]) > 0,
              repr(chat)[:80])

        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10) as r:
            html = r.read().decode()
        check("GET / serves the chat page", "Pulse" in html)
    finally:
        srv.shutdown()


# --------------------------------------------------------------------- runner
def run_all() -> bool:
    import shutil
    print("Pulse self-test\n" + "-" * 46)
    t0 = time.time()
    test_tokenizer()
    test_gradients()
    test_causality()
    test_inference_matches_training()
    test_pure_backend()
    test_training_learns()
    tmp = ROOT / "data" / "_selftest"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        test_checkpoint(tmp)
        test_chat_layer()
        test_webui()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in RESULTS if not r[1]]
    print("-" * 46)
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed in {time.time()-t0:.1f}s")
    if failed:
        for name, _ok, extra in failed:
            print(f"  ✘ {name} {extra}")
        return False
    return True


if __name__ == "__main__":
    sys.exit(0 if run_all() else 1)
