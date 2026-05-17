from __future__ import annotations

from dataclasses import dataclass
from itertools import count

from core.store import Memory, MemoryStore, Scope


RETRIEVAL_TOP_K = 10


@dataclass
class Retrieved:
    memory: Memory
    score: float
    reason: str


class MemoryEngine:
    def __init__(self, path: str | None = None) -> None:
        self._store = MemoryStore(path=path)
        existing_n = [int(m.id) for m in self._store.all() if m.id.isdigit()]
        self._auto_id = count(max(existing_n, default=0) + 1)

    def retrieve(self, query: str) -> list[Retrieved]:
        out: list[Retrieved] = []
        kept: set[str] = set()
        for mem, score in self._store.query(query, RETRIEVAL_TOP_K):
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

    def upsert(
        self,
        content: str,
        scope: Scope,
        memory_id: str | None = None,
    ) -> None:
        if memory_id is None:
            memory_id = f"{next(self._auto_id)}"
        else:
            scope = self._store.scope_of(memory_id)
        self._store.upsert([Memory(id=memory_id, content=content, scope=scope)])

    def delete(self, memory_id: str) -> None:
        self._store.delete([memory_id])

    def all(self) -> list[Memory]:
        return self._store.all()

    def reset(self, memories: list[Memory]) -> None:
        self._store.clear()
        self._store.upsert(memories)
