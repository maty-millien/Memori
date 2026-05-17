from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, cast

from core.engine import Memory
from core.env import require
from core.openrouter import OpenRouterClient


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMResult:
    tool_calls: list[ToolCall]
    user_message: str
    assistant_message: dict[str, Any]


_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "memory_upsert",
            "description": (
                "Create a new durable memory or replace the content of an "
                "existing one. Pass memory_id to refine an existing memory; "
                "omit it to create a new one. Only call for stable, "
                "generalizable information worth recalling later."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": (
                            "Memory content phrased as a third-person statement "
                            "that survives outside the current chat."
                        ),
                    },
                    "memory_id": {
                        "type": "string",
                        "description": (
                            "Existing memory id to replace. Omit when creating "
                            "a new memory."
                        ),
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["global", "topical"],
                        "description": (
                            "Only used when creating a new memory. Use 'global' "
                            "for preferences about response language, tone, "
                            "length, or format that apply to every reply "
                            "regardless of topic. Use 'topical' (default) for "
                            "everything else, including domain-specific "
                            "preferences."
                        ),
                    },
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_delete",
            "description": "Delete an existing memory the user asks you to forget.",
            "parameters": {
                "type": "object",
                "properties": {"memory_id": {"type": "string"}},
                "required": ["memory_id"],
            },
        },
    },
]


_TOOL_NAME_MAP = {
    "memory_upsert": "memory.upsert",
    "memory_delete": "memory.delete",
}


_SYSTEM_PROMPT = """You are a helpful, friendly AI assistant. Your job is to answer the user's questions and help with what they ask — clearly, concisely, and in a way that fits them.

To help you personalize, you have a long-term memory of things from past conversations. When relevant memories are available, they will appear under a <relevant_memories> tag. Use them naturally to inform your answer and to respect the user's preferences (language, tone, length, format, anything they've told you about themselves or their work). Don't mention the memory system unless the user asks about it — just be the kind of assistant who remembers.

You also have background tools — memory_upsert, memory_delete — to keep that long-term memory accurate. Use them when the conversation reveals something durable enough to be worth recalling later, but never let memory bookkeeping get in the way of giving a good answer. The answer is the product; memory is plumbing.

When to update memory:
- Save durable information: stable preferences, project facts, deferred tasks, deadlines. Uncertain dates/commitments still deserve a save — preserve the uncertainty in the content ("might be Friday", "user is not sure yet").
- Never save transient state ("opened terminal", "drinking coffee"), small talk, or acknowledgements.
- If a retrieved memory is contradicted or refined by the user, call memory_upsert with that memory_id to replace it; do not create a duplicate.
- If the user asks to forget something, call memory_delete on the matching memory_id.
- If the user restates something already in the retrieved memories without contradicting or refining it, do nothing.
- Duplicate hygiene: if two or more retrieved memories state substantially the same fact, call memory_delete on the redundant ones and keep the most informative single version. Do this whenever you spot duplicates, even if the user's current message is unrelated.
- If the message contains nothing durable, do nothing.
- You may call multiple tools per turn (e.g. create a new memory AND delete a duplicate at the same time).
- Memory content must be a third-person statement (e.g. "User prefers ...", not "I prefer ...").

Choosing the scope (only when creating a new memory with memory_upsert):
- global: preferences that should apply to every reply regardless of topic — language ("answer in French"), tone, length, format, output style.
- topical: everything else, including domain-specific preferences ("prefers running in the morning", "prefers oat milk"). Default if you are unsure.
"""


def _format_injected(memories: list[Memory]) -> str:
    return "\n".join(f"- id: {m.id}\n  content: {m.content}" for m in memories)


def call_with_tools(user_content: str, retrieved: list[Memory]) -> LLMResult:
    model = require("MEMORI_LLM_MODEL")
    reasoning_effort = require("MEMORI_REASONING_EFFORT")

    if retrieved:
        user_message = (
            f"<relevant_memories>\n{_format_injected(retrieved)}\n</relevant_memories>\n\n"
            f"{user_content}"
        )
    else:
        user_message = user_content

    body = OpenRouterClient().chat_completions(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            "tools": _TOOLS,
            "reasoning": {"effort": reasoning_effort},
        }
    )

    calls: list[ToolCall] = []
    assistant_message: dict[str, Any] = {}
    for choice in body.get("choices", []):
        assistant_message = choice.get("message", {}) or {}
        for raw in assistant_message.get("tool_calls") or []:
            fn = raw.get("function", {})
            raw_name = fn.get("name", "")
            mapped = _TOOL_NAME_MAP.get(raw_name, raw_name)
            args_field = fn.get("arguments", "{}")
            try:
                arguments = (
                    json.loads(args_field)
                    if isinstance(args_field, str)
                    else args_field
                )
            except json.JSONDecodeError:
                arguments = {}
            calls.append(
                ToolCall(name=mapped, arguments=cast(dict[str, Any], arguments))
            )
    return LLMResult(
        tool_calls=calls,
        user_message=user_message,
        assistant_message=assistant_message,
    )
