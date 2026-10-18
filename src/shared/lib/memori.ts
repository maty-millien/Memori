import type { UIMessage } from "ai";

export const SCOPES = ["global", "topical"] as const;
export const CONTEXT_WINDOW = 100_000;
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
export type ChatSettings = { model: string; effort: string };
export type Question = {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiple: boolean;
};
export type ChatModel = {
  id: string;
  name: string;
  efforts: string[];
  defaultEffort: string;
  images: boolean;
};

export function effortLabel(effort: string) {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function effortFor(model: ChatModel, effort: string | undefined) {
  return effort && model.efforts.includes(effort) ? effort : model.defaultEffort;
}

export function messageText(parts: { type: string; text?: string }[], separator = "") {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.text ?? ""] : []))
    .join(separator);
}

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
  cachedTokens: number;
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
  read: { path: string; running: boolean };
  patch: { patch: string; running: boolean; output: string };
  question: { questions: Question[]; answers: string[][] | null };
  curation: { prompt: string; operations: MemoryOperation[] };
  compaction: { episodeId: string; summary: string; messageCount: number };
  usage: {
    retrievalMs: number;
    chat: CallUsage;
    curation: CallUsage | null;
    context: number;
    chatModel: string;
    chatEffort: string;
  };
  error: { message: string };
};

export type MemoriUIMessage = UIMessage<{ createdAt: string }, MemoriData>;
