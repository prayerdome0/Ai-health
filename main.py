#!/usr/bin/env python3
"""LocalMind — one entrypoint for everything."""
from __future__ import annotations

import argparse, sys, textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.config import Settings, report, ollama_up, pick_tier, usable_gb

BANNER = r"""
  _                 _ __  __ _         _
 | |   ___  __ __ _| |  \/  (_)_ _  __| |
 | |__/ _ \/ _/ _` | | |\/| | | ' \/ _` |
 |____\___/\__\__,_|_|_|  |_|_|_||_\__,_|   local · private · yours
"""


# --------------------------------------------------------------- commands
def cmd_doctor(_a):
    print(BANNER)
    print(report())
    if not ollama_up():
        print(textwrap.dedent("""
            ➜ Ollama not detected. Easiest fix:
                Linux/macOS : curl -fsSL https://ollama.com/install.sh | sh && ollama serve
                Windows     : install from https://ollama.com  (starts automatically)
              Then:  python main.py pull
            Alternatively install a pip backend:
                pip install llama-cpp-python        # then set backend=llamacpp in data/config.json
        """))
    else:
        print("\n➜ Ready.  Next:  python main.py pull   then   python main.py ui")


def cmd_pull(_a):
    s = Settings.load()
    print(f"Backend={s.backend}  model={s.model}")
    from core.llm import get_llm
    get_llm(s)                     # triggers download for ollama / gguf
    print("✔ chat model ready")
    try:
        from core.store import get_embedder
        e = get_embedder(s)
        print(f"✔ embedder ready (dim={e.dim})" if e else "… no embedder → BM25-only")
    except Exception as ex:
        print(f"… embedder skipped: {ex}")
    if s.use_reranker:
        from core.store import get_reranker
        print("✔ reranker ready" if get_reranker(s.rerank_model) else "… reranker unavailable")


def _boot(with_store=True, with_mem=True):
    s = Settings.load()
    from core.llm import get_llm
    llm = get_llm(s)
    store = None
    if with_store:
        from core.store import HybridStore
        store = HybridStore("kb", s)
    mem = None
    if with_mem:
        from core.memory import Memory
        mem = Memory(llm, s, None)
    return s, llm, store, mem


def cmd_ingest(a):
    s, _llm, store, _ = _boot(with_mem=False)
    from core.ingest import ingest_path
    print(f"Indexing {a.path} …")
    r = ingest_path(a.path, store, s)
    print(f"\n✔ {r['files']} files → {r['chunks']} chunks | index total: {store.stats()}")


def cmd_ask(a):
    s, llm, store, _ = _boot(with_mem=False)
    from core.rag import rag_stream
    for piece in rag_stream(" ".join(a.question), llm, store, s):
        print(piece, end="", flush=True)
    print()


def cmd_agent(a):
    s, llm, store, mem = _boot()
    from core.tools import Toolbox
    from core.agent import Agent
    ag = Agent(llm, Toolbox(s, store, mem), s, mem)
    icons = {"thought": "\033[90m💭", "action": "\033[36m🔧",
             "observation": "\033[33m👁️ ", "final": "\033[32m✅"}

    def ev(kind, text):
        if kind == "final":
            return
        body = text if len(text) < 600 else text[:600] + " …"
        print(f"{icons[kind]} {body}\033[0m")

    print(ag.run(" ".join(a.goal), on_event=ev))


def cmd_chat(_a):
    s, llm, store, mem = _boot()
    from core.rag import rag_stream
    from core.tools import Toolbox
    from core.agent import Agent
    agent = Agent(llm, Toolbox(s, store, mem), s, mem)

    print(BANNER)
    print(f"model: {s.model}   backend: {s.backend}   ctx: {s.n_ctx}")
    print("commands: /rag <q>  /agent <goal>  /ingest <path>  /remember <fact>  "
          "/stats  /reset  /sys <prompt>  /quit\n")

    while True:
        try:
            q = input("\033[1m❯\033[0m ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); break
        if not q:
            continue
        if q in ("/quit", "/exit", "/q"):
            break
        if q == "/reset":
            mem.reset(); print("· memory cleared"); continue
        if q == "/stats":
            print(store.stats()); continue
        if q.startswith("/sys "):
            s.system_prompt = q[5:]; s.save(); print("· system prompt updated"); continue
        if q.startswith("/remember "):
            mem.remember(q[10:]); print("· remembered"); continue
        if q.startswith("/ingest "):
            from core.ingest import ingest_path
            print(ingest_path(q[8:].strip(), store, s)); continue
        if q.startswith("/agent "):
            print(agent.run(q[7:], on_event=lambda k, t: print(
                f"\033[90m[{k}] {t[:400]}\033[0m") if k != "final" else None))
            continue
        if q.startswith("/rag "):
            for p in rag_stream(q[5:], llm, store, s):
                print(p, end="", flush=True)
            print("\n"); continue

        mem.add("user", q)
        msgs = mem.messages(s.system_prompt, mem.auto_context(q))
        acc = ""
        for p in llm.stream(msgs):
            acc += p; print(p, end="", flush=True)
        print("\n")
        mem.add("assistant", acc)


def cmd_ui(_a):
    import runpy
    runpy.run_path(str(Path(__file__).parent / "ui" / "app.py"), run_name="__main__")


def cmd_serve(a):
    import uvicorn
    uvicorn.run("server.openai_api:app", host=a.host, port=a.port, reload=False)


def cmd_config(a):
    s = Settings.load()
    if a.set:
        for kv in a.set:
            k, _, v = kv.partition("=")
            if not hasattr(s, k):
                print(f"! unknown key: {k}"); continue
            cur = getattr(s, k)
            cast = type(cur)
            val = (v.lower() in ("1", "true", "yes")) if cast is bool else cast(v)
            setattr(s, k, val); print(f"{k} = {val}")
        s.save()
    else:
        import dataclasses, json
        print(json.dumps(dataclasses.asdict(s), indent=2))


# ------------------------------------------------------------------- cli
def main():
    p = argparse.ArgumentParser("localmind", description="Powerful local AI. No API keys.")
    sub = p.add_subparsers(dest="cmd")

    sub.add_parser("doctor", help="hardware report + setup advice").set_defaults(f=cmd_doctor)
    sub.add_parser("pull", help="download the chosen model + embedder").set_defaults(f=cmd_pull)
    sub.add_parser("chat", help="terminal chat").set_defaults(f=cmd_chat)
    sub.add_parser("ui", help="launch the web UI").set_defaults(f=cmd_ui)

    g = sub.add_parser("ingest", help="index a folder or file"); g.add_argument("path")
    g.set_defaults(f=cmd_ingest)

    g = sub.add_parser("ask", help="RAG question over your docs"); g.add_argument("question", nargs="+")
    g.set_defaults(f=cmd_ask)

    g = sub.add_parser("agent", help="run the tool-using agent"); g.add_argument("goal", nargs="+")
    g.set_defaults(f=cmd_agent)

    g = sub.add_parser("serve", help="OpenAI-compatible API on localhost")
    g.add_argument("--host", default="127.0.0.1"); g.add_argument("--port", type=int, default=8000)
    g.set_defaults(f=cmd_serve)

    g = sub.add_parser("config", help="view/edit settings")
    g.add_argument("--set", nargs="*", metavar="KEY=VALUE")
    g.set_defaults(f=cmd_config)

    a = p.parse_args()
    if not getattr(a, "f", None):
        print(BANNER); p.print_help(); return
    a.f(a)


if __name__ == "__main__":
    main()
