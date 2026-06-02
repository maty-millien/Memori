from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from memori import Memory


Status = Literal["passed", "failed", "error"]


@dataclass
class SessionTrace:
    id: str
    status: Status
    elapsed_seconds: float
    failures: list[str] = field(default_factory=list)
    error: str | None = None
    user_turns: list[str] = field(default_factory=list)
    retrieved: list[dict[str, Any]] = field(default_factory=list)
    recent_conversations: list[dict[str, Any]] = field(default_factory=list)
    similar_conversations: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    answer: str = ""
    recorded_summary: str = ""
    final_memories: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)


@dataclass
class ScenarioTrace:
    id: str
    description: str
    status: Status
    elapsed_seconds: float
    failures: list[str] = field(default_factory=list)
    error: str | None = None
    sessions: list[SessionTrace] = field(default_factory=list)
    final_memories: list[dict[str, Any]] = field(default_factory=list)


def memory_to_dict(memory: Memory) -> dict[str, Any]:
    return {
        "id": memory.id,
        "content": memory.content,
        "scope": memory.scope,
        "kind": memory.kind,
        "importance": memory.importance,
        "created_at": memory.created_at.isoformat(),
        "updated_at": memory.updated_at.isoformat(),
        "last_accessed_at": (
            memory.last_accessed_at.isoformat()
            if memory.last_accessed_at is not None
            else None
        ),
        "access_count": memory.access_count,
    }


def usage_to_dict(usage: Any) -> dict[str, Any]:
    if hasattr(usage, "model_dump"):
        return dict(usage.model_dump())
    if hasattr(usage, "__dict__"):
        return dict(usage.__dict__)
    return {}


def status_from_failures(failures: list[str], error: str | None = None) -> Status:
    if error is not None:
        return "error"
    return "failed" if failures else "passed"
