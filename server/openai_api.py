"""OpenAI-compatible endpoint so any existing client/IDE plugin works — locally.
Run: python main.py serve      →  http://127.0.0.1:8000/v1   (api_key: anything)"""
from __future__ import annotations

import json, sys, time, uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.config import Settings
from core.llm import get_llm
from core.rag import rag_stream
from core.store import HybridStore

S = Settings.load()
LLM_ = get_llm(S)
STORE = HybridStore("kb", S)
app = FastAPI(title="LocalMind")


class Msg(BaseModel):
    role: str
    content: str


class Req(BaseModel):
    model: str | None = None
    messages: list[Msg]
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None


@app.get("/v1/models")
def models():
    return {"object": "list",
            "data": [{"id": S.model, "object": "model", "owned_by": "local"},
                     {"id": S.model + "-rag", "object": "model", "owned_by": "local"}]}


@app.post("/v1/chat/completions")
def chat(req: Req):
    msgs = [m.model_dump() for m in req.messages]
    kw = {k: v for k, v in {"temperature": req.temperature,
                            "max_tokens": req.max_tokens}.items() if v is not None}
    rag = bool(req.model and req.model.endswith("-rag"))
    gen = (rag_stream(msgs[-1]["content"], LLM_, STORE, S) if rag
           else LLM_.stream(msgs, **kw))
    cid, created = f"chatcmpl-{uuid.uuid4().hex[:24]}", int(time.time())

    if not req.stream:
        text = "".join(gen)
        return {"id": cid, "object": "chat.completion", "created": created,
                "model": req.model or S.model,
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": text}}],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}

    def sse():
        for piece in gen:
            yield "data: " + json.dumps({
                "id": cid, "object": "chat.completion.chunk", "created": created,
                "model": req.model or S.model,
                "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]
            }) + "\n\n"
        yield "data: " + json.dumps({
            "id": cid, "object": "chat.completion.chunk", "created": created,
            "model": req.model or S.model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")
