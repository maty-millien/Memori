import { spawn } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUIMessageChunk,
} from "ai";
import { z } from "zod";

import { SETTINGS } from "@/features/memories/server/config";
import { curate } from "@/features/memories/server/curation";
import { embedOne } from "@/features/memories/server/embeddings";
import { createEpisode } from "@/features/memories/server/episodes";
import {
  buildContextPrompt,
  formatMemories,
  timestampedUserContent,
  transcript,
  userContent,
  wrap,
} from "@/features/memories/server/prompting";
import { retrieve } from "@/features/memories/server/retrieval";
import {
  CONTEXT_WINDOW,
  type AttachmentType,
  type CallUsage,
  type Memory,
  type MemoriUIMessage,
} from "@/shared/lib/memori";
import {
  chatOptions,
  itemSchema,
  runAgent,
  type Item,
  type Tool,
} from "@/shared/server/codex";
import {
  getThreadItems,
  listLiveMessages,
  saveMessage,
  saveThreadItems,
} from "@/shared/server/db";
import { saveUpload } from "@/shared/server/uploads";

import { CHAT_PROMPT } from "./prompts";

export type Attachment = {
  bytes: Uint8Array;
  mediaType: AttachmentType;
  filename: string;
};

type Chunk = InferUIMessageChunk<MemoriUIMessage>;

let activeTurn: {
  userMessage: MemoriUIMessage;
  chunks: Chunk[];
  followers: Set<ReadableStreamDefaultController<Chunk>>;
} | null = null;

export const activeUserMessage = () => activeTurn?.userMessage;

export function resumeResponse() {
  const turn = activeTurn;
  if (!turn) {
    return new Response(null, { status: 204 });
  }
  let follower: ReadableStreamDefaultController<Chunk>;
  const stream = new ReadableStream<Chunk>({
    start(controller) {
      follower = controller;
      for (const chunk of turn.chunks) {
        controller.enqueue(chunk);
      }
      turn.followers.add(controller);
    },
    cancel() {
      turn.followers.delete(follower);
    },
  });
  return createUIMessageStreamResponse({ stream });
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const memoryKey = (memory: Memory) => `${memory.id}@${memory.updatedAt}`;

const SHELL_TIMEOUT_MS = 120_000;
const SHELL_MAX_LINES = 2_000;
const SHELL_MAX_BYTES = 50 * 1024;
const SHELL_OUTPUT_DIR = ".memori/shell";

type ShellResult = { output: string; exitCode: number | null };

function shell(command: string, workdir: string | null, timeout: number | null) {
  const cwd = resolve(homedir(), workdir?.replace(/^~(?=$|\/)/, homedir()) ?? ".");
  if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    return Promise.resolve<ShellResult>({
      output: `Working directory is not a directory: ${cwd}`,
      exitCode: null,
    });
  }
  const ms = timeout ?? SHELL_TIMEOUT_MS;
  return new Promise<ShellResult>((done) => {
    const child = spawn("/bin/zsh", ["-c", command], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color", AGENT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const kill = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal);
      } catch {}
    };
    let timedOut = false;
    const timer =
      ms > 0
        ? setTimeout(() => {
            timedOut = true;
            kill("SIGTERM");
            setTimeout(() => kill("SIGKILL"), 3_000).unref();
          }, ms)
        : undefined;
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8");
      const lines = text.replace(/\n$/, "").split("\n");
      let shown = lines.slice(-SHELL_MAX_LINES).join("\n");
      if (Buffer.byteLength(shown) > SHELL_MAX_BYTES) {
        shown = Buffer.from(shown).subarray(-SHELL_MAX_BYTES).toString("utf8");
      }
      let body = shown || "(no output)";
      if (shown.length < lines.join("\n").length) {
        mkdirSync(SHELL_OUTPUT_DIR, { recursive: true });
        const file = resolve(SHELL_OUTPUT_DIR, `${crypto.randomUUID()}.out`);
        writeFileSync(file, text);
        const count = shown.split("\n").length;
        body += `\n\n[showing lines ${lines.length - count + 1}-${lines.length} of ${lines.length}; full output saved to ${file}]`;
      }
      const status = timedOut
        ? `Command exceeded timeout of ${ms} ms. Retry with a larger timeout if the command is expected to take longer.`
        : signal
          ? `Killed by ${signal}`
          : exitCode !== 0
            ? `Exited with code ${exitCode}`
            : "";
      done({ output: [body, status].filter(Boolean).join("\n\n"), exitCode });
    });
  });
}

