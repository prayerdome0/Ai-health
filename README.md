# Pulse ⚡

**A real artificial neural network — defined, trained and served entirely by this
repository. No APIs. No API keys. No cloud. No model downloads.**

Pulse is a small decoder-only transformer (the GPT architecture) implemented from
scratch in Python. Every piece is in this repo:

- a **reverse-mode automatic differentiation engine** (`ai/autodiff.py`) —
  backpropagation is derived and computed by code you can read
- a **GPT-style transformer**: multi-head causal self-attention, GELU MLPs,
  layer norm, residual stream, tied embeddings (`ai/model.py`, `ai/train.py`)
- an **AdamW optimizer** with gradient clipping, warmup and cosine decay
- a **character-level tokenizer** learned from the bundled corpus
- a **~65 KB hand-written health & conversation corpus** it learns from
- a **terminal chat** and a **web chat UI** served by Python's standard library

Training happens on your CPU in ~20 minutes. The trained network is checked
in at `checkpoint/pulse.npz` (~2.2 MB), so everything works out of the box —
and you can wipe it and retrain it yourself with one command.

```bash
pip install -r requirements.txt      # just numpy (optional but recommended)

python main.py chat                  # chat in the terminal
python main.py ui                    # chat in the browser (http://localhost:8000)
python main.py train                 # retrain the network from ./corpus (~15 min CPU)
python main.py selftest              # 19 checks: gradients, causality, inference…
python main.py info                  # architecture + checkpoint facts
```

```
.
├── main.py               # entrypoint: chat | ui | train | say | info | selftest | benchmark
├── ai/
│   ├── autodiff.py       # micro reverse-mode autodiff engine + AdamW (from scratch)
│   ├── model.py          # GPT architecture, KV-cache inference, checkpoint I/O
│   ├── train.py          # batched forward/backward, training loop
│   ├── ops.py            # dual math backend: numpy OR pure-python (zero deps)
│   ├── tokenizer.py      # character-level tokenizer
│   ├── data.py           # corpus loading + batching
│   ├── chat.py           # prompt building, sampling, reply cleaning, REPL
│   └── webui.py          # stdlib http server for the web UI
├── ui/index.html         # single-file chat page (vanilla JS, no build step)
├── corpus/*.txt          # the entire "knowledge" of the model, human-readable
├── tools/build_corpus.py # paraphrase-augmentation for the hand-written corpus
├── checkpoint/pulse.npz  # trained weights (float16) + vocab + config
└── tests/test_all.py     # gradient checks, causality, backend equivalence, e2e
```

## Why this is a "real" AI

Pulse is not a chatbot script and not a wrapper around someone else's model.
It is a neural network: 1,166,080 floating-point parameters arranged as a
transformer, initialized to random noise and **learned by gradient descent**.
Run `python main.py train` and you can watch the loss fall from 7.96 (random
over a 2,784-word vocabulary) as backpropagation reshapes every weight:

```
  step     loss      val        lr    tok/s  t
     0    7.959    7.956   0.00003      928  2s
   300    2.642    3.573   0.00242    2,422  191s
   850    0.334    1.257   0.00153    2,433  537s
  1700    0.122    0.689   0.00014    2,437  1072s
```

The self-test proves the machinery is real:

- **backprop matches finite differences** — every gradient of the loss with
  respect to every weight is checked numerically
- **attention is causal** — changing future tokens cannot change past predictions
- **three independent implementations agree** — the batched training forward,
  the KV-cache inference path, and a pure-Python fallback (no numpy at all)
  produce the same logits
- **it learns** — on a toy corpus the loss drops fast, end to end

## Design notes

| Decision | Why |
|---|---|
| Word-level tokenizer | The vocabulary is simply the words observed in the corpus — no merges file, no downloads. Predicting whole words instead of characters is what lets a model this small produce coherent sentences at all. |
| Tied input/output embeddings | Halves the biggest parameter block and acts as a built-in regularizer at this scale. |
| KV-cache inference | Each generated character costs the same, regardless of context length. |
| Pure-Python backend | With zero third-party packages installed, inference still runs (`python main.py chat` after uninstalling numpy) — just slowly. numpy is only *required* for training. |
| Corpus in plain text | The model's entire world-view is auditable in `corpus/`. Edit it, retrain, and the model changes. `tools/build_corpus.py` multiplies each hand-written pair into paraphrased variants — same facts, many surface forms — which is what keeps a small model from collapsing into rote memorization. |
| Best-val checkpointing | Training keeps the checkpoint with the lowest validation loss, protecting against overfitting a small corpus. |
| stdlib web server | `python main.py ui` has no Flask/FastAPI/Gradio dependency. One process, one file of HTML. |

## Honest limitations

Pulse has ~1.17M parameters and ~55K training tokens — a large model has
billions of parameters and trillions of tokens. Expect a small, charming,
sometimes confused assistant: good at the *shape* of health conversations and
its corpus's advice, occasionally answering a neighbouring question instead of
yours, and capable of nonsense. Treat everything it says as educational, never
as medical advice (it will usually remind you of this itself — the corpus is
written that way on purpose).

Scaling levers, all already supported by the code:

- **More text**: drop `.txt` files into `corpus/` and retrain.
- **Bigger model**: `ai/config.py` → `d_model`, `n_layers`, `block_size`.
- **Longer training**: `python main.py train --steps 4000 --resume`.

## Requirements

- Python 3.10+
- numpy (training; strongly recommended for inference)
- ~1 GB RAM for training, ~100 MB for chatting

Optional: with numpy uninstalled, chat still works via the pure-Python backend
(`~1–2 s per token` — proof of self-sufficiency, not a recommendation).

## Privacy

Pulse runs on your machine and talks only to your machine. There is no server,
no telemetry, no account, no network access in the code paths at all. Chats are
not stored anywhere.
