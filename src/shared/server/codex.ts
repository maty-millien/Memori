import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type LanguageModelUsage, type OutputInterface } from "ai";
import { z } from "zod";

import {
  effortFor,
  type CallUsage,
  type ChatModel,
  type ChatSettings,
} from "@/shared/lib/remanence";

import { getChatSettings } from "./db";

const MODEL = "gpt-6-luna";
const REASONING_EFFORT = "low";
const BASE_URL = "https://chatgpt.com/backend-api/codex";
const CLIENT_VERSION = "0.163.0";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_PATH = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");

const authFile = z.looseObject({
  tokens: z.looseObject({
    access_token: z.string(),
    refresh_token: z.string(),
    account_id: z.string(),
  }),
});

const refreshed = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string(),
});

async function credentials() {
  const auth = authFile.parse(JSON.parse(readFileSync(AUTH_PATH, "utf8")));
  const { exp } = z
    .object({ exp: z.number() })
    .parse(
      JSON.parse(
        Buffer.from(auth.tokens.access_token.split(".")[1], "base64url").toString(),
      ),
    );
  if (exp * 1000 > Date.now() + 60_000) {
    return auth.tokens;
  }
  const response = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.tokens.refresh_token,
      scope: "openid profile email",
    }),
  });
  if (!response.ok) {
    throw new Error(`Codex token refresh failed: ${await response.text()}`);
  }
  const tokens = { ...auth.tokens, ...refreshed.parse(await response.json()) };
  writeFileSync(
    AUTH_PATH,
    JSON.stringify({ ...auth, tokens, last_refresh: new Date().toISOString() }, null, 2),
  );
  return tokens;
}

async function codexFetch(input: string | URL | Request, init: RequestInit = {}) {
  const tokens = await credentials();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tokens.access_token}`);
  headers.set("chatgpt-account-id", tokens.account_id);
  headers.set("originator", "codex_cli_rs");
  return fetch(input, { ...init, headers });
}

export const codex = createOpenAI({
  baseURL: BASE_URL,
  apiKey: "codex",
  fetch: codexFetch,
});

const modelList = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      display_name: z.string(),
      visibility: z.string(),
      priority: z.number(),
      default_reasoning_level: z.string(),
      input_modalities: z.array(z.string()),
      supported_reasoning_levels: z.array(z.object({ effort: z.string() })),
    }),
  ),
});

let cachedModels: ChatModel[] | undefined;

async function fetchModels() {
  const response = await codexFetch(
    `${BASE_URL}/models?client_version=${CLIENT_VERSION}`,
  );
  if (!response.ok) {
    throw new Error(`Codex ${response.status}: ${await response.text()}`);
  }
  return modelList
    .parse(await response.json())
    .models.filter((model) => model.visibility === "list")
    .toSorted((a, b) => a.priority - b.priority)
    .map((model) => ({
      id: model.slug,
      name: model.display_name,
      efforts: model.supported_reasoning_levels.map((level) => level.effort),
      defaultEffort: model.default_reasoning_level,
      images: model.input_modalities.includes("image"),
    }));
}

export async function chatOptions() {
  cachedModels ??= await fetchModels();
  const models = cachedModels;
  const stored = getChatSettings();
  const model = models.find((entry) => entry.id === stored.model) ?? models[0];
  const settings: ChatSettings = {
    model: model.id,
    effort: effortFor(model, stored.effort),
  };
  return { models, settings };
}

export function codexOptions(instructions: string, effort = REASONING_EFFORT) {
  return {
    openai: {
      instructions,
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoningEffort: effort,
      reasoningSummary: "auto",
      promptCacheKey: "remanence",
      parallelToolCalls: false,
    },
  };
}

export function tokenUsage(usage: LanguageModelUsage): Omit<CallUsage, "ms"> {
  return {
    inputTokens: usage.inputTokens!,
    cachedTokens: usage.inputTokenDetails.cacheReadTokens!,
    outputTokens: usage.outputTokens!,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens!,
  };
}

export function runOnce<OUTPUT extends OutputInterface = OutputInterface<string, string>>(
  instructions: string,
  prompt: string,
  output?: OUTPUT,
) {
  return streamText({
    model: codex.responses(MODEL),
    providerOptions: codexOptions(instructions),
    prompt,
    output,
  });
}