function seedItems(history: MemoriUIMessage[]) {
  return history.flatMap((message) =>
    message.role === "user"
      ? []
      : z.array(itemSchema).parse(getThreadItems(message.id) ?? []),
  );
}

export function chatResponse(messageId: string, text: string, files: Attachment[]) {
  const history = listLiveMessages();
  const createdAt = new Date();
  const userMessage: MemoriUIMessage = {
    id: messageId,
    role: "user",
    parts: [
      ...files.map((file) => ({
        type: "file" as const,
        mediaType: file.mediaType,
        filename: file.filename,
        url: saveUpload(file.bytes, file.mediaType),
      })),
      ...(text ? [{ type: "text" as const, text }] : []),
    ],
    metadata: { createdAt: createdAt.toISOString() },
  };
  let items: Item[] | null = null;

  const stream = createUIMessageStream<MemoriUIMessage>({
    originalMessages: [...history, userMessage],
    onError: errorMessage,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });

      const { settings: chatSettings } = await chatOptions();
      const body = userContent(userMessage);
      const retrievalStarted = performance.now();
      const { live, ...retrieval } = retrieve(
        await embedOne(body, "query"),
        history[0]?.metadata?.createdAt,
      );
      const retrievalMs = Math.round(performance.now() - retrievalStarted);
      const seen = new Set(
        history.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "data-retrieval"
              ? [
                  ...part.data.memories.map((item) => item.memory),
                  ...part.data.recent,
                  ...part.data.similar,
                ].map(memoryKey)
              : [],
          ),
        ),
      );
      const unseen = (memories: Memory[]) =>
        memories.filter((memory) => !seen.has(memoryKey(memory)));
      const current = timestampedUserContent(body, createdAt);
      const prompt = buildContextPrompt(
        current,
        unseen(retrieval.memories.map((item) => item.memory)),
        unseen(retrieval.recent),
        unseen(retrieval.similar),
      );
      writer.write({ type: "data-retrieval", data: retrieval });
      writer.write({ type: "data-prompt", data: { prompt } });

      const userItem: Item = {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...files.flatMap((file) =>
            file.mediaType.startsWith("image/")
              ? [
                  {
                    type: "input_image",
                    image_url: `data:${file.mediaType};base64,${Buffer.from(file.bytes).toString("base64")}`,
                  },
                ]
              : [],
          ),
        ],
      };
      const chatStarted = performance.now();
      let since: number | null = chatStarted;
      const thought = () => {
        if (since !== null) {
          writer.write({
            type: "data-thought",
            data: { ms: Math.round(performance.now() - since) },
          });
          since = null;
        }
      };
      const shellTool: Tool = {
        definition: {
          type: "function",
          name: "shell",
          description: `Run a zsh command on the user's Mac and return its combined output. Quote file paths containing spaces or special characters. When output is large, the full result is saved to a file and the last ${SHELL_MAX_LINES} lines are returned.`,
          strict: true,
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Shell command string to execute" },
              workdir: {
                type: ["string", "null"],
                description:
                  "Working directory to execute the command in. Defaults to the user's home directory. Set it here instead of changing directories in the command.",
              },
              timeout: {
                type: ["integer", "null"],
                description: `Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to ${SHELL_TIMEOUT_MS}.`,
              },
            },
            required: ["command", "workdir", "timeout"],
            additionalProperties: false,
          },
        },
        run: async (args, callId) => {
          const { command, workdir, timeout } = z
            .object({
              command: z.string(),
              workdir: z.string().nullable(),
              timeout: z.number().int().nonnegative().nullable(),
            })
            .parse(JSON.parse(args));
          const data = { command, running: true, exitCode: null, output: "" };
          thought();
          writer.write({ type: "data-command", id: callId, data });
          const result = await shell(command, workdir, timeout);
          writer.write({
            type: "data-command",
            id: callId,
            data: { ...data, running: false, ...result },
          });
          since = performance.now();
          return result.output;
        },
      };
      const reply = await runAgent({
        instructions: CHAT_PROMPT,
        input: [...seedItems(history), userItem],
        model: chatSettings.model,
        effort: chatSettings.effort,
        tools: [shellTool],
        webSearch: true,
        onEvent: (event) => {
          if (event.type === "response.output_text.delta" && event.item_id) {
            writer.write({
              type: "text-delta",
              id: event.item_id,
              delta: event.delta ?? "",
            });
            return;
          }
          const output = event.item;
          if (
            !output ||
            (event.type !== "response.output_item.added" &&
              event.type !== "response.output_item.done")
          ) {
            return;
          }
          const id = output.id ?? "";
          const done = event.type === "response.output_item.done";
          switch (output.type) {
            case "reasoning": {
              const summary = (output.summary ?? []).map((part) => part.text);
              if (done && summary.length > 0) {
                writer.write({ type: "reasoning-start", id });
                writer.write({
                  type: "reasoning-delta",
                  id,
                  delta: summary.join("\n\n"),
                });
                writer.write({ type: "reasoning-end", id });
              }
              break;
            }
            case "message":
              if (done) {
                writer.write({ type: "text-end", id });
                since = performance.now();
              } else {
                thought();
                writer.write({ type: "text-start", id });
              }
              break;
            case "web_search_call": {
              thought();
              writer.write({
                type: "data-search",
                id,
                data: { query: output.action?.query ?? "", running: !done },
              });
              if (done) {
                since = performance.now();
              }
              break;
            }
            default:
              break;
          }
        },
      });
      const chatUsage = {
        ...reply.usage,
        ms: Math.round(performance.now() - chatStarted),
      };

      const curationPrompt = [
        wrap(
          "relevant_memories",
          formatMemories([...retrieval.memories.map((item) => item.memory), ...live]) ||
            "(none)",
        ),
        wrap(
          "recent_history",
          transcript(history.slice(-SETTINGS.curationHistoryMessages)) || "(none)",
        ),
        wrap("latest_turn", `user: ${current}\nassistant: ${reply.text}`),
      ].join("\n\n");
      let curationUsage: CallUsage | null = null;
      try {
        const curation = await curate(curationPrompt);
        curationUsage = curation.usage;
        writer.write({
          type: "data-curation",
          data: { prompt: curationPrompt, operations: curation.operations },
        });
      } catch (error) {
        writer.write({ type: "data-error", data: { message: errorMessage(error) } });
      }

      if (reply.context > CONTEXT_WINDOW) {
        try {
          const episode = await createEpisode(history);
          if (episode) {
            writer.write({ type: "data-compaction", data: episode });
          }
        } catch (error) {
          writer.write({ type: "data-error", data: { message: errorMessage(error) } });
        }
      }

      writer.write({
        type: "data-usage",
        data: {
          retrievalMs,
          chat: chatUsage,
          curation: curationUsage,
          context: reply.context,
          chatModel: chatSettings.model,
          chatEffort: chatSettings.effort,
        },
      });
      writer.write({ type: "finish" });
      items = [userItem, ...reply.items];
    },
    onEnd: ({ responseMessage }) => {
      activeTurn = null;
      if (!items) {
        return;
      }
      saveMessage(userMessage);
      saveMessage({
        ...responseMessage,
        metadata: { createdAt: new Date().toISOString() },
      });
      saveThreadItems(responseMessage.id, items);
    },
  });

  const turn = {
    userMessage,
    chunks: [] as Chunk[],
    followers: new Set<ReadableStreamDefaultController<Chunk>>(),
  };
  activeTurn = turn;
  void (async () => {
    for await (const chunk of stream) {
      turn.chunks.push(chunk);
      for (const follower of turn.followers) {
        follower.enqueue(chunk);
      }
    }
    for (const follower of turn.followers) {
      follower.close();
    }
  })();
  return resumeResponse();
}
