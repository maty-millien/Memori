import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { ChatModel, ChatSettings } from "@/shared/lib/memori";

import { getChatSettings } from "./db";

const MODEL = "gpt-6-luna";
const REASONING_EFFORT = "low";
const BASE_URL = "https://chatgpt.com/backend-api/codex";
const CLIENT_VERSION = "0.163.0";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_PATH = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");

export const itemSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  call_id: z.string().optional(),
  arguments: z.string().optional(),
  summary: z.array(z.looseObject({ text: z.string() })).optional(),
  action: z.looseObject({ query: z.string().optional() }).optional(),
  content: z.array(z.looseObject({ text: z.string().optional() })).optional(),
});

export type Item = z.infer<typeof itemSchema>;

const streamEvent = z.looseObject({
  type: z.string(),
  item: itemSchema.optional(),
  item_id: z.string().optional(),
  delta: z.string().optional(),
  message: z.string().optional(),
  response: z
    .looseObject({
      usage: z
        .object({
          input_tokens: z.number(),
          input_tokens_details: z.object({ cached_tokens: z.number() }).nullish(),
          output_tokens: z.number(),
          output_tokens_details: z.object({ reasoning_tokens: z.number() }).nullish(),
        })
        .nullish(),
      error: z.object({ message: z.string() }).nullish(),
    })
    .optional(),
});

type StreamEvent = z.infer<typeof streamEvent>;

export type Tool = {
  definition: { type: "function"; name: string; [key: string]: unknown };
  run: (args: string, callId: string) => Promise<string>;
};

export type TurnUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  context: number;
};

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

async function codexFetch(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const tokens = await credentials();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "chatgpt-account-id": tokens.account_id,
      originator: "codex_cli_rs",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Codex ${response.status}: ${await response.text()}`);
  }
  return response;
}

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

export async function chatOptions() {
  const response = await codexFetch(`/models?client_version=${CLIENT_VERSION}`);
  const models: ChatModel[] = modelList
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
  const stored = getChatSettings();
  const model = models.find((entry) => entry.id === stored.model) ?? models[0];
  const settings: ChatSettings = {
    model: model.id,
    effort:
      stored.effort && model.efforts.includes(stored.effort)
        ? stored.effort
        : model.defaultEffort,
  };
  return { models, settings };
}

async function* respond(body: object) {
  const response = await codexFetch("/responses", {
    method: "POST",
    headers: { "OpenAI-Beta": "responses=experimental", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body!) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const data = buffer
        .slice(0, end)
        .split("\n")
        .find((line) => line.startsWith("data: "));
      buffer = buffer.slice(end + 2);
      if (data) {
        yield streamEvent.parse(JSON.parse(data.slice(6)));
      }
    }
  }
}

type AgentOptions = {
  instructions: string;
  input: Item[];
  model?: string;
  effort?: string;
  tools?: Tool[];
  webSearch?: boolean;
  schema?: unknown;
  onEvent?: (event: StreamEvent) => void;
};

export async function runAgent(
  {
    instructions,
    input,
    model = MODEL,
    effort = REASONING_EFFORT,
    tools = [],
    webSearch = false,
    schema,
    onEvent,
  }: AgentOptions,
  items: Item[] = [],
  usage: TurnUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    context: 0,
  },
): Promise<{ text: string; usage: TurnUsage; items: Item[] }> {
  const output: Item[] = [];
  for await (const event of respond({
    model,
    instructions,
    input: [...input, ...items],
    tools: [
      ...(webSearch ? [{ type: "web_search" }] : []),
      ...tools.map((tool) => tool.definition),
    ],
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort, summary: "auto" },
    include: ["reasoning.encrypted_content"],
    text: schema
      ? { format: { type: "json_schema", name: "output", strict: true, schema } }
      : undefined,
    prompt_cache_key: "memori",
    store: false,
    stream: true,
  })) {
    if (event.type === "response.output_item.done" && event.item) {
      output.push(event.item);
    }
    const last = event.response?.usage;
    if (event.type === "response.completed" && last) {
      usage.inputTokens += last.input_tokens;
      usage.cachedInputTokens += last.input_tokens_details?.cached_tokens ?? 0;
      usage.outputTokens += last.output_tokens;
      usage.reasoningOutputTokens += last.output_tokens_details?.reasoning_tokens ?? 0;
      usage.context = last.input_tokens + last.output_tokens;
    }
    if (event.type === "response.failed" || event.type === "error") {
      throw new Error(
        event.response?.error?.message ?? event.message ?? "Codex response failed",
      );
    }
    onEvent?.(event);
  }
  items.push(...output);
  const calls = output.filter((entry) => entry.type === "function_call");
  if (calls.length === 0) {
    const reply = output.findLast((entry) => entry.type === "message");
    const text = (reply?.content ?? []).map((part) => part.text ?? "").join("");
    return { text, usage, items };
  }
  items.push(
    ...(await Promise.all(
      calls.map(async (call) => {
        const tool = tools.find((entry) => entry.definition.name === call.name);
        return {
          type: "function_call_output",
          call_id: call.call_id,
          output: tool
            ? await tool.run(call.arguments ?? "", call.call_id ?? "")
            : `Unknown tool "${call.name}"`,
        };
      }),
    )),
  );
  return runAgent(
    { instructions, input, model, effort, tools, webSearch, schema, onEvent },
    items,
    usage,
  );
}

export function runOnce(instructions: string, prompt: string, schema?: unknown) {
  return runAgent({
    instructions,
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    schema,
  });
}
