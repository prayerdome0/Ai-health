#!/usr/bin/env python3
"""Corpus augmentation: multiply the hand-written dialogues into variants.

Reads every `corpus/*.txt` file, parses the `user:/ai:` conversation pairs,
and writes `corpus/11_variants.txt` containing several faithful paraphrases
of each pair — different question framings, answer wrappers, trimmed
short-form answers and combined mini-conversations. Facts are never changed;
only surface form varies, which is exactly what teaches a small model to
handle phrasings it has not seen verbatim.

    python tools/build_corpus.py            # rebuild 11_variants.txt
"""
from __future__ import annotations

import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "corpus"
OUT = CORPUS / "11_variants.txt"
SEED = 20260910

Q_PREFIX = ["", "", "", "hey, ", "ok so ", "quick one: ", "one more thing - ",
            "i was wondering, ", "simple question, ", "be honest, ", "so ",
            "also, ", "and ", "tell me, ", "genuine question: ", "real talk: "]
Q_SUFFIX = ["", "", "", "", " exactly?", " though?", " please?", " if possible?",
            " at all?", " in your view?", " for real?"]
A_PREFIX = ["", "", "", "", "", "sure. ", "good question. ", "happy to help. ",
            "the short answer: ", "here is the thing. ", "glad you asked. ",
            "let me share what works. ", "honestly, "]
A_SUFFIX = ["", "", "", "", "", " hope that helps!", " you've got this.",
            " small steps win.", " that is the whole trick.",
            " keep it simple and repeat it.", " start today, not someday.",
            " try it for two weeks and see."]


def parse_pairs(text: str) -> list[tuple[str, str]]:
    """Split a corpus file into (question, answer) pairs."""
    pairs = []
    for block in re.split(r"\n\s*\n", text.strip()):
        qm = re.match(r"user:\s*(.+?)\nai:\s*(.+)", block.strip(), re.S)
        if qm:
            q, a = qm.group(1).strip(), qm.group(2).strip()
            if q and a:
                pairs.append((q.lower(), a.lower()))
    return pairs


def shorten(answer: str, sentences: int) -> str:
    parts = re.split(r"(?<=[.!?])\s+", answer.strip())
    return " ".join(parts[:sentences]).strip()


def variants(q: str, a: str, rng: random.Random) -> list[tuple[str, str]]:
    out = []
    qp = rng.choice(Q_PREFIX) + q + rng.choice(Q_SUFFIX)
    ap = rng.choice(A_PREFIX) + a + rng.choice(A_SUFFIX)
    out.append((qp, ap))
    # short-form: trimmed answer with a light wrapper
    short = shorten(a, rng.choice([1, 2]))
    if len(short) > 40:
        wrap = rng.choice(["short version: ", "in a nutshell, ", "quick take: ", ""])
        out.append((q + rng.choice(Q_SUFFIX), wrap + short))
    return out


def main() -> None:
    rng = random.Random(SEED)
    pairs: list[tuple[str, str]] = []
    for f in sorted(CORPUS.glob("*.txt")):
        if f.name == OUT.name:
            continue
        pairs.extend(parse_pairs(f.read_text(encoding="utf-8")))
    print(f"parsed {len(pairs)} hand-written pairs")

    lines = []
    for q, a in pairs:
        for vq, va in variants(q, a, rng):
            lines.append(f"user: {vq}\nai: {va}\n")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {len(lines)} variant pairs -> {OUT} "
          f"({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
