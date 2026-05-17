from __future__ import annotations

from dataclasses import dataclass
from itertools import count

from core.env import require
from core.store import Memory, MemoryStore, Scope


__all__ = ["Memory", "MemoryEngine", "Retrieved", "Scope"]


@dataclass
class Retrieved:
    memory: Memory
    score: float
    reason: str


class MemoryEngine:
    def __init__(self, path: str | None = None) -> None:
        self._store = MemoryStore(path=path)
        existing_n = [
            int(m.id.rsplit("_", 1)[-1])
            for m in self._store.all()
            if m.id.startswith("mem_auto_") and m.id.rsplit("_", 1)[-1].isdigit()
        ]
        self._auto_id = count(max(existing_n, default=0) + 1)

    def seed(self, memories: list[Memory]) -> None:
        self._store.clear()
        self._store.upsert(memories)

    def retrieve(self, query: str, top_k: int) -> list[Retrieved]:
        min_score = float(require("MEMORI_RETRIEVAL_MIN_SCORE"))
        out: list[Retrieved] = []
        kept: set[str] = set()
        for mem, score in self._store.query(query, top_k):
            if score < min_score:
                continue
            out.append(
                Retrieved(
                    memory=mem, score=score, reason=f"cosine similarity {score:.3f}"
                )
            )
            kept.add(mem.id)
        for mem in self._store.all():
            if mem.id in kept or mem.scope != "global":
                continue
            out.append(
                Retrieved(
                    memory=mem, score=1.0, reason="global scope (always injected)"
                )
            )
        return out

    def write(self, content: str, scope: Scope = "topical") -> Memory:
        memory = Memory(
            id=f"mem_auto_{next(self._auto_id)}", content=content, scope=scope
        )
        self._store.upsert([memory])
        return memory

    def update(self, memory_id: str, content: str) -> Memory:
        memory = Memory(
            id=memory_id, content=content, scope=self._store.scope_of(memory_id)
        )
        self._store.upsert([memory])
        return memory

    def delete(self, memory_id: str) -> None:
        self._store.delete([memory_id])

    def snapshot(self) -> list[Memory]:
        return self._store.all()
