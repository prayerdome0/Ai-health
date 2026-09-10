"""Word-level tokenizer with a vocabulary learned from the corpus.

Words make tiny models vastly more coherent than characters: every token the
network predicts is already a real word, so all of its capacity goes to
*sequence* learning rather than spelling. The vocabulary is just the list of
tokens observed in the corpus (words, punctuation marks, and newline tokens
that mark line breaks and conversation boundaries). Words a user types that
the corpus never contained map to <unk>, which is silently skipped in output.

Token scheme:
    "water" "drink" "don't"        -> whole words (apostrophes stay inside)
    ":"  "?"  ","  "!"  ...        -> punctuation, one character each
    "\n"                           -> line break (the user:/ai: turn separator)
    "\n\n"                         -> blank line (conversation boundary)
    "<unk>"                        -> anything outside the vocabulary
"""
from __future__ import annotations

import re
from collections import Counter

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:'[a-z]+)?|\n\n|\n|[^\sa-z0-9]")
UNK = "<unk>"

# punctuation that attaches to the previous word when reconstructing text
_NO_SPACE_BEFORE = set(".,!?:;')]}\"%")


class WordTokenizer:
    def __init__(self, vocab: list[str]):
        # deterministic vocabulary: <unk> first, then frequency (desc), then alpha
        self.vocab = [UNK] + vocab
        self.stoi = {t: i for i, t in enumerate(self.vocab)}
        self.itos = {i: t for i, t in enumerate(self.vocab)}
        self.unk_id = 0
        self.vocab_size = len(self.vocab)

    # ------------------------------------------------------------ build
    @classmethod
    def from_text(cls, text: str, min_count: int = 1) -> "WordTokenizer":
        counts = Counter(_TOKEN_RE.findall(text.lower()))
        vocab = [t for t, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
                 if n >= min_count and t != UNK]
        return cls(vocab)

    # ---------------------------------------------------------- convert
    def encode(self, text: str) -> list[int]:
        return [self.stoi.get(t, self.unk_id)
                for t in _TOKEN_RE.findall(text.lower())]

    def decode(self, ids) -> str:
        parts: list[str] = []
        for i in ids:
            tok = self.itos.get(int(i))
            if tok is None or tok == UNK:
                continue
            if tok == "\n\n":
                parts.append("\n\n")
            elif tok == "\n":
                parts.append("\n")
            elif tok in _NO_SPACE_BEFORE and parts and parts[-1] not in ("\n", "\n\n"):
                parts.append(tok)
            else:
                if parts and parts[-1] not in ("\n", "\n\n"):
                    parts.append(" ")
                parts.append(tok)
        return "".join(parts)

    # -------------------------------------------------------- utilities
    def id_of(self, token: str) -> int | None:
        return self.stoi.get(token)

    def to_dict(self) -> dict:
        return {"tokens": self.vocab[1:]}          # <unk> is implicit at index 0

    @classmethod
    def from_dict(cls, d: dict) -> "WordTokenizer":
        return cls(list(d["tokens"]))
