"""Hybrid retrieval: dense vectors + Okapi BM25, fused with RRF.
No database. Just numpy + jsonl. Survives restarts, supports incremental upsert."""
from __future__ import annotations

import json, math, re, threading
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from .config import INDEX_DIR, Settings

_TOKEN = re.compile(r"[a-z0-9_]+")
_STOP = set("""a an and are as at be by for from has have how i in is it its of on or that the
this to was were what when where which who will with you your""".split())


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1]


# ------------------------------------------------------------- embedders
class STEmbedder:
    """sentence-transformers, fully offline after first download."""
    def __init__(self, name: str):
        from sentence_transformers import SentenceTransformer
        self.m = SentenceTransformer(name)
        self.dim = self.m.get_sentence_embedding_dimension()
        self.qprefix = ("Represent this sentence for searching relevant passages: "
                        if "bge" in name.lower() and "m3" not in name.lower() else "")

    def encode(self, texts: list[str], is_query: bool = False) -> np.ndarray:
        if is_query and self.qprefix:
            texts = [self.qprefix + t for t in texts]
        v = self.m.encode(texts, normalize_embeddings=True,
                          batch_size=32, show_progress_bar=len(texts) > 256)
        return np.asarray(v, dtype=np.float32)


class OllamaEmbedder:
    def __init__(self, s: Settings, name: str = "nomic-embed-text"):
        from .llm import OllamaLLM
        self.cli, self.name = OllamaLLM(s), name
        self.dim = len(self.cli.embed(["probe"], name)[0])

    def encode(self, texts: list[str], is_query: bool = False) -> np.ndarray:
        out: list[list[float]] = []
        for i in range(0, len(texts), 64):
            out.extend(self.cli.embed(texts[i:i + 64], self.name))
        v = np.asarray(out, dtype=np.float32)
        return v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-9)


def get_embedder(s: Settings):
    try:
        return STEmbedder(s.embed_model)
    except Exception as e:
        print(f"[store] sentence-transformers unavailable ({e}); trying Ollama embeddings")
    try:
        return OllamaEmbedder(s)
    except Exception as e:
        print(f"[store] no dense embedder ({e}) → BM25-only mode (still works well for keywords)")
        return None


_RERANKER = {}


def get_reranker(name: str):
    if name in _RERANKER:
        return _RERANKER[name]
    try:
        from sentence_transformers import CrossEncoder
        _RERANKER[name] = CrossEncoder(name)
    except Exception:
        _RERANKER[name] = None
    return _RERANKER[name]


