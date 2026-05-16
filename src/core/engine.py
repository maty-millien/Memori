from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import count
from typing import Literal, cast

import chromadb
import httpx


Embedding = Sequence[float] | Sequence[int]


MemoryKind = Literal["preference", "project", "fact", "note"]


_EMBEDDING_MODEL = os.environ.get(
    "MEMORI_EMBEDDING_MODEL", "perplexity/pplx-embed-v1-4b"
)
_OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings"
_MIN_SCORE = float(os.environ.get("MEMORI_RETRIEVAL_MIN_SCORE", "0.2"))


@dataclass
class Memory:
    id: str
    kind: MemoryKind
    content: str


@dataclass
class Retrieved:
    memory: Memory
    score: float
    reason: str


def _embed(texts: list[str]) -> list[Embedding]:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY must be set to compute embeddings")
    response = httpx.post(
        _OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={"model": _EMBEDDING_MODEL, "input": texts},
        timeout=30.0,
    )
    response.raise_for_status()
    return [cast(Embedding, item["embedding"]) for item in response.json()["data"]]


class MemoryEngine:
    def __init__(self) -> None:
        self._client = chromadb.Client()
        self._collection = self._client.get_or_create_collection(
            name="memori",
            metadata={"hnsw:space": "cosine"},
        )
        self._auto_id = count(1)

    def _kind_of(self, memory_id: str) -> MemoryKind:
        result = self._collection.get(ids=[memory_id])
        metadatas = result.get("metadatas") or []
        return cast(MemoryKind, metadatas[0]["kind"])

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
            metadatas=[{"kind": m.kind} for m in memories],
        )

    def retrieve(self, query: str, top_k: int) -> list[Retrieved]:
        total = self._collection.count()
        if total == 0 or top_k <= 0:
            return []
        result = self._collection.query(
            query_embeddings=_embed([query]),
            n_results=min(top_k, total),
        )
        ids = result["ids"][0]
        documents = (result.get("documents") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        out: list[Retrieved] = []
        for mid, doc, dist, meta in zip(ids, documents, distances, metadatas):
            score = 1.0 - float(dist)
            if score < _MIN_SCORE:
                continue
            memory = Memory(id=mid, kind=cast(MemoryKind, meta["kind"]), content=doc)
            out.append(
                Retrieved(
                    memory=memory,
                    score=score,
                    reason=f"cosine similarity {score:.3f}",
                )
            )
        return out

    def write(self, content: str, kind: MemoryKind) -> Memory:
        new_id = f"mem_auto_{next(self._auto_id)}"
        self._collection.add(
            ids=[new_id],
            documents=[content],
            embeddings=_embed([content]),
            metadatas=[{"kind": kind}],
        )
        return Memory(id=new_id, kind=kind, content=content)

    def update(self, memory_id: str, content: str) -> Memory:
        kind = self._kind_of(memory_id)
        self._collection.update(
            ids=[memory_id],
            documents=[content],
            embeddings=_embed([content]),
            metadatas=[{"kind": kind}],
        )
        return Memory(id=memory_id, kind=kind, content=content)

    def delete(self, memory_id: str) -> None:
        self._collection.delete(ids=[memory_id])

    def snapshot(self) -> list[Memory]:
        result = self._collection.get()
        ids = result["ids"]
        documents = result.get("documents") or []
        metadatas = result.get("metadatas") or []
        return [
            Memory(id=mid, kind=cast(MemoryKind, meta["kind"]), content=doc)
            for mid, doc, meta in zip(ids, documents, metadatas)
        ]
