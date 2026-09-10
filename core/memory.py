"""Two-tier memory: rolling conversation summary + durable fact store."""
from __future__ import annotations

import hashlib, json, time
from pathlib import Path

from .config import DATA, Settings
from .llm import LLM
from .store import HybridStore

FACTS = DATA / "facts.jsonl"


class Memory:
    def __init__(self, llm: LLM, s: Settings, store: HybridStore | None = None):
        self.llm, self.s = llm, s
        self.summary = ""
        self.turns: list[dict] = []
        self.store = store or HybridStore("memory", s)
        self._max_chars = int(s.n_ctx * 3.0)     # ~3 chars/token, keep 100% headroom

    # ---------------------------------------------------- short-term
    def add(self, role: str, content: str) -> None:
        self.turns.append({"role": role, "content": content})
        if self._chars() > self._max_chars:
            self._compress()

    def _chars(self) -> int:
        return sum(len(t["content"]) for t in self.turns)

    def _compress(self) -> None:
        head, self.turns = self.turns[:-6], self.turns[-6:]
        if not head:
            return
        transcript = "\n".join(f"{t['role'].upper()}: {t['content'][:1500]}" for t in head)
        try:
            self.summary = self.llm.ask(
                f"Existing summary:\n{self.summary or '(none)'}\n\n"
                f"New transcript:\n{transcript}\n\n"
                "Produce an updated summary under 300 words. Keep decisions, "
                "constraints, names, file paths, numbers and open questions. Drop pleasantries.",
                system="You compress conversations losslessly with respect to facts.",
                max_tokens=500, temperature=0.2)
        except Exception:
            self.summary = (self.summary + "\n" + transcript)[-4000:]

    def messages(self, system: str, extra_context: str = "") -> list[dict]:
        sys_txt = system
        if self.summary:
            sys_txt += f"\n\n[Conversation so far]\n{self.summary}"
        if extra_context:
            sys_txt += f"\n\n[Relevant long-term memory]\n{extra_context}"
        return [{"role": "system", "content": sys_txt}] + self.turns

    def reset(self) -> None:
        self.summary, self.turns = "", []

    # ----------------------------------------------------- long-term
    def remember(self, fact: str) -> None:
        fact = fact.strip()
        if not fact:
            return
        fid = hashlib.sha1(fact.encode()).hexdigest()[:20]
        with FACTS.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"id": fid, "fact": fact, "t": time.time()}) + "\n")
        self.store.upsert([{"id": fid, "text": fact,
                            "meta": {"source": "memory", "name": "fact"}}])

    def recall(self, query: str, k: int = 5) -> list[str]:
        return [h["text"] for h in self.store.search(query, k=k, rerank=False)]

    def auto_context(self, user_msg: str) -> str:
        try:
            facts = self.recall(user_msg, k=4)
        except Exception:
            return ""
        return "\n".join(f"- {f}" for f in facts)
