"""Turn a folder (or single file / raw text) into indexed chunks."""
from __future__ import annotations

import hashlib, re
from pathlib import Path

from .config import Settings
from .store import HybridStore

TEXT_EXT = {".txt", ".md", ".markdown", ".rst", ".py", ".js", ".ts", ".tsx", ".jsx",
            ".java", ".c", ".h", ".cpp", ".hpp", ".rs", ".go", ".rb", ".php", ".sh",
            ".sql", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".json", ".csv", ".tex", ".log"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
             ".mypy_cache", ".pytest_cache", "data", ".idea", ".next", "target"}


def read_file(p: Path) -> str:
    ext = p.suffix.lower()
    try:
        if ext == ".pdf":
            from pypdf import PdfReader
            return "\n\n".join((pg.extract_text() or "") for pg in PdfReader(str(p)).pages)
        if ext == ".docx":
            import docx
            return "\n".join(par.text for par in docx.Document(str(p)).paragraphs)
        if ext in {".html", ".htm"}:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(p.read_text(encoding="utf-8", errors="ignore"), "html.parser")
            for t in soup(["script", "style"]):
                t.decompose()
            return soup.get_text("\n")
        if ext in TEXT_EXT:
            return p.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        print(f"  ! {p.name}: {e}")
    return ""


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return []
    paras, cur, out = re.split(r"\n\s*\n", text), "", []
    for para in paras:
        para = para.strip()
        if not para:
            continue
        if len(para) > size:                      # hard-split giant blocks
            if cur:
                out.append(cur); cur = ""
            for i in range(0, len(para), size - overlap):
                out.append(para[i:i + size])
            continue
        if len(cur) + len(para) + 2 <= size:
            cur = f"{cur}\n\n{para}" if cur else para
        else:
            out.append(cur)
            tail = cur[-overlap:] if overlap else ""
            cur = f"{tail}\n\n{para}" if tail else para
    if cur:
        out.append(cur)
    return [c.strip() for c in out if len(c.strip()) > 40]


def ingest_path(target: str | Path, store: HybridStore, s: Settings) -> dict:
    target = Path(target).expanduser().resolve()
    files = ([target] if target.is_file()
             else [p for p in target.rglob("*")
                   if p.is_file() and not set(p.parts) & SKIP_DIRS
                   and (p.suffix.lower() in TEXT_EXT or p.suffix.lower() in
                        {".pdf", ".docx", ".html", ".htm"})])
    total_chunks, done = 0, 0
    for p in files:
        if p.stat().st_size > 25_000_000:
            continue
        txt = read_file(p)
        if not txt.strip():
            continue
        src = str(p)
        store.delete_source(src)                          # re-ingest cleanly
        recs = []
        for i, c in enumerate(chunk_text(txt, s.chunk_chars, s.chunk_overlap)):
            cid = hashlib.sha1(f"{src}:{i}:{c[:64]}".encode()).hexdigest()[:20]
            recs.append({"id": cid, "text": c,
                         "meta": {"source": src, "name": p.name, "chunk": i}})
        if recs:
            store.upsert(recs)
            total_chunks += len(recs); done += 1
            print(f"  ✓ {p.name:<44} {len(recs):>4} chunks")
    return {"files": done, "chunks": total_chunks, **store.stats()}


def ingest_text(text: str, name: str, store: HybridStore, s: Settings) -> int:
    src = f"inline://{name}"
    store.delete_source(src)
    recs = [{"id": hashlib.sha1(f"{src}:{i}".encode()).hexdigest()[:20],
             "text": c, "meta": {"source": src, "name": name, "chunk": i}}
            for i, c in enumerate(chunk_text(text, s.chunk_chars, s.chunk_overlap))]
    store.upsert(recs)
    return len(recs)
