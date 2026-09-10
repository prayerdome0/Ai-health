"""Corpus loading and mini-batch sampling for training."""
from __future__ import annotations

import random
from pathlib import Path

import numpy as np

from .config import CORPUS_DIR
from .tokenizer import WordTokenizer

END = "\n\n"          # conversation separator


def load_corpus(corpus_dir: Path = CORPUS_DIR) -> str:
    """Concatenate every .txt file in corpus/ (sorted for determinism)."""
    files = sorted(Path(corpus_dir).glob("*.txt"))
    if not files:
        raise FileNotFoundError(f"no .txt files found in {corpus_dir}")
    parts = []
    for f in files:
        parts.append(f.read_text(encoding="utf-8").strip().lower())
    return END.join(parts) + END


def build_tokenizer(text: str) -> WordTokenizer:
    return WordTokenizer.from_text(text)


class Batcher:
    """Yields random (x, y) mini-batches for next-word prediction."""

    def __init__(self, text: str, tokenizer: WordTokenizer, block_size: int,
                 val_fraction: float = 0.04, seed: int = 1337):
        ids = np.asarray(tokenizer.encode(text), dtype=np.int16)
        split = int(len(ids) * (1.0 - val_fraction))
        self.train = ids[:split]
        self.val = ids[split:block_size * 64] if len(ids) - split > block_size * 64 \
            else ids[split:]
        self.block = block_size
        self.rng = random.Random(seed)

    def _sample(self, data: np.ndarray, batch: int) -> tuple[np.ndarray, np.ndarray]:
        T = self.block
        ix = [self.rng.randrange(0, len(data) - T - 1) for _ in range(batch)]
        x = np.stack([data[i:i + T] for i in ix]).astype(np.int64)
        y = np.stack([data[i + 1:i + T + 1] for i in ix]).astype(np.int64)
        return x, y

    def train_batch(self, batch: int):
        return self._sample(self.train, batch)

    def val_batch(self, batch: int, tries: int = 20):
        try:
            return self._sample(self.val, batch)
        except (ValueError, IndexError):
            return self.train_batch(batch)
