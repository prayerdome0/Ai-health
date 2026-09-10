# LocalMind

A complete, runnable local AI system. Auto-detects your hardware, picks the
right model, and gives you chat + hybrid RAG + a tool-using agent + memory +
web UI + an OpenAI-compatible server. **Zero API keys, zero cloud calls at
runtime.**

```
.
├── requirements.txt
├── main.py                 # single entrypoint: doctor | pull | chat | ui | ingest | ask | agent | serve
├── core/
│   ├── __init__.py
│   ├── config.py           # hardware detection + auto model selection + settings
│   ├── llm.py              # backend abstraction: Ollama / llama.cpp / Transformers
│   ├── store.py            # hybrid vector + BM25 store (numpy, no external DB)
│   ├── ingest.py           # PDF/MD/code/txt/docx → chunks → index
│   ├── rag.py              # retrieve → rerank → grounded answer w/ citations
│   ├── tools.py            # jailed filesystem, python, shell, calc, memory
│   ├── agent.py            # ReAct loop with robust JSON parsing
│   └── memory.py           # rolling summary + long-term fact store
├── ui/app.py               # Gradio chat UI (streaming, RAG/agent toggles)
├── server/openai_api.py    # /v1/chat/completions, drop-in OpenAI-compatible
├── firebase-config.json    # public Firebase web config (kept from the old app)
└── scripts/
    ├── mock_ollama.py      # fake local Ollama API — try the whole system with no model download
    └── smoke.py            # end-to-end self-test (chat, RAG, agent, API)
```

## Quickstart

```bash
pip install -r requirements.txt

# 1. What can my machine run?
python main.py doctor

# 2. Get the model (auto-picked for your hardware)
curl -fsSL https://ollama.com/install.sh | sh   # if doctor says Ollama missing
python main.py pull

# 3. Use it
python main.py chat                     # terminal
python main.py ui                       # http://127.0.0.1:7860
python main.py ingest ~/Documents       # index your files
python main.py ask "what's our rollback procedure?"
python main.py agent "count lines of python in ./workspace and plot a histogram"
python main.py serve                    # OpenAI-compatible at :8000/v1
```

Point **any** OpenAI client at it — Continue.dev, Cursor, LangChain, curl:

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"local-rag","messages":[{"role":"user","content":"summarize my docs on auth"}]}'
```

### No GPU / no model yet? Try the mock backend

`scripts/mock_ollama.py` speaks the Ollama HTTP protocol on
`127.0.0.1:11434` with a tiny deterministic model. With it running, every
command above works immediately (chat, RAG, agent, UI, API) — useful for
developing the app before downloading real weights, or for CI:

```bash
python scripts/mock_ollama.py &        # terminal 1
python main.py ui                      # terminal 2
python scripts/smoke.py                # end-to-end self-test (starts its own mock)
```

## What makes it "powerful" (design notes)

| Decision | Why it beats the naive version |
|---|---|
| **RRF hybrid retrieval** (dense + BM25) | Dense misses exact identifiers/error codes; BM25 misses paraphrase. Fusing them typically lifts recall 15–30% over either alone. |
| **Cross-encoder rerank** | Retrieve 30 → rerank → keep 6. Usually the single biggest RAG quality jump for a few hundred ms. |
| **Query expansion** | One cheap LLM rewrite fixes vocabulary mismatch between your question and the document's jargon. |
| **numpy store, no DB** | No Chroma/SQLite version hell, no daemon. Handles ~100k chunks comfortably in RAM. Swap to FAISS/HNSW only when you exceed that. |
| **Brace-balanced JSON parser** | Small models emit prose around their JSON and nest braces inside strings. Regex fails; this doesn't. |
| **`stop=["OBSERVATION:"]`** | Stops the model hallucinating its own tool results — the #1 local-agent failure mode. |
| **Two-tier memory** | Rolling LLM summary keeps context bounded; the fact store is vector-searched so old details resurface on demand. |
| **Workspace jail + denylist** | Path resolution check blocks `../` escapes; regex blocks the classic destructive commands. |
| **Backend abstraction** | Same code runs on Ollama, llama.cpp, or Transformers — swap `backend` in `data/config.json`. |

**Tuning knobs:**

```bash
python main.py config --set final_k=10 retrieve_k=50 temperature=0.3
python main.py config --set model=qwen2.5-coder:32b   # coding specialist
python main.py config --set use_reranker=false        # faster, slightly worse
python main.py config --set allow_shell=false         # lock down the agent
```

## Firebase configuration

`firebase-config.json` holds the public web-app configuration for Firebase
project **`ai-health-d2c5b`** (kept when the previous app was removed). These
are client-safe identifiers, not credentials — access is controlled by
Firestore Security Rules / Firebase Auth. A service-account private key is
**not** included and should never be committed.

## Deployment

LocalMind itself is **local-first** — the chat, RAG and agent run as
long-running Python processes on your machine, which Vercel's serverless
platform cannot host. The `site/` folder is a static landing page that
Vercel deploys without a build step (`vercel.json` sets `buildCommand: null`
and serves `site/`), so the repo's connected Vercel project keeps passing
deployments and PR checks. To host the actual app on a server, use a
platform that runs persistent Python processes (Render, Railway, Fly.io,
or any VPS) — add a `Dockerfile` or run `python main.py ui` directly.

## Natural next steps

- **Voice** — faster-whisper STT + Piper TTS, full offline duplex loop
- **Vision** — swap in Qwen2.5-VL / Llama-3.2-Vision for screenshots, diagrams, scanned PDFs
- **QLoRA fine-tune pipeline** — harvest good conversations from this system → train an adapter → hot-swap it
- **Speculative decoding** — 2–3× throughput using a 0.5B draft model
- **Multi-agent** — planner/researcher/critic with a shared blackboard
- **GraphRAG** — entity-relation graph over your corpus for multi-hop questions
