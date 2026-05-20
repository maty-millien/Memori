from __future__ import annotations

import json
from typing import Any, Callable, Literal

from memori.domain.engine import Engine
from memori.domain.memory import Memory, Retrieved
from memori.llm.tools import ToolCall


Status = Literal["passed", "failed", "skipped"]
LogFn = Callable[[str], None]


def noop(_: str) -> None:
    return None


def fence(log: LogFn, lang: str, body: str) -> None:
    log(f"```{lang}")
    for line in body.splitlines() or [""]:
        log(line)
    log("```")


def label(log: LogFn, text: str) -> None:
    log("")
    log(f"**{text}**")
    log("")


def _yaml_memory_block(memories: list[Memory]) -> str:
    rows: list[str] = []
    for m in memories:
        rows.append(f'- id: "{m.id}"')
        rows.append(f"  content: {json.dumps(m.content, ensure_ascii=False)}")
    return "\n".join(rows)


def log_memories(log: LogFn, title: str, memories: list[Memory]) -> None:
    label(log, title)
    if not memories:
        log("_(none)_")
        return
    fence(log, "yaml", _yaml_memory_block(memories))


def log_retrieved(
    log: LogFn, items: list[Retrieved], *, with_reason: bool = True
) -> None:
    label(log, "Retrieved")
    if not items:
        log("_(none)_")
        return
    rows: list[str] = []
    for r in items:
        rows.append(f'- id: "{r.memory.id}"')
        rows.append(f"  score: {r.score:.3f}")
        if with_reason:
            rows.append(f"  reason: {json.dumps(r.reason, ensure_ascii=False)}")
        rows.append(f"  content: {json.dumps(r.memory.content, ensure_ascii=False)}")
    fence(log, "yaml", "\n".join(rows))


def log_tool_calls(log: LogFn, calls: list[ToolCall]) -> None:
    label(log, "Tool calls")
    if not calls:
        log("_(none)_")
        return
    payload = [{"name": c.name, "arguments": c.arguments} for c in calls]
    fence(log, "json", json.dumps(payload, ensure_ascii=False, indent=2))


def log_text(log: LogFn, title: str, text: str) -> None:
    label(log, title)
    fence(log, "text", text)


def log_quote(log: LogFn, title: str, text: str, *, italic: bool = False) -> None:
    label(log, title)
    for line in text.splitlines() or [""]:
        if not line:
            log(">")
        elif italic:
            log(f"> _{line}_")
        else:
            log(f"> {line}")


def log_header(log: LogFn, scenario: dict[str, Any]) -> None:
    log("---")
    log("")
    log(
        f"## `{scenario.get('id', '<unknown>')}` — `{scenario.get('type', '<unknown>')}`"
    )


def log_initial_memories(log: LogFn, memories: list[Memory]) -> None:
    log_memories(log, "Initial memories", memories)


def log_snapshot(log: LogFn, engine: Engine) -> None:
    log_memories(log, "Final memory state", engine.memories())


def log_result(log: LogFn, status: Status, failures: list[str]) -> None:
    label(log, f"Result: {status.upper()}")
    if failures:
        for f in failures:
            log(f"- {f}")
        log("")


def log_llm_exchange(log: LogFn, result: Any) -> Any:
    log_text(log, "LLM user message (verbatim)", result.user_message)
    reasoning = result.assistant_message.get("reasoning")
    if reasoning:
        log_quote(log, "LLM reasoning trace", str(reasoning), italic=True)
    log_tool_calls(log, result.tool_calls)
    assistant_content = result.assistant_message.get("content")
    if assistant_content:
        log_quote(log, "LLM assistant content", str(assistant_content))
    return assistant_content
