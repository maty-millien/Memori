from __future__ import annotations

from typing import cast

from memori.domain.engine import Engine
from memori.domain.memory import Scope
from memori.llm.tools import ToolCall


def apply_tool_call(call: ToolCall, engine: Engine) -> None:
    if call.name == "memory.upsert":
        engine.upsert(
            content=call.arguments.get("content", ""),
            scope=cast(Scope, call.arguments.get("scope", "topical")),
            memory_id=call.arguments.get("memory_id") or None,
        )
    elif call.name == "memory.delete":
        engine.delete(call.arguments.get("memory_id", ""))
