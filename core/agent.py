"""ReAct agent: think → act → observe → repeat → answer."""
from __future__ import annotations

import json, re
from typing import Callable, Iterator

from .config import Settings
from .llm import LLM
from .memory import Memory
from .tools import Toolbox

SYSTEM = """You are LocalMind Agent, running fully offline on the user's machine.
You solve tasks by reasoning and calling tools.

RESPOND IN EXACTLY ONE OF THESE TWO FORMATS.

To use a tool:
THOUGHT: <one sentence on why this tool, right now>
ACTION: {{"tool": "<tool_name>", "args": {{...}}}}

To finish:
THOUGHT: <one sentence>
FINAL: <the complete answer for the user, in markdown>

AVAILABLE TOOLS
{tools}

RULES
- Emit ONE action per message, then stop and wait for the OBSERVATION.
- Never fabricate an OBSERVATION. Never guess a computed value — use `python` or `calc`.
- Prefer `search_docs` before answering questions about the user's own documents.
- If a tool errors, read the error and try a different approach; do not loop.
- Finish as soon as you can answer. Do not pad with extra tool calls."""


def extract_json(text: str) -> dict | None:
    """Brace-balanced extraction that ignores braces inside strings."""
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            c = text[i]
            if in_str:
                if esc:            esc = False
                elif c == "\\":    esc = True
                elif c == '"':     in_str = False
                continue
            if c == '"':           in_str = True
            elif c == "{":         depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    blob = text[start:i + 1]
                    try:
                        return json.loads(blob)
                    except json.JSONDecodeError:
                        try:                       # tolerate single quotes / trailing commas
                            fixed = re.sub(r",\s*([}\]])", r"\1", blob.replace("'", '"'))
                            return json.loads(fixed)
                        except Exception:
                            break
        start = text.find("{", start + 1)
    return None


class Agent:
    def __init__(self, llm: LLM, tools: Toolbox, s: Settings, memory: Memory | None = None):
        self.llm, self.tools, self.s, self.memory = llm, tools, s, memory

    def run(self, goal: str, on_event: Callable[[str, str], None] | None = None) -> str:
        return "".join(self.stream(goal, on_event))

    def stream(self, goal: str, on_event: Callable[[str, str], None] | None = None) -> Iterator[str]:
        emit = on_event or (lambda kind, txt: None)
        sys_txt = SYSTEM.format(tools=self.tools.spec())
        if self.memory:
            ctx = self.memory.auto_context(goal)
            if ctx:
                sys_txt += f"\n\nLONG-TERM MEMORY\n{ctx}"

        msgs = [{"role": "system", "content": sys_txt},
                {"role": "user", "content": goal}]

        for step in range(1, self.s.agent_max_steps + 1):
            reply = self.llm.chat(msgs, temperature=0.3, max_tokens=1200,
                                  stop=["\nOBSERVATION:", "OBSERVATION:"]).strip()
            msgs.append({"role": "assistant", "content": reply})

            thought = ""
            m = re.search(r"THOUGHT:\s*(.+?)(?:\n(?:ACTION|FINAL):|$)", reply, re.S)
            if m:
                thought = m.group(1).strip()
                emit("thought", thought)

            if "FINAL:" in reply:
                answer = reply.split("FINAL:", 1)[1].strip()
                emit("final", answer)
                yield answer
                return

            call = None
            if "ACTION:" in reply:
                call = extract_json(reply.split("ACTION:", 1)[1])
            if call is None:
                call = extract_json(reply)

            if not call or "tool" not in call:
                # model answered in plain prose — accept it
                emit("final", reply)
                yield reply
                return

            name = str(call["tool"])
            args = call.get("args", call.get("arguments", {})) or {}
            emit("action", f"{name}({json.dumps(args)[:200]})")

            obs = self.tools.call(name, args)
            emit("observation", obs[:1500])
            msgs.append({"role": "user", "content": f"OBSERVATION:\n{obs}"})

        # step budget exhausted → force a wrap-up
        msgs.append({"role": "user",
                     "content": "Step limit reached. Give your best FINAL answer now "
                                "using only what you have observed."})
        final = self.llm.chat(msgs, temperature=0.3, max_tokens=1200)
        final = final.split("FINAL:", 1)[-1].strip()
        emit("final", final)
        yield final
