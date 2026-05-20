from __future__ import annotations

import math
from datetime import datetime, timezone
from itertools import count

from memori.domain.memory import Importance, Memory, Retrieved, Scope, utc_now
from memori.infra.store import Store


RETRIEVAL_TOP_K = 20
RETRIEVAL_POOL_K = 40
RECENT_CONVERSATIONS = 10
SIMILAR_CONVERSATIONS = 10

IMPORTANCE_WEIGHT: dict[Importance, float] = {
    "identity": 0.95,
    "global_preference": 0.90,
    "active_project": 0.80,
    "useful_fact": 0.60,
    "uncertain": 0.35,
}


class Engine:
    def __init__(self, path: str | None = None) -> None:
        self._store = Store(path=path)
        existing_n = [int(m.id) for m in self._store.all() if m.id.isdigit()]
        self._auto_id = count(max(existing_n, default=0) + 1)

    def retrieve_memories(self, query: str) -> list[Retrieved]:
        candidates: dict[str, tuple[Memory, float]] = {}
        for mem, score in self._store.query(query, RETRIEVAL_POOL_K, kind="memory"):
            candidates[mem.id] = (mem, score)
        for mem in self._store.all(kind="memory"):
            if mem.scope != "global" or mem.id in candidates:
                continue
            candidates[mem.id] = (mem, 0.0)
        ranked = [
            self._rank_candidate(memory=memory, semantic=semantic)
            for memory, semantic in candidates.values()
        ]
        ranked.sort(key=lambda item: item.score, reverse=True)
        retrieved = ranked[:RETRIEVAL_TOP_K]
        self._store.mark_accessed(item.memory for item in retrieved)
        return retrieved

    def retrieve_conversations(self, query: str) -> tuple[list[Memory], list[Memory]]:
        recent = sorted(
            self._store.all(kind="conversation"),
            key=lambda m: m.created_at,
            reverse=True,
        )[:RECENT_CONVERSATIONS]
        similar = [
            m
            for m, _ in self._store.query(
                query, SIMILAR_CONVERSATIONS, kind="conversation"
            )
        ]
        return recent, similar

    def record_summary(self, summary: str) -> None:
        if not summary:
            return
        memory_id = f"{next(self._auto_id)}"
        self._store.upsert([Memory(id=memory_id, content=summary, kind="conversation")])

    def upsert(
        self,
        content: str,
        scope: Scope,
        importance: Importance = "useful_fact",
        memory_id: str | None = None,
    ) -> tuple[str, bool]:
        created = memory_id is None
        now = utc_now()
        if memory_id is None:
            memory_id = f"{next(self._auto_id)}"
            memory = Memory(
                id=memory_id,
                content=content,
                scope=scope,
                importance=importance,
                created_at=now,
                updated_at=now,
            )
        else:
            existing = self._store.get(memory_id)
            memory = Memory(
                id=memory_id,
                content=content,
                scope=existing.scope,
                kind=existing.kind,
                importance=importance,
                created_at=existing.created_at,
                updated_at=now,
                last_accessed_at=existing.last_accessed_at,
                access_count=existing.access_count,
            )
        self._store.upsert([memory])
        return memory_id, created

    def delete(self, memory_id: str) -> None:
        self._store.delete([memory_id])

    def memories(self) -> list[Memory]:
        return self._store.all(kind="memory")

    def reset(self, memories: list[Memory]) -> None:
        self._store.clear()
        self._store.upsert(memories)

    def _rank_candidate(self, memory: Memory, semantic: float) -> Retrieved:
        importance = IMPORTANCE_WEIGHT.get(memory.importance, 0.60)
        recency = _recency_score(memory.updated_at)
        usage = _usage_score(memory.access_count)
        scope_boost = 0.10 if memory.scope == "global" else 0.0
        score = (
            (0.70 * semantic)
            + (0.20 * importance)
            + (0.07 * recency)
            + (0.03 * usage)
            + scope_boost
        )
        reason = (
            f"semantic {semantic:.3f}, "
            f"importance {memory.importance}={importance:.3f}, "
            f"recency {recency:.3f}, "
            f"usage {usage:.3f}, "
            f"scope {scope_boost:.3f}"
        )
        return Retrieved(memory=memory, score=score, reason=reason)


def _recency_score(updated_at: datetime) -> float:
    age_seconds = max(0.0, (datetime.now(timezone.utc) - updated_at).total_seconds())
    age_days = age_seconds / 86_400
    return 1.0 / (1.0 + age_days / 30)


def _usage_score(access_count: int) -> float:
    if access_count <= 0:
        return 0.0
    return min(1.0, math.log1p(access_count) / math.log1p(10))
