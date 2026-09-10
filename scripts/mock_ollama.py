#!/usr/bin/env python3
"""Mock Ollama server — speaks enough of the Ollama HTTP API on
127.0.0.1:11434 to run the whole LocalMind stack (chat, RAG, agent, UI,
OpenAI API) with a tiny deterministic fake model and no downloads.

State machine for /api/chat:
  - agent system prompt present, first turn  → THOUGHT + ACTION (calls `calc`)
  - agent system prompt present, OBSERVATION → FINAL answer
  - grounded RAG prompt (CONTEXT:/QUESTION:) → answer with citation [1]
  - otherwise                                 → echo of the user message

Start with:  python scripts/mock_ollama.py [port]
"""
from __future__ import annotations

import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = ROOT / "data" / "config.json"
DIM = 384


def current_model() -> str:
    try:
        return json.loads(CFG.read_text()).get("model", "qwen2.5:3b-instruct-q4_K_M")
    except Exception:
        return "qwen2.5:3b-instruct-q4_K_M"


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code: int = 200) -> None:
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def log_message(self, *a) -> None:  # quiet
        pass

    def do_GET(self) -> None:
        if self.path.startswith("/api/tags"):
            self._json({"models": [{"name": current_model(), "size": 1}]})
        else:
            self._json({"error": f"not found: {self.path}"}, 404)

    def do_POST(self) -> None:
        if self.path == "/api/pull":
            self._json({"status": "success"})
            return
        if self.path == "/api/embed":
            body = self._body()
            texts = body.get("input", []) or []
            # deterministic, length-consistent vectors (semantics come from BM25
            # in the hybrid store, so retrieval still works with the mock)
            vec = [1.0 / (DIM ** 0.5)] * DIM
            self._json({"embeddings": [vec for _ in texts]})
            return
        if self.path == "/api/chat":
            body = self._body()
            msgs = body.get("messages", [])
            sys_txt = msgs[0]["content"] if msgs and msgs[0]["role"] == "system" else ""
            last = msgs[-1]["content"] if msgs else ""
            reply = self._compose(sys_txt, last)
            self._stream_chat(reply)
            return
        self._json({"error": f"not found: {self.path}"}, 404)

    def _compose(self, sys_txt: str, last: str) -> str:
        if "AVAILABLE TOOLS" in sys_txt:
            if last.startswith("OBSERVATION:"):
                # extract the computed number if calc was used
                num = None
                for tok in last.split():
                    if tok.replace(".", "", 1).isdigit():
                        num = tok
                        break
                return (f"THOUGHT: The observation gives me the computed value.\n"
                        f"FINAL: The computed result is {num or 'available in the observation above'}.")
            return ('THOUGHT: I need to compute this with the calc tool.\n'
                    'ACTION: {"tool": "calc", "args": {"expression": "6*7"}}')
        if "answer strictly from the provided CONTEXT" in sys_txt:
            # echo a real line from the retrieved context so tests can verify
            # that retrieval actually fed the right document to the model
            lines = [l for l in last.splitlines() if l.strip()]
            first_body = ""
            for i, l in enumerate(lines):
                if l.startswith("[") and "source:" in l and i + 1 < len(lines):
                    first_body = lines[i + 1]
                    break
            return (f"Based on the provided context [1]: {first_body[:160]}"
                    if first_body else "Answering strictly from the context [1].")
        if "search queries" in sys_txt:
            return last  # query-rewrite passthrough
        if "compress conversations" in sys_txt:
            return "Conversation continued; key facts preserved."
        return f"[mock] You said: {last[:120]}"

    def _stream_chat(self, reply: str) -> None:
        # http.server speaks HTTP/1.0: no Content-Length → body ends at close,
        # which urllib handles correctly for NDJSON streaming.
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        model = current_model()
        for i in range(0, len(reply), 8):
            chunk = {
                "model": model,
                "created_at": "2026-01-01T00:00:00Z",
                "message": {"role": "assistant", "content": reply[i:i + 8]},
                "done": False,
            }
            self._send_ndjson(chunk)
        self._send_ndjson({
            "model": model,
            "created_at": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "content": ""},
            "done": True,
            "done_reason": "stop",
        })

    def _send_ndjson(self, obj: dict) -> None:
        raw = (json.dumps(obj) + "\n").encode()
        self.wfile.write(raw)
        self.wfile.flush()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11434
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[mock-ollama] listening on http://127.0.0.1:{port}  (model: {current_model()})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
