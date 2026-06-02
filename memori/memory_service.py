from __future__ import annotations

from itertools import count

from memori.config import Settings
from memori.models import Importance, Memory, Retrieved, Scope, utc_now
from memori.providers.openrouter import OpenRouterClient
from memori.ranking import rank_memory
from memori.storage.chroma import ChromaMemoryStore


class MemoryService:
    def __init__(self, store: ChromaMemoryStore, settings: Settings) -> None:
        self._store = store
        self._settings = settings
        existing_ids = [int(m.id) for m in self._store.all() if m.id.isdigit()]
        self._auto_id = count(max(existing_ids, default=0) + 1)

    @classmethod
    def from_settings(
        cls, settings: Settings, path: str | None = None
    ) -> MemoryService:
        openrouter = OpenRouterClient(settings.openrouter_api_key)
        store = ChromaMemoryStore(
            path=path,
            embedding_model=settings.embedding_model,
            openrouter=openrouter,
        )
        return cls(store=store, settings=settings)

    def retrieve_memories(self, query: str) -> list[Retrieved]:
        candidates: dict[str, tuple[Memory, float]] = {}
        for memory, score in self._store.query(
            query, self._settings.retrieval_pool_k, kind="memory"
        ):
            candidates[memory.id] = (memory, score)
        for memory in self._store.all(kind="memory"):
            if memory.scope != "global" or memory.id in candidates:
                continue
            candidates[memory.id] = (memory, 0.0)
        ranked = [
            rank_memory(memory, semantic_score, self._settings)
            for memory, semantic_score in candidates.values()
        ]
        ranked.sort(key=lambda item: item.score, reverse=True)
        retrieved = ranked[: self._settings.retrieval_top_k]
        self._store.mark_accessed(item.memory for item in retrieved)
        return retrieved

    def retrieve_conversations(self, query: str) -> tuple[list[Memory], list[Memory]]:
        recent = sorted(
            self._store.all(kind="conversation"),
            key=lambda memory: memory.created_at,
            reverse=True,
        )[: self._settings.recent_conversations]
        similar = [
            memory
            for memory, _ in self._store.query(
                query, self._settings.similar_conversations, kind="conversation"
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
