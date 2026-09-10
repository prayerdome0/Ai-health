"""Web chat UI served by Python's standard library only — no Flask, no
FastAPI, nothing to install. POST /api/chat runs the network and returns
the reply as JSON.

    python main.py ui            ->  http://localhost:8000
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .chat import generate_reply
from .config import UI_PATH

_state: dict = {}
_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    server_version = "Pulse/1.0"

    # ---------------------------------------------------------- helpers
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def log_message(self, *_a) -> None:   # quiet
        pass

    # ----------------------------------------------------------- routes
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            html = UI_PATH.read_bytes()
            self._send(200, html, "text/html; charset=utf-8")
        elif self.path == "/api/health":
            self._json({"ok": True, "params": _state["model"].n_params,
                        "backend": _state["model"].ops.name,
                        "block_size": _state["model"].cfg.block_size})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/api/chat":
            self._json({"error": "not found"}, 404)
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
            message = str(req.get("message", "")).strip()
            history = [h for h in req.get("history", []) if isinstance(h, dict)]
            temperature = float(req.get("temperature", _state.get("temperature", 0.8)))
            if not message:
                self._json({"error": "empty message"}, 400)
                return
            with _lock:   # one KV cache — serialize requests
                reply = generate_reply(_state["model"], history, message,
                                       temperature=max(0.05, min(temperature, 1.5)))
            self._json({"reply": reply})
        except BrokenPipeError:
            pass
        except Exception as e:                      # noqa: BLE001
            try:
                self._json({"error": f"{type(e).__name__}: {e}"}, 500)
            except Exception:
                pass


def serve(host: str = "0.0.0.0", port: int = 8000) -> None:
    from .model import load_model
    print("loading model …")
    _state["model"] = load_model()
    m = _state["model"]
    print(f"ready · {m.n_params:,} params · backend {m.ops.name} · "
          f"ctx {m.cfg.block_size} chars")
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"\n➜  Pulse chat UI:  http://{host}:{port}\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
