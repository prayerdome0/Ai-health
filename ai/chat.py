"""Chat plumbing: turn conversation history into a prompt, generate a reply.

The model is a word-level language model, so "chat" is prompt engineering
over a consistent dialogue format learned from the corpus:

    user: how much water should I drink?
    ai: most adults do well with around six to eight cups a day ...
    user: ...
    ai: <generate here>

Generation stops at a line break or when the model starts another speaker
turn. Everything runs offline; no network calls anywhere in this file.
"""
from __future__ import annotations

from .config import (DEFAULT_MAX_NEW, DEFAULT_TEMPERATURE, DEFAULT_TOP_K,
                     REPETITION_PENALTY)
from .model import GPT


def build_prompt(model: GPT, history: list[dict], message: str,
                 answer_room: int) -> str:
    """Fold the recent conversation into one prompt that fits the context.

    history: [{"user": str, "ai": str}, ...] oldest first. Leaves
    `answer_room` tokens of the context window for the reply.
    """
    tok = model.tok
    budget = model.cfg.block_size - answer_room

    def n_tokens(s: str) -> int:
        return len(tok.encode(s))

    lines = [f"user: {message.strip().lower()}", "ai:"]
    used = sum(n_tokens(l) + 1 for l in lines)      # +1 for the newline join
    for turn in reversed(history):
        u = f"user: {str(turn.get('user', '')).strip().lower()}"
        a = f"ai: {str(turn.get('ai', '')).strip().lower()}"
        add = n_tokens(u) + n_tokens(a) + 2
        if used + add > budget:
            break
        lines.insert(0, a)
        lines.insert(0, u)
        used += add
    return "\n".join(lines)


def clean_reply(raw: str) -> str:
    """Trim stop-strings and dangling fragments from a raw generation."""
    text = raw
    for s in ("\nuser:", "\nai:"):
        idx = text.find(s)
        if idx != -1:
            text = text[:idx]
    lines = text.split("\n")
    while lines and (not lines[-1].strip()
                     or lines[-1].strip().startswith(("user:", "ai:"))):
        lines.pop()
    out = "\n".join(lines).strip()
    while "\n\n\n" in out:
        out = out.replace("\n\n\n", "\n\n")
    # if generation was cut mid-flow, drop the trailing unfinished sentence
    # (but always keep at least one sentence)
    if out and out[-1] not in ".!?":
        sentences = out.replace("!", ".").replace("?", ".").count(".")
        if sentences >= 2:
            cut = max(out.rfind("."), out.rfind("!"), out.rfind("?"))
            if cut > 10:
                out = out[:cut + 1]
    return out


def generate_reply(model: GPT, history: list[dict], message: str,
                   temperature: float = DEFAULT_TEMPERATURE,
                   top_k: int = DEFAULT_TOP_K,
                   max_new: int = DEFAULT_MAX_NEW,
                   rep_penalty: float = REPETITION_PENALTY) -> str:
    """One full reply for `message` given the conversation `history`."""
    max_new = min(max_new, max(16, model.cfg.block_size // 2))
    answer_room = max_new + 4
    prompt = build_prompt(model, history, message, answer_room)
    ids = model.tok.encode(prompt)
    if not ids:
        return "…"

    stop_ids = {i for i in (model.tok.id_of("\n\n"), model.tok.id_of("user"),
                            model.tok.id_of("ai")) if i is not None}
    end_id = model.tok.id_of("\n\n")
    raw_ids: list[int] = []
    for nid in model.stream(ids, max_new=max_new, temperature=temperature,
                            top_k=top_k, rep_penalty=rep_penalty,
                            stop_bias_id=end_id, stop_bias=0.8):
        if nid in stop_ids:
            break
        raw_ids.append(nid)

    reply = clean_reply(model.tok.decode(raw_ids))
    if not reply:                     # rare degenerate sample — retry a bit warmer
        return generate_reply(model, history, message, temperature + 0.15,
                              top_k, max_new, rep_penalty)
    return reply


# ----------------------------------------------------------------- REPL
def chat_repl(model: GPT) -> None:
    """Interactive terminal chat."""
    history: list[dict] = []
    temperature = DEFAULT_TEMPERATURE
    print("Pulse chat — built from scratch, fully offline.")
    print("commands: /reset  /temp <x>  /raw  /quit\n")
    while True:
        try:
            msg = input("\033[1myou ›\033[0m ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not msg:
            continue
        if msg in ("/quit", "/exit", "/q"):
            break
        if msg == "/reset":
            history.clear()
            print("· conversation cleared\n")
            continue
        if msg.startswith("/temp"):
            try:
                temperature = float(msg.split()[1])
                print(f"· temperature = {temperature}\n")
            except (IndexError, ValueError):
                print(f"· temperature = {temperature} (usage: /temp 0.7)\n")
            continue
        if msg == "/raw":
            prompt = build_prompt(model, history, msg or "hello", DEFAULT_MAX_NEW + 4)
            print("\033[36mpulse ›\033[0m ", end="", flush=True)
            for nid in model.stream(model.tok.encode(prompt),
                                    temperature=temperature):
                ch = model.tok.decode([nid])
                print(ch, end="", flush=True)
                if model.tok.itos.get(nid) in ("\n\n", "user", "ai"):
                    break
            print("\n")
            history.append({"user": msg, "ai": "(raw)"})
            continue

        print("\033[36mpulse ›\033[0m ", end="", flush=True)
        reply = generate_reply(model, history, msg, temperature)
        print(reply, "\n")
        history.append({"user": msg, "ai": reply})
