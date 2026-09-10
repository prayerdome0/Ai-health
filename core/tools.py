"""Tools the agent can call. Filesystem access is jailed to ./workspace."""
from __future__ import annotations

import json, math, os, re, shutil, subprocess, sys, textwrap
from pathlib import Path

from .config import WORKSPACE, Settings

DANGEROUS = [
    r"\brm\s+-rf\s+/(?!\w)", r"\bmkfs\b", r"\bdd\s+if=", r":\(\)\{", r"\bshutdown\b",
    r"\breboot\b", r"\bchown\s+-R\s+/", r"\bchmod\s+-R\s+777\s+/", r"\buserdel\b",
    r">\s*/dev/sd", r"\bformat\s+[a-z]:", r"\bdel\s+/f\s+/s\s+/q\s+[a-z]:\\",
    r"curl[^|]*\|\s*(ba)?sh", r"wget[^|]*\|\s*(ba)?sh",
]


def _safe(p: str) -> Path:
    full = (WORKSPACE / p).resolve() if not os.path.isabs(p) else Path(p).resolve()
    if not str(full).startswith(str(WORKSPACE.resolve())):
        raise PermissionError(f"path escapes workspace sandbox: {full}")
    return full


def _clip(s: str, n: int = 6000) -> str:
    return s if len(s) <= n else s[:n] + f"\n…[truncated, {len(s)-n} more chars]"


class Toolbox:
    def __init__(self, s: Settings, store=None, memory=None):
        self.s, self.store, self.memory = s, store, memory

    # ------------------------------------------------------------- tools
    def python(self, code: str) -> str:
        """Run Python in a subprocess inside ./workspace."""
        code = textwrap.dedent(code)
        f = WORKSPACE / "_scratch.py"
        f.write_text(code, encoding="utf-8")
        r = subprocess.run([sys.executable, str(f)], capture_output=True, text=True,
                           timeout=self.s.tool_timeout, cwd=WORKSPACE)
        out = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr else "")
        return _clip(out.strip() or f"(no output, exit={r.returncode})")

    def shell(self, command: str) -> str:
        if not self.s.allow_shell:
            return "ERROR: shell disabled (set allow_shell=true in data/config.json)"
        for pat in DANGEROUS:
            if re.search(pat, command, re.I):
                return f"REFUSED: command matches destructive pattern /{pat}/"
        r = subprocess.run(command, shell=True, capture_output=True, text=True,
                           timeout=self.s.tool_timeout, cwd=WORKSPACE)
        out = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr else "")
        return _clip(out.strip() or f"(no output, exit={r.returncode})")

    def read_file(self, path: str) -> str:
        return _clip(_safe(path).read_text(encoding="utf-8", errors="ignore"), 12000)

    def write_file(self, path: str, content: str) -> str:
        p = _safe(path); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"wrote {len(content)} chars → {p.relative_to(WORKSPACE)}"

    def list_files(self, path: str = ".") -> str:
        base = _safe(path)
        if not base.exists():
            return "no such path"
        rows = []
        for p in sorted(base.rglob("*"))[:400]:
            rel = p.relative_to(WORKSPACE)
            rows.append(f"{'d' if p.is_dir() else '-'} {p.stat().st_size:>9}  {rel}")
        return _clip("\n".join(rows) or "(empty)")

    def calc(self, expression: str) -> str:
        env = {k: getattr(math, k) for k in dir(math) if not k.startswith("_")}
        env.update(abs=abs, round=round, min=min, max=max, sum=sum, pow=pow, len=len)
        try:
            return str(eval(expression, {"__builtins__": {}}, env))
        except Exception as e:
            return f"ERROR: {e}"

    def search_docs(self, query: str) -> str:
        if self.store is None or not self.store.docs:
            return "knowledge base is empty — ingest documents first"
        hits = self.store.search(query, k=5)
        return _clip("\n\n".join(
            f"[{i}] {h['meta'].get('name','?')}\n{h['text'][:900]}"
            for i, h in enumerate(hits, 1)))

    def remember(self, fact: str) -> str:
        if self.memory is None:
            return "memory disabled"
        self.memory.remember(fact)
        return "stored in long-term memory"

    def recall(self, query: str) -> str:
        if self.memory is None:
            return "memory disabled"
        return _clip("\n".join(f"- {f}" for f in self.memory.recall(query)) or "(nothing recalled)")

    # ------------------------------------------------------------ registry
    def registry(self) -> dict:
        return {
            "python":      (self.python,      {"code": "python source to execute"},
                            "Run Python. Print results to stdout. Best for math, parsing, data."),
            "shell":       (self.shell,       {"command": "shell command"},
                            "Run a shell command inside ./workspace."),
            "read_file":   (self.read_file,   {"path": "relative path"}, "Read a file."),
            "write_file":  (self.write_file,  {"path": "relative path", "content": "text"},
                            "Create/overwrite a file in ./workspace."),
            "list_files":  (self.list_files,  {"path": "relative dir (default '.')"},
                            "List files in the workspace."),
            "calc":        (self.calc,        {"expression": "math expression"},
                            "Fast arithmetic without spawning Python."),
            "search_docs": (self.search_docs, {"query": "search text"},
                            "Search the indexed document knowledge base."),
            "remember":    (self.remember,    {"fact": "durable fact about the user/project"},
                            "Save a fact to long-term memory."),
            "recall":      (self.recall,      {"query": "what to look up"},
                            "Look up facts in long-term memory."),
        }

    def spec(self) -> str:
        out = []
        for name, (_fn, args, desc) in self.registry().items():
            a = ", ".join(f'"{k}": <{v}>' for k, v in args.items())
            out.append(f'- {name}: {desc}\n  args: {{{a}}}')
        return "\n".join(out)

    def call(self, name: str, args: dict) -> str:
        reg = self.registry()
        if name not in reg:
            return f"ERROR: unknown tool '{name}'. Available: {', '.join(reg)}"
        fn, spec, _ = reg[name]
        try:
            if isinstance(args, str):                       # model sent a bare string
                args = {list(spec)[0]: args}
            args = {k: v for k, v in args.items() if k in spec}
            return fn(**args)
        except subprocess.TimeoutExpired:
            return f"ERROR: tool '{name}' timed out after {self.s.tool_timeout}s"
        except Exception as e:
            return f"ERROR in {name}: {type(e).__name__}: {e}"
