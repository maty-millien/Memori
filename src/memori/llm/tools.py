from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart

from memori.domain.engine import Engine


Scope = Literal["global", "topical"]


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass
class Deps:
    engine: Engine | None


DISPLAY_NAME = {
    "memory_upsert": "memory.upsert",
    "memory_delete": "memory.delete",
}


def register(agent: Agent[Deps, str]) -> None:
    @agent.tool
    def memory_upsert(
        ctx: RunContext[Deps],
        content: str,
        memory_id: str | None = None,
        scope: Scope = "topical",
    ) -> str:
        """Create a new durable memory or replace the content of an existing one.

        Pass memory_id to refine an existing memory; omit it to create a new one.
        Only call for stable, generalizable information worth recalling later.

        Args:
            content: Memory content phrased as a third-person statement that
                survives outside the current chat.
            memory_id: Existing memory id to replace. Omit when creating a new
                memory.
            scope: Only used when creating a new memory. Use 'global' for
                preferences about response language, tone, length, or format
                that apply to every reply regardless of topic. Use 'topical'
                (default) for everything else, including domain-specific
                preferences.
        """
        if ctx.deps.engine is None:
            return f'created memory with id "{memory_id or "?"}"'
        new_id, created = ctx.deps.engine.upsert(
            content=content, scope=scope, memory_id=memory_id or None
        )
        verb = "created" if created else "updated"
        return f'{verb} memory with id "{new_id}"'

    @agent.tool
    def memory_delete(ctx: RunContext[Deps], memory_id: str) -> str:
        """Delete an existing memory.

        Use this when the user asks you to forget a memory, or when retrieved
        memories contain duplicates and one is redundant.

        Args:
            memory_id: The id of the memory to delete.
        """
        if ctx.deps.engine is not None:
            ctx.deps.engine.delete(memory_id)
        return f'deleted memory with id "{memory_id}"'


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
