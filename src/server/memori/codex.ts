import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";

export const MODEL = "gpt-6-luna";
export const REASONING_EFFORT = "low";
export const NOT_SIGNED_IN =
  "Codex is not signed in. Run 'codex login' to refresh the token in auth.json.";

const BASE_URL = "https://chatgpt.com/backend-api/codex";

async function readTokens() {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  try {
    const auth = JSON.parse(await readFile(join(codexHome, "auth.json"), "utf8"));
    const accessToken: unknown = auth?.tokens?.access_token;
    const accountId: unknown = auth?.tokens?.account_id;
    if (typeof accessToken === "string" && typeof accountId === "string") {
      return { accessToken, accountId };
    }
  } catch {}
  throw new Error(NOT_SIGNED_IN);
}

const codexFetch: typeof fetch = async (input, init) => {
  const { accessToken, accountId } = await readTokens();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("originator", "codex_cli_rs");
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    throw new Error(NOT_SIGNED_IN);
  }
  return response;
};

const provider = createOpenAI({ baseURL: BASE_URL, apiKey: "codex", fetch: codexFetch });

export const codexModel = provider.responses(MODEL);

export const codexProviderOptions = {
  openai: {
    store: false,
    reasoningEffort: REASONING_EFFORT,
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"],
  } satisfies OpenAILanguageModelResponsesOptions,
};
