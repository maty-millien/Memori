from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal


Scope = Literal["global", "topical"]
Kind = Literal["memory", "conversation"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Memory:
    id: str
    content: str
    scope: Scope = "topical"
    kind: Kind = "memory"
    created_at: datetime = field(default_factory=utc_now)


@dataclass
class Retrieved:
    memory: Memory
    score: float
    reason: str
