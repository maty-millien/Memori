import type { UIMessage } from "ai";

export const SCOPES = ["global", "topical"] as const;
export const CONTEXT_WINDOW = 272_000;
export const KINDS = ["memory", "conversation"] as const;
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const EFFORT_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
} as const;
export const CHAT_MODELS = {
  "gpt-6-luna": "GPT-6-Luna",
  "gpt-6.1-sol": "GPT-6.1-Sol",
  "gpt-6-astra": "GPT-6-Astra",
} as const;
export const CHAT_MODEL_IDS = ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"] as const;
export const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
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
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ChatModel = (typeof CHAT_MODEL_IDS)[number];
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export type ChatSettings = { model: ChatModel; effort: ReasoningEffort };

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
  ms: number;
};

export type MemoryOperation = {
  action: "upsert" | "delete";
  memory_id: string | null;
  content: string | null;
  scope: Scope | null;
  importance: Importance | null;
  result: string;
};

type MemoriData = {
  retrieval: { memories: RetrievedMemory[]; recent: Memory[]; similar: Memory[] };
  prompt: { prompt: string };
  thought: { ms: number };
  command: { command: string; running: boolean; exitCode: number | null; output: string };
  search: { query: string; running: boolean };
  curation: { prompt: string; operations: MemoryOperation[] };
  compaction: { episodeId: string; summary: string; messageCount: number };
  usage: {
    retrievalMs: number;
    chat: CallUsage;
    curation: CallUsage | null;
    context?: number;
    chatModel?: ChatModel;
    chatEffort?: ReasoningEffort;
  };
  error: { message: string };
};

export type MemoriUIMessage = UIMessage<{ createdAt: string }, MemoriData>;
