import { existsSync } from "node:fs";

export const SETTINGS = {
  embeddingModel: "google/gemini-embedding-2",
  retrievalTopK: 20,
  retrievalPoolK: 40,
  recentConversations: 10,
  similarConversations: 10,
  curationHistoryMessages: 3,
  importanceWeights: {
    identity: 0.95,
    global_preference: 0.9,
    active_project: 0.8,
    useful_fact: 0.6,
    uncertain: 0.35,
  },
  rankSemanticWeight: 0.7,
  rankImportanceWeight: 0.2,
  rankRecencyWeight: 0.07,
  rankUsageWeight: 0.03,
  rankGlobalScopeBoost: 0.1,
} as const;

export function openrouterApiKey() {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const value = process.env.OPENROUTER_API_KEY;
  if (!value) {
    throw new Error("OPENROUTER_API_KEY must be set");
  }
  return value;
}
