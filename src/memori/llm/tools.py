from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, cast


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]


SCHEMAS: list[dict[str, Any]] = [
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


NAME_MAP = {
    "memory_upsert": "memory.upsert",
    "memory_delete": "memory.delete",
}


def parse_tool_call(raw_name: str, args_field: Any) -> ToolCall:
    mapped = NAME_MAP.get(raw_name, raw_name)
    try:
        arguments = (
            json.loads(args_field) if isinstance(args_field, str) else args_field
        )
    except json.JSONDecodeError:
        arguments = {}
    return ToolCall(name=mapped, arguments=cast(dict[str, Any], arguments or {}))
