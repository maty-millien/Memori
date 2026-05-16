from __future__ import annotations

import os
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import count
from typing import Any, Literal, cast

import chromadb

from core.openrouter import get_client


Embedding = Sequence[float] | Sequence[int]


MemoryKind = Literal["preference", "project", "fact", "note"]
Scope = Literal["global", "topical"]


@dataclass
class Memory:
    id: str
    kind: MemoryKind
    content: str
    scope: Scope = "topical"


@dataclass
class Retrieved:
    memory: Memory
    score: float
    reason: str


def _embed(texts: list[str]) -> list[Embedding]:
    embedding_model = os.environ.get("MEMORI_EMBEDDING_MODEL")
    if not embedding_model:
        raise RuntimeError("MEMORI_EMBEDDING_MODEL must be set to compute embeddings")
    body = get_client().embeddings(embedding_model, texts)
    return [cast(Embedding, item["embedding"]) for item in body["data"]]


class MemoryEngine:
    def __init__(self) -> None:
        self._client = chromadb.Client()
        self._collection = self._client.get_or_create_collection(
            name=f"memori_{uuid.uuid4().hex}",
            metadata={"hnsw:space": "cosine"},
        )
        self._auto_id = count(1)

    def _meta_of(self, memory_id: str) -> dict[str, Any]:
        result = self._collection.get(ids=[memory_id])
        metadatas = result.get("metadatas") or []
        return dict(metadatas[0])

    def seed(self, memories: list[Memory]) -> None:
        existing_ids = self._collection.get()["ids"]
        if existing_ids:
            self._collection.delete(ids=existing_ids)
        if not memories:
            return
        contents = [m.content for m in memories]
        self._collection.add(
            ids=[m.id for m in memories],
            documents=contents,
            embeddings=_embed(contents),
            metadatas=[{"kind": m.kind, "scope": m.scope} for m in memories],
        )

    def retrieve(self, query: str, top_k: int) -> list[Retrieved]:
        min_score_raw = os.environ.get("MEMORI_RETRIEVAL_MIN_SCORE")
        if not min_score_raw:
            raise RuntimeError(
                "MEMORI_RETRIEVAL_MIN_SCORE must be set to retrieve memories"
            )
        min_score = float(min_score_raw)
        total = self._collection.count()
        if total == 0 or top_k <= 0:
            return self._global_extras(set())
        result = self._collection.query(
            query_embeddings=_embed([query]),
            n_results=min(top_k, total),
        )
        ids = result["ids"][0]
        documents = (result.get("documents") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        out: list[Retrieved] = []
        kept_ids: set[str] = set()
        for mid, doc, dist, meta in zip(ids, documents, distances, metadatas):
            score = 1.0 - float(dist)
            if score < min_score:
                continue
            memory = Memory(
                id=mid,
                kind=cast(MemoryKind, meta["kind"]),
                content=doc,
                scope=cast(Scope, meta.get("scope", "topical")),
            )
            out.append(
                Retrieved(
                    memory=memory,
                    score=score,
                    reason=f"cosine similarity {score:.3f}",
                )
            )
            kept_ids.add(mid)
        out.extend(self._global_extras(kept_ids))
        return out

    def _global_extras(self, exclude_ids: set[str]) -> list[Retrieved]:
        result = self._collection.get()
        ids = result["ids"]
        documents = result.get("documents") or []
        metadatas = result.get("metadatas") or []
        extras: list[Retrieved] = []
        for mid, doc, meta in zip(ids, documents, metadatas):
            if mid in exclude_ids:
                continue
            if meta.get("scope") != "global":
                continue
            memory = Memory(
                id=mid,
                kind=cast(MemoryKind, meta["kind"]),
                content=doc,
                scope="global",
            )
            extras.append(
                Retrieved(
                    memory=memory,
                    score=1.0,
                    reason="global scope (always injected)",
                )
            )
        return extras

    def write(self, content: str, kind: MemoryKind, scope: Scope = "topical") -> Memory:
        new_id = f"mem_auto_{next(self._auto_id)}"
        self._collection.add(
            ids=[new_id],
            documents=[content],
            embeddings=_embed([content]),
            metadatas=[{"kind": kind, "scope": scope}],
        )
        return Memory(id=new_id, kind=kind, content=content, scope=scope)

    def update(self, memory_id: str, content: str) -> Memory:
        meta = self._meta_of(memory_id)
        kind = cast(MemoryKind, meta["kind"])
        scope = cast(Scope, meta.get("scope", "topical"))
        self._collection.update(
            ids=[memory_id],
            documents=[content],
            embeddings=_embed([content]),
            metadatas=[{"kind": kind, "scope": scope}],
        )
        return Memory(id=memory_id, kind=kind, content=content, scope=scope)

    def delete(self, memory_id: str) -> None:
        self._collection.delete(ids=[memory_id])

    def snapshot(self) -> list[Memory]:
        result = self._collection.get()
        ids = result["ids"]
        documents = result.get("documents") or []
        metadatas = result.get("metadatas") or []
        return [
            Memory(
                id=mid,
                kind=cast(MemoryKind, meta["kind"]),
                content=doc,
                scope=cast(Scope, meta.get("scope", "topical")),
            )
            for mid, doc, meta in zip(ids, documents, metadatas)
        ]
