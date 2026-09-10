"""Hardware detection, automatic model selection, persisted settings."""
from __future__ import annotations

import ctypes, json, os, platform, shutil, subprocess, sys
from dataclasses import dataclass, asdict
from pathlib import Path

ROOT      = Path(__file__).resolve().parent.parent
DATA      = ROOT / "data"
WORKSPACE = ROOT / "workspace"      # the ONLY dir the agent may touch
INDEX_DIR = DATA / "index"
CFG_PATH  = DATA / "config.json"
for _p in (DATA, WORKSPACE, INDEX_DIR):
    _p.mkdir(parents=True, exist_ok=True)


# ----------------------------------------------------------------- hardware
def total_ram_gb() -> float:
    try:
        import psutil
        return psutil.virtual_memory().total / 1e9
    except Exception:
        pass
    try:
        if hasattr(os, "sysconf") and "SC_PHYS_PAGES" in os.sysconf_names:
            return os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE") / 1e9
    except Exception:
        pass
    if sys.platform == "darwin":
        try:
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"])) / 1e9
        except Exception:
            pass
    if os.name == "nt":
        class _MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        st = _MS(); st.dwLength = ctypes.sizeof(_MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
        return st.ullTotalPhys / 1e9
    return 8.0


def gpu_info() -> tuple[str, float]:
    """Returns (device_name, usable_vram_gb)."""
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=name,memory.total",
                 "--format=csv,noheader,nounits"], text=True, timeout=10)
            names, tot = [], 0.0
            for line in out.strip().splitlines():
                n, m = line.split(",")
                names.append(n.strip()); tot += float(m) / 1024
            if names:
                return " + ".join(names), round(tot, 1)
        except Exception:
            pass
    if sys.platform == "darwin" and platform.machine() == "arm64":
        # unified memory: ~70% is safely allocatable to the GPU
        return f"Apple Silicon ({platform.machine()}) unified", round(total_ram_gb() * 0.70, 1)
    if shutil.which("rocm-smi"):
        return "AMD ROCm GPU", 0.0     # unknown size; treat conservatively
    return "CPU only", 0.0


# --------------------------------------------------------- model tier table
# (min_usable_gb, ollama_tag, gguf_repo, gguf_glob, hf_id, label)
TIERS = [
    (44.0, "llama3.3:70b-instruct-q4_K_M",
           "bartowski/Llama-3.3-70B-Instruct-GGUF", "*Q4_K_M*.gguf",
           "meta-llama/Llama-3.3-70B-Instruct", "70B  — frontier-class open weights"),
    (19.0, "qwen2.5:32b-instruct-q4_K_M",
           "bartowski/Qwen2.5-32B-Instruct-GGUF", "*Q4_K_M.gguf",
           "Qwen/Qwen2.5-32B-Instruct", "32B  — very strong reasoning + code"),
    (10.0, "qwen2.5:14b-instruct-q4_K_M",
           "bartowski/Qwen2.5-14B-Instruct-GGUF", "*Q4_K_M.gguf",
           "Qwen/Qwen2.5-14B-Instruct", "14B  — best quality/size ratio"),
    (5.5,  "qwen2.5:7b-instruct-q4_K_M",
           "bartowski/Qwen2.5-7B-Instruct-GGUF", "*Q4_K_M.gguf",
           "Qwen/Qwen2.5-7B-Instruct", "7B   — fast and solid"),
    (0.0,  "qwen2.5:3b-instruct-q4_K_M",
           "bartowski/Qwen2.5-3B-Instruct-GGUF", "*Q4_K_M.gguf",
           "Qwen/Qwen2.5-3B-Instruct", "3B   — runs anywhere"),
]


def pick_tier(usable_gb: float):
    for t in TIERS:
        if usable_gb >= t[0]:
            return t
    return TIERS[-1]


def usable_gb() -> float:
    _, vram = gpu_info()
    ram = total_ram_gb()
    # GPU wins if it can hold a real model; otherwise CPU RAM minus OS headroom
    return max(vram, max(ram - 4.0, 1.0))


