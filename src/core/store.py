from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, cast

import chromadb

from core.env import require
from core.openrouter import OpenRouterClient


Embedding = Sequence[float] | Sequence[int]
Scope = Literal["global", "topical"]


@dataclass
class Memory:
    id: str
    content: str
    scope: Scope = "topical"


def _embed(texts: list[str]) -> list[Embedding]:
    body = OpenRouterClient().embeddings(require("MEMORI_EMBEDDING_MODEL"), texts)
    return [cast(Embedding, item["embedding"]) for item in body["data"]]


def _to_memory(mid: str, doc: str, meta: Mapping[str, Any] | None) -> Memory:
    return Memory(
        id=mid, content=doc, scope=cast(Scope, (meta or {}).get("scope", "topical"))
    )


class MemoryStore:
    def __init__(self, path: str | None = None) -> None:
        client = chromadb.PersistentClient(path=path) if path else chromadb.Client()
        name = "memori" if path else f"memori_{uuid.uuid4().hex}"
        self._collection = client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )

    def upsert(self, memories: Iterable[Memory]) -> None:
        items = list(memories)
        if not items:
            return
        contents = [m.content for m in items]
        self._collection.upsert(
            ids=[m.id for m in items],
            documents=contents,
            embeddings=_embed(contents),
            metadatas=[{"scope": m.scope} for m in items],
        )

    def delete(self, ids: list[str]) -> None:
        if ids:
            self._collection.delete(ids=ids)

    def clear(self) -> None:
        self.delete(self._collection.get()["ids"])

    def count(self) -> int:
        return self._collection.count()

    def scope_of(self, memory_id: str) -> Scope:
        metas = self._collection.get(ids=[memory_id]).get("metadatas") or []
        return cast(Scope, metas[0].get("scope", "topical"))

    def all(self) -> list[Memory]:
        res = self._collection.get()
        return [
            _to_memory(mid, doc, meta)
            for mid, doc, meta in zip(
                res["ids"], res.get("documents") or [], res.get("metadatas") or []
            )
        ]

    def query(self, text: str, top_k: int) -> list[tuple[Memory, float]]:
        n = min(top_k, self.count())
        if n <= 0:
            return []
        res = self._collection.query(query_embeddings=_embed([text]), n_results=n)
        return [
            (_to_memory(mid, doc, meta), 1.0 - float(dist))
            for mid, doc, dist, meta in zip(
                res["ids"][0],
                (res.get("documents") or [[]])[0],
                (res.get("distances") or [[]])[0],
                (res.get("metadatas") or [[]])[0],
            )
        ]
