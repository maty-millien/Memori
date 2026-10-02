import type { UIMessage } from "ai";

export const SCOPES = ["global", "topical"] as const;
export const CONTEXT_WINDOW = 272_000;
export const KINDS = ["memory", "conversation"] as const;
export const IMPORTANCES = [
  "identity",
  "global_preference",
  "active_project",
  "useful_fact",
  "uncertain",
] as const;

export type Scope = (typeof SCOPES)[number];
export type Kind = (typeof KINDS)[number];
export type Importance = (typeof IMPORTANCES)[number];

export type Memory = {
  id: string;
  content: string;
  scope: Scope;
  kind: Kind;
  importance: Importance;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
};

export type Score = {
  similarity: number;
  semantic: number;
  importance: number;
  recency: number;
  usage: number;
  scope: number;
  total: number;
};

export type RetrievedMemory = { memory: Memory; score: Score };

export type CallUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  requests: number;
  ms: number;
};

type MemoriData = {
  retrieval: { memories: RetrievedMemory[]; recent: Memory[]; similar: Memory[] };
  prompt: { prompt: string };
  curation: { startedAt: string };
  compaction: { episodeId: string; summary: string; messageCount: number };
  usage: { retrievalMs: number; chat: CallUsage; curation: CallUsage | null };
  error: { message: string };
};

export type MemoryUpsertInput = {
  content: string;
  memory_id?: string | null;
  scope?: Scope;
  importance?: Importance;
};

export type MemoryDeleteInput = { memory_id: string };

type MemoriTools = {
  memory_upsert: { input: MemoryUpsertInput; output: string };
  memory_delete: { input: MemoryDeleteInput; output: string };
};

export type MemoriUIMessage = UIMessage<{ createdAt: string }, MemoriData, MemoriTools>;
