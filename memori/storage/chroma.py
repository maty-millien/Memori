from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any, cast

import chromadb

from memori.models import Importance, Kind, Memory, Scope, utc_now
from memori.providers.openrouter import OpenRouterClient


Embedding = Sequence[float] | Sequence[int]


class ChromaMemoryStore:
    def __init__(
        self,
        path: str | None,
        embedding_model: str,
        openrouter: OpenRouterClient,
    ) -> None:
        client = chromadb.PersistentClient(path=path) if path else chromadb.Client()
        name = "memori" if path else f"memori_{uuid.uuid4().hex}"
        self._collection = client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )
        self._embedding_model = embedding_model
        self._openrouter = openrouter

    def upsert(self, memories: Iterable[Memory]) -> None:
        items = list(memories)
        if not items:
            return
        contents = [memory.content for memory in items]
        self._collection.upsert(
            ids=[memory.id for memory in items],
            documents=contents,
            embeddings=self._embed(contents),
            metadatas=[_metadata_from_memory(memory) for memory in items],
        )

    def delete(self, ids: list[str]) -> None:
        if ids:
            self._collection.delete(ids=ids)

    def clear(self) -> None:
        self.delete(self._collection.get()["ids"])

    def count(self) -> int:
        return self._collection.count()

    def get(self, memory_id: str) -> Memory:
        result = self._collection.get(ids=[memory_id])
        return _to_memory(
            memory_id,
            (result.get("documents") or [""])[0],
            (result.get("metadatas") or [{}])[0],
        )

    def all(self, kind: Kind | None = None) -> list[Memory]:
        result = (
            self._collection.get(where={"kind": kind})
            if kind
            else self._collection.get()
        )
        return [
            _to_memory(memory_id, document, metadata)
            for memory_id, document, metadata in zip(
                result["ids"],
                result.get("documents") or [],
                result.get("metadatas") or [],
            )
        ]

    def query(
        self, text: str, top_k: int, kind: Kind | None = None
    ) -> list[tuple[Memory, float]]:
        count = min(top_k, self.count())
        if count <= 0:
            return []
        kwargs: dict[str, Any] = {
            "query_embeddings": self._embed([text]),
            "n_results": count,
        }
        if kind:
            kwargs["where"] = {"kind": kind}
        result = self._collection.query(**kwargs)
        return [
            (_to_memory(memory_id, document, metadata), 1.0 - float(distance))
            for memory_id, document, distance, metadata in zip(
                result["ids"][0],
                (result.get("documents") or [[]])[0],
                (result.get("distances") or [[]])[0],
                (result.get("metadatas") or [[]])[0],
            )
        ]

    def mark_accessed(self, memories: Iterable[Memory]) -> None:
        items = list(memories)
        if not items:
            return
        now = utc_now()
        for memory in items:
            memory.last_accessed_at = now
            memory.access_count += 1
        self.upsert(items)

    def _embed(self, texts: list[str]) -> list[Embedding]:
        body = self._openrouter.embeddings(self._embedding_model, texts)
        return [cast(Embedding, item["embedding"]) for item in body["data"]]


def _metadata_from_memory(memory: Memory) -> dict[str, str | int]:
    return {
        "scope": memory.scope,
        "kind": memory.kind,
        "importance": memory.importance,
        "created_at": memory.created_at.isoformat(),
        "updated_at": memory.updated_at.isoformat(),
        "last_accessed_at": _serialize_datetime(memory.last_accessed_at),
        "access_count": memory.access_count,
    }


def _to_memory(
    memory_id: str, document: str, metadata: Mapping[str, Any] | None
) -> Memory:
    stored = metadata or {}
    created_at = _datetime_from_meta(stored.get("created_at"))
    updated_at = _datetime_from_meta(stored.get("updated_at")) or created_at
    return Memory(
        id=memory_id,
        content=document,
        scope=cast(Scope, stored.get("scope", "topical")),
        kind=cast(Kind, stored.get("kind", "memory")),
        importance=cast(Importance, stored.get("importance", "useful_fact")),
        created_at=created_at or utc_now(),
        updated_at=updated_at or utc_now(),
        last_accessed_at=_datetime_from_meta(stored.get("last_accessed_at")),
        access_count=int(stored.get("access_count", 0)),
    )


def _datetime_from_meta(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    return datetime.fromisoformat(value)


def _serialize_datetime(value: datetime | None) -> str:
    return value.isoformat() if value is not None else ""
