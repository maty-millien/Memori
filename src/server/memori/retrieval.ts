import type { Memory, RetrievedMemory } from "@/shared/lib/memori";

import { SETTINGS } from "./config";
import { listMemoryVectors, markAccessed } from "./db";

type Vector = { memory: Memory; embedding: Float32Array };

function cosine(a: Float32Array, b: Float32Array) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

function nearest(vectors: Vector[], query: Float32Array, count: number) {
  return vectors
    .map(({ memory, embedding }) => ({ memory, similarity: cosine(query, embedding) }))
    .toSorted((a, b) => b.similarity - a.similarity)
    .slice(0, count);
}

function rank(memory: Memory, similarity: number): RetrievedMemory {
  const ageDays = Math.max(0, Date.now() - Date.parse(memory.updatedAt)) / 86_400_000;
  const usage =
    memory.accessCount <= 0
      ? 0
      : Math.min(1, Math.log1p(memory.accessCount) / Math.log1p(10));
  const score = {
    similarity,
    semantic: SETTINGS.rankSemanticWeight * similarity,
    importance:
      SETTINGS.rankImportanceWeight * SETTINGS.importanceWeights[memory.importance],
    recency: SETTINGS.rankRecencyWeight * (1 / (1 + ageDays / 30)),
    usage: SETTINGS.rankUsageWeight * usage,
    scope: memory.scope === "global" ? SETTINGS.rankGlobalScopeBoost : 0,
  };
  const total =
    score.semantic + score.importance + score.recency + score.usage + score.scope;
  return { memory, score: { ...score, total } };
}

export function retrieve(query: Float32Array) {
  const memories = listMemoryVectors("memory");
  const candidates = new Map(
    nearest(memories, query, SETTINGS.retrievalPoolK).map(({ memory, similarity }) => [
      memory.id,
      { memory, similarity },
    ]),
  );
  for (const { memory } of memories) {
    if (memory.scope === "global" && !candidates.has(memory.id)) {
      candidates.set(memory.id, { memory, similarity: 0 });
    }
  }
  const retrieved = [...candidates.values()]
    .map(({ memory, similarity }) => rank(memory, similarity))
    .toSorted((a, b) => b.score.total - a.score.total)
    .slice(0, SETTINGS.retrievalTopK);
  markAccessed(retrieved.map((item) => item.memory.id));

  const conversations = listMemoryVectors("conversation");
  const recent = conversations
    .map(({ memory }) => memory)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, SETTINGS.recentConversations);
  const recentIds = new Set(recent.map((memory) => memory.id));
  const similar = nearest(
    conversations.filter(({ memory }) => !recentIds.has(memory.id)),
    query,
    SETTINGS.similarConversations,
  ).map(({ memory }) => memory);

  return { memories: retrieved, recent, similar };
}