def ollama_up(host: str = "http://127.0.0.1:11434") -> bool:
    import urllib.request
    try:
        urllib.request.urlopen(host + "/api/tags", timeout=1.5).read()
        return True
    except Exception:
        return False


def ollama_models(host: str = "http://127.0.0.1:11434") -> list[str]:
    import urllib.request
    try:
        raw = urllib.request.urlopen(host + "/api/tags", timeout=3).read()
        return [m["name"] for m in json.loads(raw).get("models", [])]
    except Exception:
        return []


def detect_backend() -> str:
    if ollama_up():
        return "ollama"
    try:
        import llama_cpp  # noqa
        return "llamacpp"
    except Exception:
        pass
    try:
        import torch, transformers  # noqa
        return "transformers"
    except Exception:
        pass
    return "ollama"   # nothing installed → tell the user to install Ollama


# -------------------------------------------------------------- settings
@dataclass
class Settings:
    backend: str = ""
    model: str = ""
    gguf_repo: str = ""
    gguf_file: str = ""
    hf_id: str = ""
    ollama_host: str = "http://127.0.0.1:11434"

    n_ctx: int = 16384
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 2048

    embed_model: str = "BAAI/bge-small-en-v1.5"
    rerank_model: str = "BAAI/bge-reranker-base"
    use_reranker: bool = True

    retrieve_k: int = 30
    final_k: int = 6
    chunk_chars: int = 1100
    chunk_overlap: int = 180

    allow_shell: bool = True
    tool_timeout: int = 30
    agent_max_steps: int = 10

    system_prompt: str = (
        "You are LocalMind, a highly capable assistant running entirely on the user's "
        "own hardware. Be direct, precise and technical. Prefer concrete code and "
        "concrete numbers over vague advice. If you are unsure, say so plainly rather "
        "than inventing facts."
    )

    # ---------------------------------------------------------------
    @classmethod
    def load(cls) -> "Settings":
        s = cls()
        if CFG_PATH.exists():
            try:
                for k, v in json.loads(CFG_PATH.read_text()).items():
                    if hasattr(s, k):
                        setattr(s, k, v)
            except Exception:
                pass
        if not s.backend:
            s.backend = detect_backend()
        if not s.model:
            tier = pick_tier(usable_gb())
            s.model, s.gguf_repo, s.gguf_file, s.hf_id = tier[1], tier[2], tier[3], tier[4]
            # shrink context on small machines so KV cache fits
            g = usable_gb()
            s.n_ctx = 32768 if g >= 24 else 16384 if g >= 12 else 8192 if g >= 6 else 4096
            s.save()
        return s

    def save(self) -> None:
        CFG_PATH.write_text(json.dumps(asdict(self), indent=2))


def report() -> str:
    dev, vram = gpu_info()
    ram, g = total_ram_gb(), usable_gb()
    tier = pick_tier(g)
    lines = [
        "─" * 62,
        f" OS          : {platform.system()} {platform.release()} ({platform.machine()})",
        f" Python      : {sys.version.split()[0]}",
        f" CPU cores   : {os.cpu_count()}",
        f" System RAM  : {ram:.1f} GB",
        f" GPU         : {dev}" + (f"  |  {vram:.1f} GB" if vram else ""),
        f" Usable for  : {g:.1f} GB",
        "─" * 62,
        f" Recommended : {tier[5]}",
        f"   ollama    : {tier[1]}",
        f"   gguf      : {tier[2]}",
        f"   hf        : {tier[4]}",
        "─" * 62,
        f" Backend     : {detect_backend()}",
        f" Ollama      : {'running ✔' if ollama_up() else 'not detected ✘'}",
    ]
    if ollama_up():
        got = ollama_models()
        lines.append(f" Local models: {', '.join(got) if got else '(none pulled yet)'}")
    lines.append("─" * 62)
    return "\n".join(lines)