# ------------------------------------------------------------------ store
class HybridStore:
    def __init__(self, name: str, settings: Settings, embedder=None):
        self.name, self.s = name, settings
        self.dir = Path(INDEX_DIR); self.dir.mkdir(parents=True, exist_ok=True)
        self.docs: list[dict] = []              # {id, text, meta}
        self.vecs: np.ndarray | None = None
        self._id2i: dict[str, int] = {}
        self._lock = threading.Lock()
        self._embedder = embedder if embedder is not None else get_embedder(settings)
        self._bm25_ready = False
        self.load()

    # -------- paths
    @property
    def _p_docs(self): return self.dir / f"{self.name}.jsonl"
    @property
    def _p_vecs(self): return self.dir / f"{self.name}.npy"

    # -------- persistence
    def load(self) -> None:
        if self._p_docs.exists():
            self.docs = [json.loads(l) for l in self._p_docs.read_text(encoding="utf-8").splitlines() if l.strip()]
            self._id2i = {d["id"]: i for i, d in enumerate(self.docs)}
        if self._p_vecs.exists():
            v = np.load(self._p_vecs)
            self.vecs = v if len(v) == len(self.docs) else None
        self._bm25_ready = False

    def save(self) -> None:
        with self._p_docs.open("w", encoding="utf-8") as f:
            for d in self.docs:
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
        if self.vecs is not None:
            np.save(self._p_vecs, self.vecs)

    # -------- BM25
    def _build_bm25(self) -> None:
        self._toks = [tokenize(d["text"]) for d in self.docs]
        self._len = np.array([len(t) or 1 for t in self._toks], dtype=np.float32)
        self._avg = float(self._len.mean()) if len(self._len) else 1.0
        self._tf = [Counter(t) for t in self._toks]
        df: dict[str, int] = defaultdict(int)
        for t in self._toks:
            for w in set(t):
                df[w] += 1
        N = max(len(self.docs), 1)
        self._idf = {w: math.log(1 + (N - c + 0.5) / (c + 0.5)) for w, c in df.items()}
        self._post: dict[str, list[int]] = defaultdict(list)
        for i, t in enumerate(self._toks):
            for w in set(t):
                self._post[w].append(i)
        self._bm25_ready = True

    def _bm25(self, query: str, k1: float = 1.5, b: float = 0.75) -> np.ndarray:
        if not self._bm25_ready:
            self._build_bm25()
        scores = np.zeros(len(self.docs), dtype=np.float32)
        for w in tokenize(query):
            idf = self._idf.get(w)
            if idf is None:
                continue
            for i in self._post[w]:
                f = self._tf[i][w]
                scores[i] += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * self._len[i] / self._avg))
        return scores

    # -------- write
    def upsert(self, records: list[dict]) -> int:
        """records: [{'id':str,'text':str,'meta':dict}]"""
        if not records:
            return 0
        with self._lock:
            new = [r for r in records if r["id"] not in self._id2i]
            upd = [r for r in records if r["id"] in self._id2i]
            for r in upd:
                self.docs[self._id2i[r["id"]]] = r      # text change → re-embed below
            if self._embedder is not None:
                texts = [r["text"] for r in records]
                emb = self._embedder.encode(texts)
                if self.vecs is None:
                    self.vecs = np.zeros((0, emb.shape[1]), dtype=np.float32)
                for r, e in zip(records, emb):
                    if r["id"] in self._id2i:
                        self.vecs[self._id2i[r["id"]]] = e
                add = np.stack([e for r, e in zip(records, emb) if r["id"] not in self._id2i]) \
                    if new else np.zeros((0, emb.shape[1]), dtype=np.float32)
                self.vecs = np.vstack([self.vecs, add]) if len(add) else self.vecs
            for r in new:
                self._id2i[r["id"]] = len(self.docs)
                self.docs.append(r)
            self._bm25_ready = False
            self.save()
        return len(new)

    def delete_source(self, src: str) -> int:
        keep = [i for i, d in enumerate(self.docs) if d.get("meta", {}).get("source") != src]
        removed = len(self.docs) - len(keep)
        if removed:
            self.docs = [self.docs[i] for i in keep]
            if self.vecs is not None:
                self.vecs = self.vecs[keep]
            self._id2i = {d["id"]: i for i, d in enumerate(self.docs)}
            self._bm25_ready = False
            self.save()
        return removed

    def clear(self) -> None:
        self.docs, self.vecs, self._id2i, self._bm25_ready = [], None, {}, False
        for p in (self._p_docs, self._p_vecs):
            p.unlink(missing_ok=True)

    # -------- read
    def search(self, query: str, k: int | None = None, rerank: bool | None = None) -> list[dict]:
        if not self.docs:
            return []
        k = k or self.s.final_k
        pool = max(self.s.retrieve_k, k * 4)

        ranks: list[list[int]] = []
        if self.vecs is not None and self._embedder is not None and len(self.vecs) == len(self.docs):
            q = self._embedder.encode([query], is_query=True)[0]
            sims = self.vecs @ q
            ranks.append(list(np.argsort(-sims)[:pool]))
        bm = self._bm25(query)
        if bm.any():
            ranks.append(list(np.argsort(-bm)[:pool]))
        if not ranks:
            return []

        # Reciprocal Rank Fusion
        fused: dict[int, float] = defaultdict(float)
        for rl in ranks:
            for rank, idx in enumerate(rl):
                fused[int(idx)] += 1.0 / (60 + rank)
        cand = [i for i, _ in sorted(fused.items(), key=lambda kv: -kv[1])[:pool]]

        use_rr = self.s.use_reranker if rerank is None else rerank
        if use_rr and len(cand) > k:
            rr = get_reranker(self.s.rerank_model)
            if rr is not None:
                pairs = [(query, self.docs[i]["text"]) for i in cand]
                sc = rr.predict(pairs, batch_size=16, show_progress_bar=False)
                cand = [c for _, c in sorted(zip(sc, cand), key=lambda t: -t[0])]

        out = []
        for i in cand[:k]:
            d = self.docs[i]
            out.append({"id": d["id"], "text": d["text"],
                        "meta": d.get("meta", {}), "score": float(fused[i])})
        return out

    def stats(self) -> dict:
        srcs = {d.get("meta", {}).get("source", "?") for d in self.docs}
        return {"collection": self.name, "chunks": len(self.docs), "sources": len(srcs),
                "dense": self.vecs is not None,
                "dim": int(self.vecs.shape[1]) if self.vecs is not None else 0,
                "chars": sum(len(d["text"]) for d in self.docs)}
