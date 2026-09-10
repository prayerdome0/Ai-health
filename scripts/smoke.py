#!/usr/bin/env python3
"""End-to-end self-test for LocalMind using the mock Ollama backend.

Runs everything the real stack runs — hardware detection, settings, model
bootstrap, hybrid store + embeddings, ingestion, grounded RAG with
citations, the ReAct agent loop with tools, memory, and the
OpenAI-compatible endpoint (streaming + non-streaming) — with no model
downloads and no GPU.

Usage:  python scripts/smoke.py
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

HOST = "http://127.0.0.1:11434"
PASS = 0


def ok(name: str, cond: bool, extra: str = "") -> None:
    global PASS
    if cond:
        PASS += 1
        print(f"  ✔ {name}")
    else:
        print(f"  ✘ FAIL: {name} {extra}")
        sys.exit(1)


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # pydantic v2 resolves type refs via sys.modules
    spec.loader.exec_module(mod)
    return mod


def wait_ollama(timeout: float = 20.0) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            urllib.request.urlopen(HOST + "/api/tags", timeout=1).read()
            return
        except Exception:
            time.sleep(0.25)
    sys.exit("mock Ollama did not start")


def main() -> None:
    print("[1/7] starting mock Ollama…")
    mock = subprocess.Popen([sys.executable, str(ROOT / "scripts" / "mock_ollama.py")],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_ollama()

        print("[2/7] hardware detection + settings")
        from core.config import Settings, report, detect_backend, ollama_up
        ok("backend detected as ollama", detect_backend() == "ollama")
        ok("ollama reachable", ollama_up())
        S = Settings.load()
        ok("settings load + auto model", bool(S.model and S.n_ctx > 0), S.model)
        ok("doctor report renders", "Recommended" in report())

        print("[3/7] chat (streaming)")
        from core.llm import get_llm
        llm = get_llm(S)
        reply = "".join(llm.stream([{"role": "system", "content": S.system_prompt},
                                    {"role": "user", "content": "hello there"}]))
        ok("chat streams a reply", "[mock]" in reply and "hello there" in reply, reply[:80])

        print("[4/7] hybrid store + ingestion + grounded RAG")
        from core.store import HybridStore
        store = HybridStore("smoke_kb", S)
        store.clear()
        from core.ingest import ingest_text
        n = ingest_text(
            "Deployment rollback procedure: run `rollback --stage prod` to revert "
            "the last release. Wait for health checks to pass before re-enabling traffic.\n\n"
            "Unrelated note: the canteen menu changes daily and includes pasta on Fridays.",
            "ops_handbook.txt", store, S)
        ok("chunks ingested", n >= 1, str(n))
        from core.rag import rag_stream
        ans = "".join(rag_stream("How do we roll back a bad deployment?", llm, store, S))
        ok("RAG answers with citation", "[1]" in ans and "rollback" in ans.lower() and "ops_handbook" in ans, ans[:120])
        ok("RAG lists sources", "**Sources**" in ans)
        store.clear()

        print("[5/7] ReAct agent + tools + memory")
        from core.tools import Toolbox
        from core.memory import Memory
        from core.agent import Agent
        mem = Memory(llm, S)
        tools = Toolbox(S, store=store, memory=mem)
        events: list[tuple[str, str]] = []
        out = Agent(llm, tools, S, mem).run(
            "Compute six times seven.", on_event=lambda k, t: events.append((k, t)))
        ok("agent called a tool", any(k == "action" for k, _ in events), str(events))
        ok("agent returned computed value", "42" in out, out)
        ok("toolbox calc works directly", tools.call("calc", {"expression": "6*7"}) == "42")
        ok("workspace jail blocks escape",
            "escapes" in tools.call("read_file", {"path": "../secret.txt"}))
        mem.remember("The user prefers concise answers with code examples.")
        ok("long-term memory recall", any("concise" in f for f in mem.recall("user preferences")))

        print("[6/7] OpenAI-compatible endpoint")
        api = load_module("openai_api", ROOT / "server" / "openai_api.py")
        req = api.Req(model=None, stream=False, messages=[api.Msg(role="user", content="ping")])
        body = api.chat(req)
        ok("non-stream completion", body["object"] == "chat.completion"
           and "[mock]" in body["choices"][0]["message"]["content"])
        req2 = api.Req(model=None, stream=True, messages=[api.Msg(role="user", content="ping")])
        resp = api.chat(req2)

        import asyncio

        async def collect(agen):
            return [c async for c in agen]

        chunks = asyncio.run(collect(resp.body_iterator))
        ok("streaming SSE ends with [DONE]", chunks and chunks[-1].strip() == "data: [DONE]")
        ok("streaming SSE carries delta", any('"delta"' in c for c in chunks))

        print("[7/7] CLI entrypoint")
        r = subprocess.run([sys.executable, str(ROOT / "main.py"), "doctor"],
                           capture_output=True, text=True, timeout=60)
        ok("main.py doctor runs", r.returncode == 0 and "Recommended" in r.stdout)
        r = subprocess.run([sys.executable, str(ROOT / "main.py"), "config"],
                           capture_output=True, text=True, timeout=60)
        ok("main.py config renders JSON", r.returncode == 0 and '"model"' in r.stdout)

        print(f"\nAll {PASS} checks passed ✔  (LocalMind end-to-end, mock backend)")
    finally:
        mock.terminate()
        mock.wait(timeout=10)


if __name__ == "__main__":
    main()
