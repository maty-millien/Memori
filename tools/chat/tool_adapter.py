from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic_ai import RunContext, Tool
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart

from memori import Memori, MemoryTool, ToolCall


@dataclass
class Deps:
    memori: Memori


DISPLAY_NAME = {
    "memory_upsert": "memory.upsert",
    "memory_delete": "memory.delete",
}


def _make_tool(spec: MemoryTool) -> Tool[Deps]:
    def call(ctx: RunContext[Deps], **arguments: Any) -> str:
        return ctx.deps.memori.handle_tool_call(spec.name, arguments)

    return Tool.from_schema(
        function=call,
        name=spec.name,
        description=spec.description,
        json_schema=spec.parameters,
        takes_ctx=True,
    )


def memory_tools() -> list[Tool[Deps]]:
    return [_make_tool(spec) for spec in Memori.tools()]


def extract_tool_calls(messages: list[ModelMessage]) -> list[ToolCall]:
    calls: list[ToolCall] = []
    for msg in messages:
        if not isinstance(msg, ModelResponse):
            continue
        for part in msg.parts:
            if isinstance(part, ToolCallPart):
                args = part.args_as_dict() if hasattr(part, "args_as_dict") else {}
                calls.append(ToolCall(name=part.tool_name, arguments=args))
    return calls
