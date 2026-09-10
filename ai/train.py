"""Train Pulse from scratch: corpus -> backpropagation -> checkpoint.

Everything runs locally on CPU with plain numpy:
  - batched forward pass through the transformer (built from autodiff Tensors)
  - cross-entropy loss over next-character prediction
  - AdamW + gradient clipping + warmup + cosine LR decay
  - periodic validation, best checkpoint kept

Usage:  python main.py train [--steps N] [--resume]
"""
from __future__ import annotations

import math
import time

import numpy as np

from .autodiff import AdamW, Tensor
from .config import CKPT_PATH, ModelConfig
from .data import Batcher, build_tokenizer, load_corpus
from .model import init_params, save_checkpoint


# ------------------------------------------------------------- forward
def forward(cfg: ModelConfig, params: dict, idx: Tensor, targets: Tensor | None = None):
    """Batched transformer forward. idx: (B,T) int64 -> returns the loss
    Tensor when targets are given (train mode)."""
    B, T = idx.value.shape
    d, H, V = cfg.d_model, cfg.n_heads, cfg.vocab_size
    hd = cfg.head_dim

    x = idx.embed(params["wte"]) + params["wpe"].slice_rows(T)

    mask = np.tril(np.ones((T, T), dtype=bool))
    for l in range(cfg.n_layers):
        # ---------------- causal self-attention
        h = x.layernorm(params[f"{l}.ln1.g"], params[f"{l}.ln1.b"])
        qkv = h.matmul(params[f"{l}.attn.wqkv"]) + params[f"{l}.attn.bqkv"]
        qkv = qkv.reshape(B, T, 3, H, hd)                       # (B,T,3,H,hd)
        qkv = qkv.transpose(0, 2, 3, 1, 4)                      # (B,3,H,T,hd)
        q, k, v = qkv.pick(0), qkv.pick(1), qkv.pick(2)         # each (B,H,T,hd)

        att = q.bmm(k.transpose(0, 1, 3, 2))                    # (B,H,T,T) scores
        att = (att * (1.0 / math.sqrt(hd))).causal_softmax(mask)
        y = att.bmm(v)                                          # (B,H,T,hd)
        y = y.transpose(0, 2, 1, 3).reshape(B, T, d)            # concat heads
        y = y.matmul(params[f"{l}.attn.wo"]) + params[f"{l}.attn.bo"]
        x = x + y                                               # residual

        # ---------------- MLP
        h = x.layernorm(params[f"{l}.ln2.g"], params[f"{l}.ln2.b"])
        h = (h.matmul(params[f"{l}.mlp.w1"]) + params[f"{l}.mlp.b1"]).gelu()
        x = x + h.matmul(params[f"{l}.mlp.w2"]) + params[f"{l}.mlp.b2"]

    x = x.layernorm(params["lnf.g"], params["lnf.b"])
    logits = x.matmul(params["wte"].transpose())            # tied weights (B,T,V)

    if targets is None:
        return logits
    loss = logits.reshape(B * T, V).cross_entropy(targets.value.reshape(B * T))
    return loss


def make_params(cfg: ModelConfig) -> dict:
    """Wrap freshly initialized weights into autodiff Tensors."""
    raw = init_params(cfg, np.random.default_rng())
    return {k: Tensor(v) for k, v in raw.items()}


# --------------------------------------------------------------- train
def train(steps: int = 1600, batch: int = 16, lr: float = 2e-3,
          resume: bool = False, log_every: int = 50, verbose: bool = True,
          weight_decay: float = 0.05):
    from pathlib import Path

    # ---- data
    text = load_corpus()
    tok = build_tokenizer(text)
    cfg = ModelConfig(vocab_size=tok.vocab_size)

    if resume and Path(CKPT_PATH).exists():
        from .model import load_checkpoint
        c0, _t0, params0, meta = load_checkpoint(CKPT_PATH)
        cfg = c0
        params = {k: Tensor(v) for k, v in params0.items()}
        start_step = int(meta.get("step", 0))
        if verbose:
            print(f"resumed from {CKPT_PATH} (step {start_step})")
    else:
        params = make_params(cfg)
        start_step = 0

    data = Batcher(text, tok, cfg.block_size)
    opt = AdamW(params, lr=lr, weight_decay=weight_decay)

    warmup = 100
    best_val = float("inf")

    def lr_at(step):
        t = step + 1
        if t <= warmup:
            return lr * t / warmup
        p = (t - warmup) / max(1, steps - warmup)
        return lr * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * min(p, 1.0))))

    if verbose:
        n = sum(p.value.size for p in params.values())
        print(f"{cfg}  |  {n:,} params  |  corpus {len(text):,} chars  | "
              f"{len(data.train):,} train / {len(data.val):,} val chars")
        print(f"training {steps} steps (batch {batch} x {cfg.block_size} chars)\n"
              f"{'step':>6}  {'loss':>7}  {'val':>7}  {'lr':>8}  {'tok/s':>7}  t")

    t_start = time.time()
    last_loss = float("nan")
    for i in range(start_step, start_step + steps):
        step_in_run = i - start_step
        opt.lr = lr_at(step_in_run)
        x, y = data.train_batch(batch)
        loss = forward(cfg, params, Tensor(x), Tensor(y))
        opt.zero_grad()
        loss.backward()
        loss.release_graph()          # free graph memory now, not at gc time
        opt.clip_grad_norm(1.0)
        opt.step()
        last_loss = float(loss.value)
        del loss
        if i % 25 == 24:
            import gc
            gc.collect()              # drop graph shells; keeps RSS flat

        if verbose and (i % log_every == 0 or step_in_run == steps - 1):
            vb = data.val_batch(batch)
            v = float(forward(cfg, params, Tensor(vb[0]), Tensor(vb[1])).value)
            if v < best_val:
                best_val = v
                save_checkpoint(CKPT_PATH, cfg, {k: q.value for k, q in params.items()},
                                tok, meta={"step": i, "loss": last_loss, "val_loss": v})
            del vb
            rate = batch * cfg.block_size * (i - start_step + 1) / max(1e-9, time.time() - t_start)
            print(f"{i:>6}  {last_loss:>7.3f}  {v:>7.3f}  {opt.lr:>8.5f}  "
                  f"{rate:>7.0f}  {time.time() - t_start:>5.0f}s", flush=True)

    # ---- keep the best-val model: only overwrite if the final weights beat it
    vb = data.val_batch(batch)
    vfinal = float(forward(cfg, params, Tensor(vb[0]), Tensor(vb[1])).value)
    if vfinal <= best_val:
        best_val = vfinal
        save_checkpoint(CKPT_PATH, cfg, {k: q.value for k, q in params.items()}, tok,
                        meta={"step": start_step + steps - 1,
                              "loss": last_loss, "val_loss": best_val})
    if verbose:
        print(f"\n✔ done in {time.time() - t_start:.0f}s   final loss {last_loss:.3f}   "
              f"best val {best_val:.3f}")
        print(f"✔ checkpoint saved to {CKPT_PATH}")
    return params


def generate_sample(params, cfg, tok, prompt: str = "user: hello\nai:",
                    chars: int = 120, temperature: float = 0.7) -> str:
    """Quick sample straight from training weights (no checkpoint round-trip)."""
    from .model import GPT
    g = GPT(cfg, {k: v.value for k, v in params.items()}, tok)
    out = list(g.stream(tok.encode(prompt), max_new=chars, temperature=temperature,
                        top_k=40))
    return tok.decode(out)
