from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal


Scope = Literal["global", "topical"]
Kind = Literal["memory", "conversation"]
Importance = Literal[
    "identity",
    "global_preference",
    "active_project",
    "useful_fact",
    "uncertain",
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Memory:
    id: str
    content: str
    scope: Scope = "topical"
    kind: Kind = "memory"
    importance: Importance = "useful_fact"
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    last_accessed_at: datetime | None = None
    access_count: int = 0


@dataclass
class Retrieved:
    memory: Memory
    score: float
    reason: str
