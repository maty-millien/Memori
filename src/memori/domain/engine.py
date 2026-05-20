from __future__ import annotations

from itertools import count

from memori.domain.memory import Memory, Retrieved, Scope
from memori.infra.store import Store


RETRIEVAL_TOP_K = 10
RECENT_CONVERSATIONS = 5
SIMILAR_CONVERSATIONS = 5


class Engine:
    def __init__(self, path: str | None = None) -> None:
        self._store = Store(path=path)
        existing_n = [int(m.id) for m in self._store.all() if m.id.isdigit()]
        self._auto_id = count(max(existing_n, default=0) + 1)

    def retrieve_memories(self, query: str) -> list[Retrieved]:
        out: list[Retrieved] = []
        kept: set[str] = set()
        for mem, score in self._store.query(query, RETRIEVAL_TOP_K, kind="memory"):
            out.append(
                Retrieved(
                    memory=mem, score=score, reason=f"cosine similarity {score:.3f}"
                )
            )
            kept.add(mem.id)
        for mem in self._store.all(kind="memory"):
            if mem.id in kept or mem.scope != "global":
                continue
            out.append(
                Retrieved(
                    memory=mem, score=1.0, reason="global scope (always injected)"
                )
            )
        return out

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
        memory_id: str | None = None,
    ) -> tuple[str, bool]:
        created = memory_id is None
        if memory_id is None:
            memory_id = f"{next(self._auto_id)}"
        else:
            scope = self._store.scope_of(memory_id)
        self._store.upsert([Memory(id=memory_id, content=content, scope=scope)])
        return memory_id, created

    def delete(self, memory_id: str) -> None:
        self._store.delete([memory_id])

    def memories(self) -> list[Memory]:
        return self._store.all(kind="memory")

    def reset(self, memories: list[Memory]) -> None:
        self._store.clear()
        self._store.upsert(memories)
