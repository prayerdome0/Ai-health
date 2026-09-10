"""Gradio chat UI: streaming, RAG toggle, agent toggle, live ingestion."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import gradio as gr

from core.config import Settings, report
from core.ingest import ingest_path
from core.llm import get_llm
from core.memory import Memory
from core.rag import rag_stream
from core.store import HybridStore
from core.tools import Toolbox
from core.agent import Agent

S = Settings.load()
LLM_ = get_llm(S)
STORE = HybridStore("kb", S)
MEM = Memory(LLM_, S)
TOOLS = Toolbox(S, store=STORE, memory=MEM)
AGENT = Agent(LLM_, TOOLS, S, MEM)


def respond(message, history, mode, temperature, use_memory):
    S.temperature = float(temperature)

    if mode == "📚 Documents (RAG)":
        acc = ""
        for piece in rag_stream(message, LLM_, STORE, S):
            acc += piece
            yield acc
        if use_memory:
            MEM.add("user", message); MEM.add("assistant", acc)
        return

    if mode == "🛠️ Agent (tools)":
        log, final = "", ""
        icons = {"thought": "💭", "action": "🔧", "observation": "👁️", "final": "✅"}
        events: list[tuple[str, str]] = []
        AGENT.stream  # noqa
        for out in AGENT.stream(message, on_event=lambda k, t: events.append((k, t))):
            final = out
        for k, t in events:
            if k == "final":
                continue
            body = t if len(t) < 700 else t[:700] + " …"
            log += f"{icons[k]} **{k}** — {body}\n\n"
        yield (f"<details><summary>🧠 reasoning trace ({len(events)} steps)</summary>\n\n"
               f"{log}</details>\n\n{final}")
        if use_memory:
            MEM.add("user", message); MEM.add("assistant", final)
        return

    # plain chat
    if use_memory:
        MEM.add("user", message)
        msgs = MEM.messages(S.system_prompt, MEM.auto_context(message))
    else:
        msgs = [{"role": "system", "content": S.system_prompt}]
        msgs += [{"role": m["role"], "content": m["content"]} for m in history]
        msgs.append({"role": "user", "content": message})

    acc = ""
    for piece in LLM_.stream(msgs):
        acc += piece
        yield acc
    if use_memory:
        MEM.add("assistant", acc)


def do_ingest(path):
    if not path:
        return "Give a folder or file path."
    try:
        r = ingest_path(path, STORE, S)
        return f"✅ {r['files']} files → {r['chunks']} new chunks. Index: {r['chunks_total'] if 'chunks_total' in r else STORE.stats()['chunks']} chunks total."
    except Exception as e:
        return f"❌ {type(e).__name__}: {e}"


def do_upload(files):
    if not files:
        return "No files."
    n = 0
    for f in files:
        n += ingest_path(f.name if hasattr(f, "name") else f, STORE, S)["chunks"]
    return f"✅ indexed {n} chunks. Total: {STORE.stats()['chunks']}."


CSS = """
.gradio-container {max-width: 1180px !important}
footer {display:none !important}
"""

with gr.Blocks(title="LocalMind", theme=gr.themes.Soft(), css=CSS) as demo:
    gr.Markdown("# 🧠 LocalMind\n**100% local.** No API keys, no cloud, no telemetry.")

    with gr.Tab("Chat"):
        with gr.Row():
            mode = gr.Radio(["💬 Chat", "📚 Documents (RAG)", "🛠️ Agent (tools)"],
                            value="💬 Chat", label="Mode", scale=3)
            temp = gr.Slider(0, 1.5, value=S.temperature, step=0.05, label="Temperature", scale=1)
            mem = gr.Checkbox(value=True, label="Memory", scale=1)
        gr.ChatInterface(
            respond, type="messages", additional_inputs=[mode, temp, mem],
            examples=[["Explain the CAP theorem with a real failure scenario."],
                      ["Write a Python LRU cache with TTL and unit tests."],
                      ["What do my documents say about deployment rollbacks?"],
                      ["Compute the 200th Fibonacci number and factor it."]],
        )

    with gr.Tab("Knowledge"):
        gr.Markdown("### Index your own files (PDF, MD, code, DOCX, HTML, TXT)")
        with gr.Row():
            path_in = gr.Textbox(label="Folder or file path", placeholder="/home/me/docs", scale=4)
            go = gr.Button("Ingest", variant="primary", scale=1)
        up = gr.File(label="…or drop files here", file_count="multiple")
        status = gr.Markdown()
        stats = gr.JSON(label="Index stats", value=STORE.stats())
        go.click(do_ingest, path_in, status).then(lambda: STORE.stats(), None, stats)
        up.upload(do_upload, up, status).then(lambda: STORE.stats(), None, stats)
        gr.Button("Clear index", variant="stop").click(
            lambda: (STORE.clear(), "🗑️ cleared")[1], None, status
        ).then(lambda: STORE.stats(), None, stats)

    with gr.Tab("System"):
        gr.Code(report(), label="Hardware & backend")
        sysbox = gr.Textbox(S.system_prompt, lines=6, label="System prompt")
        def save_sys(t):
            S.system_prompt = t; S.save(); return "saved ✔"
        out = gr.Markdown()
        gr.Button("Save").click(save_sys, sysbox, out)
        gr.Button("Reset conversation memory").click(lambda: (MEM.reset(), "memory cleared")[1], None, out)

if __name__ == "__main__":
    demo.queue().launch(server_name="127.0.0.1", server_port=7860, inbrowser=True)
