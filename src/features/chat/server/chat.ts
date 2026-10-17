import { spawn } from "node:child_process";
import { homedir } from "node:os";

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const memoryKey = (memory: Memory) => `${memory.id}@${memory.updatedAt}`;

function shell(command: string) {
  return new Promise<{ output: string; exitCode: number | null }>((resolve) => {
    const child = spawn("/bin/zsh", ["-lc", command], {
      cwd: homedir(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (exitCode) => resolve({ output: output.slice(-20_000), exitCode }));
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
          description:
            "Run a zsh command on the user's Mac from their home directory and return its exit code and combined output.",
          strict: true,
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
            additionalProperties: false,
          },
        },
        run: async (args, callId) => {
          const { command } = z.object({ command: z.string() }).parse(JSON.parse(args));
          const data = { command, running: true, exitCode: null, output: "" };
          thought();
          writer.write({ type: "data-command", id: callId, data });
          const result = await shell(command);
          writer.write({
            type: "data-command",
            id: callId,
            data: { ...data, running: false, ...result },
          });
          since = performance.now();
          return `exit code: ${result.exitCode}\n${result.output}`;
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

  return createUIMessageStreamResponse({ stream });
}
