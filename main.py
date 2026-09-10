#!/usr/bin/env python3
"""Pulse — one entrypoint for everything.

    python main.py chat        terminal chat with the trained model
    python main.py ui          web chat UI on http://localhost:8000
    python main.py train       (re)train the network from ./corpus
    python main.py info        architecture, checkpoint and corpus facts
    python main.py say "..."   one-shot generation
    python main.py selftest    verify the whole system end to end

No API keys. No downloads. No external services. A real neural network,
defined and trained entirely by this repository.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

# glibc: serve big arrays via mmap so freed memory returns to the OS
# (keeps RSS flat during training). Re-exec once if not already set.
if sys.platform.startswith("linux") and "MALLOC_MMAP_THRESHOLD_" not in os.environ:
    _env = dict(os.environ, MALLOC_MMAP_THRESHOLD_="2097152")
    os.execve(sys.executable, [sys.executable] + sys.argv, _env)

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ai.config import CKPT_PATH, ModelConfig
from ai.ops import has_numpy

BANNER = r"""
  ____  _              __    _
 |  _ \| | __ _  ___  / /   /_\   _ __  _   _  ___
 | |_) | |/ _` |/ _ \| |   / _ \ | '_ \| | | |/ _ \
 |  __/| | (_| |  __/| |  / _ \| | | | | |_| |  __/
 |_|   |_|\__,_|\___||_| /_/ \_\_| |_|\__, |\___|
                                      |___/
        a real transformer, trained from scratch — no APIs
"""


def _load_model(force_pure: bool = False):
    if not CKPT_PATH.exists():
        sys.exit("no checkpoint yet — train first:  python main.py train")
    from ai.model import load_model
    t0 = time.time()
    model = load_model(force_pure=force_pure)
    return model, time.time() - t0


# ------------------------------------------------------------------ cmds
def cmd_info(_a):
    print(BANNER)
    print(f"numpy available : {has_numpy()}  "
          f"({'fast mode' if has_numpy() else 'pure-python fallback (slower)'})")
    print(f"checkpoint      : {CKPT_PATH}  "
          f"({'%.1f MB' % (CKPT_PATH.stat().st_size / 1e6) if CKPT_PATH.exists() else 'missing'})")
    from ai.data import load_corpus
    text = load_corpus()
    print(f"corpus          : {len(text):,} chars in ./corpus")
    if CKPT_PATH.exists():
        from ai.model import load_checkpoint
        cfg, tok, _params, meta = load_checkpoint()
        print(f"architecture    : {cfg}")
        print(f"vocabulary     : {tok.vocab_size} words (learned from the corpus)")
        print(f"last training   : step {meta.get('step', '?')}, "
              f"val loss {meta.get('val_loss', float('nan')):.3f}")
    cfg = ModelConfig()
    print(f"trainable params: {cfg.n_params(vocab_size=100):,}")


def cmd_train(a):
    from ai.train import train
    print(BANNER)
    if not has_numpy():
        sys.exit("training needs numpy:  pip install numpy")
    train(steps=a.steps, batch=a.batch, lr=a.lr, resume=a.resume)


def cmd_chat(_a):
    model, dt = _load_model()
    print(BANNER)
    print(f"loaded in {dt:.1f}s · {model.n_params:,} params · "
          f"backend: {model.ops.name}\n")
    from ai.chat import chat_repl
    chat_repl(model)


def cmd_say(a):
    model, _dt = _load_model()
    from ai.chat import generate_reply
    print(generate_reply(model, [], a.text))


def cmd_ui(a):
    from ai.webui import serve
    print(BANNER)
    serve(host=a.host, port=a.port)


def cmd_selftest(_a):
    from tests.test_all import run_all
    ok = run_all()
    sys.exit(0 if ok else 1)


def cmd_benchmark(a):
    model, _ = _load_model()
    ids = model.tok.encode("user: what helps me sleep better?\nai:")
    model.prime(ids)
    n = 0
    t0 = time.time()
    while time.time() - t0 < a.seconds:
        model.feed(model.sample_id(temperature=0.8, top_k=40))
        n += 1
    dt = time.time() - t0
    print(f"backend {model.ops.name}: {n / dt:.1f} chars/s over {n} chars")


# ------------------------------------------------------------------- cli
def main():
    p = argparse.ArgumentParser("pulse", description="A real local AI. No APIs.")
    p.add_argument("--version", action="store_true")
    sub = p.add_subparsers(dest="cmd")

    sub.add_parser("info", help="system overview").set_defaults(f=cmd_info)

    t = sub.add_parser("train", help="train from ./corpus (CPU, minutes)")
    t.add_argument("--steps", type=int, default=1600)
    t.add_argument("--batch", type=int, default=16)
    t.add_argument("--lr", type=float, default=2e-3)
    t.add_argument("--resume", action="store_true", help="continue from checkpoint")
    t.set_defaults(f=cmd_train)

    sub.add_parser("chat", help="terminal chat").set_defaults(f=cmd_chat)

    s = sub.add_parser("say", help="one-shot reply")
    s.add_argument("text")
    s.set_defaults(f=cmd_say)

    u = sub.add_parser("ui", help="web chat UI")
    u.add_argument("--host", default="0.0.0.0")
    u.add_argument("--port", type=int, default=8000)
    u.set_defaults(f=cmd_ui)

    sub.add_parser("selftest", help="verify everything works").set_defaults(f=cmd_selftest)

    b = sub.add_parser("benchmark", help="generation speed")
    b.add_argument("--seconds", type=float, default=3.0)
    b.set_defaults(f=cmd_benchmark)

    a = p.parse_args()
    if a.version:
        print("pulse 1.0")
        return
    if not getattr(a, "f", None):
        print(BANNER)
        p.print_help()
        return
    a.f(a)


if __name__ == "__main__":
    main()
