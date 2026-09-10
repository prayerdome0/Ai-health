"""The Pulse transformer — a decoder-only GPT, implemented from scratch.

Architecture (identical in spirit to GPT-2, tiny in size):
    token embedding + learned positional embedding
    -> N x [ LayerNorm -> multi-head causal self-attention -> residual
             LayerNorm -> GELU MLP (4x) -> residual ]
    -> final LayerNorm -> tied output projection (same matrix as embedding)

Inference runs one token at a time with a KV cache, so the cost per
generated token (word) is constant, not quadratic.

Weights are plain numpy arrays at rest; the runtime backend (numpy or pure
python) converts them once at load. This module knows nothing about
training — ai/autodiff.py + ai/train.py handle that.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterator

import numpy as np

from .config import CKPT_PATH, ModelConfig
from .ops import PureOps, get_ops, has_numpy
from .tokenizer import WordTokenizer


# ----------------------------------------------------------------- params
def init_params(cfg: ModelConfig, rng: np.random.Generator) -> dict:
    """Random initialization (GPT-2 style: normal(0, 0.02), residual-scaled)."""
    d, L, V = cfg.d_model, cfg.n_layers, cfg.vocab_size
    p: dict[str, np.ndarray] = {}
    p["wte"] = rng.normal(0, 0.02, (V, d)).astype(np.float32)     # tied output head
    p["wpe"] = rng.normal(0, 0.01, (cfg.block_size, d)).astype(np.float32)
    for l in range(L):
        res_std = 1.0 / math.sqrt(2 * L)      # keeps the residual stream bounded
        p[f"{l}.ln1.g"] = np.ones(d, dtype=np.float32)
        p[f"{l}.ln1.b"] = np.zeros(d, dtype=np.float32)
        p[f"{l}.attn.wqkv"] = rng.normal(0, 0.02, (d, 3 * d)).astype(np.float32)
        p[f"{l}.attn.bqkv"] = np.zeros(3 * d, dtype=np.float32)
        p[f"{l}.attn.wo"] = (rng.normal(0, 0.02, (d, d)) * res_std).astype(np.float32)
        p[f"{l}.attn.bo"] = np.zeros(d, dtype=np.float32)
        p[f"{l}.ln2.g"] = np.ones(d, dtype=np.float32)
        p[f"{l}.ln2.b"] = np.zeros(d, dtype=np.float32)
        p[f"{l}.mlp.w1"] = rng.normal(0, 0.02, (d, 4 * d)).astype(np.float32)
        p[f"{l}.mlp.b1"] = np.zeros(4 * d, dtype=np.float32)
        p[f"{l}.mlp.w2"] = (rng.normal(0, 0.02, (4 * d, d)) * res_std).astype(np.float32)
        p[f"{l}.mlp.b2"] = np.zeros(d, dtype=np.float32)
    p["lnf.g"] = np.ones(d, dtype=np.float32)
    p["lnf.b"] = np.zeros(d, dtype=np.float32)
    return p


# ----------------------------------------------------------------- model
class GPT:
    """Inference engine: `feed()` token ids one at a time, read `logits`,
    then sample with `sample_id()`."""

    def __init__(self, cfg: ModelConfig, params: dict, tokenizer: WordTokenizer,
                 force_pure: bool = False):
        self.cfg = cfg
        self.tok = tokenizer
        self.ops = PureOps() if force_pure else get_ops()
        if self.ops.name == "numpy":
            self.p = {k: np.asarray(v, dtype=np.float32) for k, v in params.items()}
        else:
            self.p = {k: (v.tolist() if isinstance(v, np.ndarray) else v)
                      for k, v in params.items()}
        self.d = cfg.d_model
        self.H = cfg.n_heads
        self.hd = cfg.head_dim
        self._reset_cache()

    # ------------------------------------------------------------- cache
    def _reset_cache(self):
        self.pos = 0
        self.logits = None
        n = self.cfg.n_layers
        self.k_cache: list[list] = [[] for _ in range(n)]   # [layer][head] -> list of vectors
        self.v_cache: list[list] = [[] for _ in range(n)]

    # ----------------------------------------------------------- forward
    def feed(self, idx: int) -> None:
        """Process one token id at position `self.pos`; updates `self.logits`
        (prediction for the NEXT token)."""
        ops, cfg = self.ops, self.cfg
        if self.pos >= cfg.block_size:
            raise IndexError(f"context full: {self.pos} >= block_size {cfg.block_size}")

        x = ops.add(self.p["wte"][int(idx)], self.p["wpe"][self.pos])

        for l in range(cfg.n_layers):
            # ---------------- causal self-attention
            h = ops.layernorm(x, self.p[f"{l}.ln1.g"], self.p[f"{l}.ln1.b"])
            qkv = ops.matvec(self.p[f"{l}.attn.wqkv"], h)
            qkv = ops.add(qkv, self.p[f"{l}.attn.bqkv"])
            q, k, v = qkv[:self.d], qkv[self.d:2 * self.d], qkv[2 * self.d:]

            heads = range(self.H)
            kc, vc = self.k_cache[l], self.v_cache[l]
            kc.append([k[hx * self.hd:(hx + 1) * self.hd] for hx in heads])
            vc.append([v[hx * self.hd:(hx + 1) * self.hd] for hx in heads])

            scale = 1.0 / math.sqrt(self.hd)
            head_outs = []
            for hx in heads:
                qh = q[hx * self.hd:(hx + 1) * self.hd]
                scores = [scale * ops.dot(qh, kh[hx]) for kh in kc]
                probs = ops.softmax(scores)
                acc = None
                for t, pt in enumerate(probs):
                    contrib = ops.scale(vc[t][hx], pt)
                    acc = contrib if acc is None else ops.add(acc, contrib)
                head_outs.append(acc)
            flat = ops.concat(head_outs)                      # concatenate heads!
            o = ops.add(ops.matvec(self.p[f"{l}.attn.wo"], flat),
                        self.p[f"{l}.attn.bo"])
            x = ops.add(x, o)                                  # residual

            # ---------------- MLP
            h = ops.layernorm(x, self.p[f"{l}.ln2.g"], self.p[f"{l}.ln2.b"])
            h1 = ops.gelu(ops.add(ops.matvec(self.p[f"{l}.mlp.w1"], h),
                                  self.p[f"{l}.mlp.b1"]))
            x = ops.add(x, ops.add(ops.matvec(self.p[f"{l}.mlp.w2"], h1),
                                   self.p[f"{l}.mlp.b2"]))

        x = ops.layernorm(x, self.p["lnf.g"], self.p["lnf.b"])
        if self.ops.name == "numpy":
            self.logits = self.p["wte"] @ x                    # tied weights
        else:
            self.logits = [sum(w * xi for w, xi in zip(row, x))
                           for row in self.p["wte"]]
        self.pos += 1

    def prime(self, ids) -> "GPT":
        """Reset and run a whole prompt through the network."""
        self._reset_cache()
        for i in ids:
            self.feed(i)
        return self

    # --------------------------------------------------------- sampling
    def sample_id(self, temperature: float = 1.0, top_k: int = 0, top_p: float = 0.0,
                  recent_ids=None, rep_penalty: float = 1.0,
                  stop_bias_id: int | None = None, stop_bias: float = 0.0) -> int:
        """Sample the next token id from `self.logits`.

        `stop_bias_id`/`stop_bias` add a fixed logit bonus to one token (used
        to favour the end-of-turn token so replies finish with their answer
        instead of drifting into the next topic).
        """
        z = np.asarray(self.logits, dtype=np.float64).copy()
        if stop_bias_id is not None and stop_bias:
            z[stop_bias_id] += stop_bias
        if rep_penalty != 1.0 and recent_ids:
            for t in {int(i) for i in recent_ids[-64:]}:
                z[t] = z[t] / rep_penalty if z[t] > 0 else z[t] * rep_penalty
        if temperature <= 0:                                    # greedy
            return int(np.argmax(z))
        z /= temperature
        if top_k and top_k > 0:
            kth = np.sort(z)[-min(top_k, z.size)]
            z[z < kth] = -np.inf
        if top_p and 0.0 < top_p < 1.0:
            order = np.argsort(-z)
            keep = order[:max(1, int(np.searchsorted(
                np.cumsum(_softmax(z[order])), top_p) + 1))]
            m = np.full_like(z, -np.inf)
            m[keep] = z[keep]
            z = m
        z = np.where(np.isfinite(z), z, -np.inf)
        e = np.exp(z - z.max())
        probs = e / e.sum()
        return int(np.random.choice(len(probs), p=probs))

    def stream(self, prompt_ids, max_new: int = 200, temperature: float = 0.8,
               top_k: int = 40, top_p: float = 0.0, rep_penalty: float = 1.15,
               stop_bias_id: int | None = None, stop_bias: float = 0.0) -> Iterator[int]:
        """Yield up to `max_new` sampled token ids after the prompt."""
        ids = list(prompt_ids)[-int(self.cfg.block_size * 0.6):]   # leave room to answer
        max_new = min(max_new, self.cfg.block_size - len(ids) - 1)
        if max_new <= 0:
            return
        self.prime(ids)
        generated: list[int] = []
        for j in range(max_new):
            nid = self.sample_id(temperature, top_k, top_p,
                                 recent_ids=ids + generated,
                                 rep_penalty=rep_penalty,
                                 stop_bias_id=stop_bias_id, stop_bias=stop_bias)
            generated.append(nid)
            yield nid
            if j < max_new - 1:               # no wasted feed after the last sample
                self.feed(nid)

    # ------------------------------------------------------------ meta
    @property
    def n_params(self) -> int:
        return sum(int(np.asarray(v).size) for v in self.p.values())


def _softmax(z: np.ndarray) -> np.ndarray:
    finite = np.isfinite(z)
    out = np.zeros_like(z)
    if finite.any():
        e = np.exp(z[finite] - z[finite].max())
        out[finite] = e / e.sum()
    return out


# ------------------------------------------------------------ persistence
def save_checkpoint(path, cfg: ModelConfig, params: dict,
                    tokenizer: WordTokenizer, meta: dict | None = None) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = {k: np.asarray(v).astype(np.float16) for k, v in params.items()}
    meta_json = json.dumps({"cfg": cfg.to_dict(), "vocab": tokenizer.to_dict(),
                            **(meta or {})})
    blob["_meta"] = np.frombuffer(meta_json.encode(), dtype=np.uint8)
    np.savez_compressed(path, **blob)


def load_checkpoint(path=CKPT_PATH):
    """Returns (cfg, tokenizer, float32 params, meta dict)."""
    data = np.load(path)
    meta = json.loads(bytes(data["_meta"]).decode())
    cfg = ModelConfig.from_dict(meta["cfg"])
    tok = WordTokenizer.from_dict(meta["vocab"])
    params = {k: data[k].astype(np.float32) for k in data.files if k != "_meta"}
    return cfg, tok, params, meta


def load_model(path=CKPT_PATH, force_pure: bool = False) -> GPT:
    cfg, tok, params, _meta = load_checkpoint(path)
    return GPT(cfg, params, tok, force_pure=force_pure)
