"""Grounded question answering with citations + query expansion."""
from __future__ import annotations

from typing import Iterator

from .config import Settings
from .llm import LLM
from .store import HybridStore

GROUNDED_SYSTEM = """You answer strictly from the provided CONTEXT.
Rules:
1. Every factual claim must come from the context. Never invent details.
2. Cite sources inline as [1], [2] matching the numbered context blocks.
3. If the context does not contain the answer, say exactly what is missing.
4. Be concise and technical. Use code blocks and tables where they help."""


def build_context(hits: list[dict], budget: int = 12000) -> tuple[str, list[str]]:
    blocks, srcs, used = [], [], 0
    for i, h in enumerate(hits, 1):
        name = h["meta"].get("name", h["meta"].get("source", "?"))
        body = h["text"]
        if used + len(body) > budget:
            body = body[: max(0, budget - used)]
        if not body:
            break
        blocks.append(f"[{i}] source: {name}\n{body}")
        srcs.append(h["meta"].get("source", name))
        used += len(body)
    return "\n\n---\n\n".join(blocks), srcs


def expand_query(llm: LLM, q: str) -> str:
    """One cheap rewrite catches synonym/jargon mismatch — big recall win."""
    try:
        alt = llm.ask(
            f"Rewrite this search query into 3 short keyword variations "
            f"(one per line, no numbering, no commentary):\n{q}",
            system="You output only search queries.", max_tokens=80, temperature=0.3)
        return q + "\n" + "\n".join(l.strip() for l in alt.splitlines() if l.strip())[:400]
    except Exception:
        return q


def rag_stream(question: str, llm: LLM, store: HybridStore, s: Settings,
               k: int | None = None, expand: bool = True) -> Iterator[str]:
    query = expand_query(llm, question) if expand else question
    hits = store.search(query, k=k or s.final_k)
    if not hits:
        yield ("No documents indexed (or nothing matched). "
               "Run:  python main.py ingest /path/to/docs")
        return
    ctx, srcs = build_context(hits)
    msgs = [{"role": "system", "content": GROUNDED_SYSTEM},
            {"role": "user", "content": f"CONTEXT:\n{ctx}\n\nQUESTION: {question}"}]
    yield from llm.stream(msgs)
    uniq = sorted(set(srcs))
    yield "\n\n---\n**Sources**\n" + "\n".join(f"- `{x}`" for x in uniq)


def rag_answer(question: str, llm: LLM, store: HybridStore, s: Settings, **kw) -> str:
    return "".join(rag_stream(question, llm, store, s, **kw))
