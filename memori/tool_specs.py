from __future__ import annotations

from typing import Any

from memori.memory_service import MemoryService
from memori.models import Importance, MemoryTool, Scope


def memory_tools() -> list[MemoryTool]:
    return [
        MemoryTool(
            name="memory_upsert",
            description=(
                "Create a new durable memory or replace the content of an "
                "existing one. Only call for stable, generalizable information "
                "worth recalling later."
            ),
            parameters={
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
                        "type": ["string", "null"],
                        "description": (
                            "Existing memory id to replace. Omit when creating "
                            "a new memory."
                        ),
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["global", "topical"],
                        "default": "topical",
                    },
                    "importance": {
                        "type": "string",
                        "enum": [
                            "identity",
                            "global_preference",
                            "active_project",
                            "useful_fact",
                            "uncertain",
                        ],
                        "default": "useful_fact",
                    },
                },
                "required": ["content"],
            },
        ),
        MemoryTool(
            name="memory_delete",
            description=(
                "Delete an existing memory when the user asks to forget it "
                "or when a retrieved memory is redundant."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "memory_id": {
                        "type": "string",
                        "description": "The id of the memory to delete.",
                    },
                },
                "required": ["memory_id"],
            },
        ),
    ]


def handle_memory_tool(
    service: MemoryService, name: str, arguments: dict[str, Any]
) -> str:
    if name == "memory_upsert":
        content = str(arguments["content"])
        memory_id = arguments.get("memory_id") or None
        new_id, created = service.upsert(
            content=content,
            scope=parse_scope(arguments.get("scope", "topical")),
            importance=parse_importance(arguments.get("importance", "useful_fact")),
            memory_id=str(memory_id) if memory_id is not None else None,
        )
        verb = "created" if created else "updated"
        return f'{verb} memory with id "{new_id}"'
    if name == "memory_delete":
        memory_id = str(arguments["memory_id"])
        service.delete(memory_id)
        return f'deleted memory with id "{memory_id}"'
    raise ValueError(f"unknown memory tool: {name}")


def parse_scope(value: Any) -> Scope:
    if value in {"global", "topical"}:
        return value
    raise ValueError(f"unknown memory scope: {value}")


def parse_importance(value: Any) -> Importance:
    if value in {
        "identity",
        "global_preference",
        "active_project",
        "useful_fact",
        "uncertain",
    }:
        return value
    raise ValueError(f"unknown memory importance: {value}")
