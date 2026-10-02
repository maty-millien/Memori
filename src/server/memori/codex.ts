import { spawn } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

import type { ChatModel, ChatSettings } from "@/shared/lib/memori";

import { getChatSettings } from "./db";

const MODEL = "gpt-6-luna";
const REASONING_EFFORT = "low";
const CODEX_HOME = resolve(".memori/codex");

type CodexItem =
  | { type: "userMessage"; id: string }
  | { type: "agentMessage"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[] }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | { type: "webSearch"; id: string; query: string };

type RawItem = { type: string; role?: string; content?: { text?: string }[] };

type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

type CodexNotification =
  | {
      method: "item/started" | "item/completed";
      params: { threadId: string; item: CodexItem };
    }
  | {
      method: "item/agentMessage/delta";
      params: { threadId: string; itemId: string; delta: string };
    }
  | { method: "rawResponseItem/completed"; params: { threadId: string; item: RawItem } }
  | {
      method: "thread/tokenUsage/updated";
      params: {
        threadId: string;
        tokenUsage: { last: Usage };
      };
    }
  | {
      method: "turn/completed";
      params: {
        threadId: string;
        turn: { status: string; error: { message: string } | null };
      };
    };

type Message =
  | (CodexNotification & { id?: number })
  | { id: number; method?: undefined; result?: unknown; error?: { message: string } };

type Client = {
  request: (method: string, params: unknown) => Promise<unknown>;
  listeners: Set<(notification: CodexNotification) => void>;
};

export type Thread = { client: Client; id: string };

export type TurnUsage = Usage & { context: number };

let current: Promise<Client> | null = null;

async function createClient() {
  mkdirSync(CODEX_HOME, { recursive: true });
  const auth = join(CODEX_HOME, "auth.json");
  if (!existsSync(auth)) {
    symlinkSync(
      join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"),
      auth,
    );
  }
  const child = spawn("codex", ["app-server"], {
    cwd: tmpdir(),
    env: { ...process.env, CODEX_HOME },
  });
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const listeners = new Set<(notification: CodexNotification) => void>();
  let nextId = 1;
  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
  child.stderr.resume();
  child.on("exit", () => {
    current = null;
    for (const { reject } of pending.values()) {
      reject(new Error("Codex app-server exited"));
    }
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message: Message = JSON.parse(line);
    if (message.method === undefined) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        request?.reject(new Error(message.error.message));
      } else {
        request?.resolve(message.result);
      }
    } else if (message.id === undefined) {
      for (const listener of listeners) {
        listener(message);
      }
    } else {
      send({ id: message.id, error: { code: -32601, message: "Unsupported request" } });
    }
  });
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolvePromise, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolvePromise, reject });
      send({ id, method, params });
    });
  await request("initialize", {
    clientInfo: { name: "memori", title: "Memori", version: "1.0.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  send({ method: "initialized" });
  return { request, listeners };
}

export function codexClient() {
  current ??= createClient();
  return current;
}

const threadStart = z.object({ thread: z.object({ id: z.string() }) });

const modelList = z.object({
  data: z.array(
    z.object({
      model: z.string(),
      displayName: z.string(),
      hidden: z.boolean(),
      isDefault: z.boolean(),
      defaultReasoningEffort: z.string(),
      inputModalities: z.array(z.string()),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })),
    }),
  ),
});

export async function chatOptions() {
  const client = await codexClient();
  const { data } = modelList.parse(await client.request("model/list", {}));
  const visible = data.filter((item) => !item.hidden);
  const models: ChatModel[] = visible.map((item) => ({
    id: item.model,
    name: item.displayName,
    efforts: item.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    defaultEffort: item.defaultReasoningEffort,
    images: item.inputModalities.includes("image"),
  }));
  const stored = getChatSettings();
  const model =
    models.find((item) => item.id === stored.model) ??
    models[visible.findIndex((item) => item.isDefault)] ??
    models[0];
  const settings: ChatSettings = {
    model: model.id,
    effort:
      stored.effort && model.efforts.includes(stored.effort)
        ? stored.effort
        : model.defaultEffort,
  };
  return { models, settings };
}

export async function startThread(
  instructions: string,
  webSearch: boolean,
): Promise<Thread> {
  const client = await codexClient();
  const result = await client.request("thread/start", {
    cwd: tmpdir(),
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    baseInstructions: instructions,
    ephemeral: true,
    experimentalRawEvents: true,
    config: {
      web_search: webSearch ? "live" : "disabled",
      skills: { include_instructions: false },
    },
  });
  return { client, id: threadStart.parse(result).thread.id };
}

export function runTurn(
  thread: Thread,
  {
    text,
    images = [],
    model = MODEL,
    effort = REASONING_EFFORT,
    schema,
    onNotification,
  }: {
    text: string;
    images?: string[];
    model?: string;
    effort?: string;
    schema?: unknown;
    onNotification?: (notification: CodexNotification) => void;
  },
) {
  return new Promise<{ text: string; usage: TurnUsage; items: RawItem[] }>(
    (resolvePromise, reject) => {
      let reply = "";
      const items: RawItem[] = [];
      const usage: TurnUsage = {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        context: 0,
      };
      const listener = (notification: CodexNotification) => {
        if (notification.params.threadId !== thread.id) {
          return;
        }
        switch (notification.method) {
          case "rawResponseItem/completed":
            items.push(notification.params.item);
            break;
          case "thread/tokenUsage/updated": {
            const { last } = notification.params.tokenUsage;
            usage.inputTokens += last.inputTokens;
            usage.cachedInputTokens += last.cachedInputTokens;
            usage.outputTokens += last.outputTokens;
            usage.reasoningOutputTokens += last.reasoningOutputTokens;
            usage.context = last.inputTokens + last.outputTokens;
            break;
          }
          case "item/completed":
            if (notification.params.item.type === "agentMessage") {
              reply = notification.params.item.text;
            }
            break;
          case "turn/completed": {
            thread.client.listeners.delete(listener);
            const { turn } = notification.params;
            if (turn.status === "completed") {
              const start = items.findIndex(
                (item) => item.role === "user" && item.content?.[0]?.text === text,
              );
              resolvePromise({
                text: reply,
                usage,
                items: items.slice(Math.max(start, 0)),
              });
            } else {
              reject(new Error(turn.error?.message ?? `Codex turn ${turn.status}`));
            }
            break;
          }
          default:
            break;
        }
        onNotification?.(notification);
      };
      thread.client.listeners.add(listener);
      thread.client
        .request("turn/start", {
          threadId: thread.id,
          input: [
            { type: "text", text, text_elements: [] },
            ...images.map((path) => ({ type: "localImage", path })),
          ],
          model,
          effort,
          outputSchema: schema,
        })
        .catch((error: unknown) => {
          thread.client.listeners.delete(listener);
          reject(error);
        });
    },
  );
}

export async function runOnce(instructions: string, prompt: string, schema?: unknown) {
  const thread = await startThread(instructions, false);
  try {
    return await runTurn(thread, { text: prompt, schema });
  } finally {
    void thread.client
      .request("thread/unsubscribe", { threadId: thread.id })
      .catch(() => {});
  }
}
