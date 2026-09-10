"""Model architecture + paths. One place to tune everything."""
from __future__ import annotations

import json
from pathlib import Path

ROOT       = Path(__file__).resolve().parent.parent
CORPUS_DIR = ROOT / "corpus"
CKPT_DIR   = ROOT / "checkpoint"
CKPT_PATH  = CKPT_DIR / "pulse.npz"
UI_PATH    = ROOT / "ui" / "index.html"


class ModelConfig:
    """Hyper-parameters of the transformer. Small by design: it must train
    on a laptop CPU in well under an hour with plain numpy."""

    def __init__(self, **kw):
        self.vocab_size = int(kw.get("vocab_size", 0))   # filled in after tokenizer is built
        self.d_model    = int(kw.get("d_model", 128))    # embedding / hidden width
        self.n_layers   = int(kw.get("n_layers", 4))     # transformer blocks
        self.n_heads    = int(kw.get("n_heads", 4))      # attention heads (d_model % n_heads == 0)
        self.block_size = int(kw.get("block_size", 128)) # context window in tokens (words)

    # ------------------------------------------------------------ helpers
    @property
    def head_dim(self) -> int:
        return self.d_model // self.n_heads

    def n_params(self, vocab_size: int | None = None) -> int:
        v = vocab_size or max(self.vocab_size, 1)
        d, L = self.d_model, self.n_layers
        n  = v * d            # token embedding (tied with the output head)
        n += self.block_size * d
        n += L * (4 * d * d   # qkv + output projections
                  + 2 * d * 4 * d  # MLP up/down
                  + 4 * d     # 2 layernorms (g,b)
                  + d         # attn out bias
                  + 4 * d)    # mlp biases
        n += 2 * d            # final layernorm
        return n

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in
                ("vocab_size", "d_model", "n_layers", "n_heads", "block_size")}

    @classmethod
    def from_dict(cls, d: dict) -> "ModelConfig":
        return cls(**d)

    def __repr__(self) -> str:
        return (f"GPT(d={self.d_model}, layers={self.n_layers}, heads={self.n_heads}, "
                f"ctx={self.block_size}, vocab={self.vocab_size})")


# Runtime defaults (sampling behaviour of the chat app)
DEFAULT_TEMPERATURE = 0.7
DEFAULT_TOP_K       = 24
DEFAULT_MAX_NEW     = 60      # tokens (words) per reply
REPETITION_PENALTY  = 1.2


def load_json(path: Path) -> dict:
    return json.loads(Path(path).read_text())
