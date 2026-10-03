import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import {
  CONTEXT_WINDOW,
  type AttachmentType,
  type CallUsage,
  type Memory,
  type MemoriUIMessage,
} from "@/shared/lib/memori";

import {
  chatOptions,
  runTurn,
  startThread,
  codexClient,
  type Thread,
  type TurnUsage,
} from "./codex";
import { SETTINGS } from "./config";
import { curate } from "./curation";
import { getThreadItems, listLiveMessages, saveMessage, saveThreadItems } from "./db";
import { embedOne } from "./embeddings";
import { createEpisode } from "./episodes";
import {
  buildContextPrompt,
  formatMemories,
  timestampedUserContent,
  wrap,
} from "./prompting";
import { CHAT_PROMPT } from "./prompts";
import { retrieve } from "./retrieval";
import { transcript, userContent } from "./transcript";
import { saveUpload, uploadPath } from "./uploads";

export type Attachment = {
  bytes: Uint8Array;
  mediaType: AttachmentType;
  filename: string;
};

let chat: { thread: Thread; messages: string[] } | null = null;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const unwrapShell = (command: string) =>
  /^\/bin\/zsh -lc (['"])([\s\S]*)\1$/.exec(command)?.[2] ?? command;

const memoryKey = (memory: Memory) => `${memory.id}@${memory.updatedAt}`;

function callUsage(usage: TurnUsage, ms: number): CallUsage {
  return {
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningOutputTokens,
    ms,
  };
}

function seedItems(history: MemoriUIMessage[]) {
  return history.flatMap((message, index) => {
    if (message.role === "user") {
      return [];
    }
    const stored = getThreadItems(message.id);
    if (stored) {
      return stored;
    }
    const prompt = message.parts.find((part) => part.type === "data-prompt")?.data.prompt;
    const previous = history[index - 1];
    const user =
      prompt ??
      (previous
        ? timestampedUserContent(
            userContent(previous),
            new Date(previous.metadata?.createdAt ?? Date.now()),
          )
        : "");
    const reply = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n");
    return [
      { type: "message", role: "user", content: [{ type: "input_text", text: user }] },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: reply }],
      },
    ];
  });
}

async function chatThread(history: MemoriUIMessage[]) {
  const ids = history.map((message) => message.id);
  if (
    chat &&
    chat.thread.client === (await codexClient()) &&
    chat.messages.join() === ids.join()
  ) {
    return chat;
  }
  const thread = await startThread(CHAT_PROMPT, true);
  const items = seedItems(history);
  if (items.length > 0) {
    await thread.client.request("thread/inject_items", { threadId: thread.id, items });
  }
  chat = { thread, messages: ids };
  return chat;
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
  let turn: { session: NonNullable<typeof chat>; items: unknown[] } | null = null;

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

      const session = await chatThread(history);
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
      const reply = await runTurn(session.thread, {
        text: prompt,
        model: chatSettings.model,
        effort: chatSettings.effort,
        images: userMessage.parts.flatMap((part) =>
          part.type === "file" && part.mediaType.startsWith("image/")
            ? [uploadPath(part.url)]
            : [],
        ),
        onNotification: (notification) => {
          if (notification.method === "item/agentMessage/delta") {
            writer.write({
              type: "text-delta",
              id: notification.params.itemId,
              delta: notification.params.delta,
            });
            return;
          }
          if (
            notification.method !== "item/started" &&
            notification.method !== "item/completed"
          ) {
            return;
          }
          const { item } = notification.params;
          const done = notification.method === "item/completed";
          switch (item.type) {
            case "reasoning":
              if (done && item.summary.length > 0) {
                writer.write({ type: "reasoning-start", id: item.id });
                writer.write({
                  type: "reasoning-delta",
                  id: item.id,
                  delta: item.summary.join("\n\n"),
                });
                writer.write({ type: "reasoning-end", id: item.id });
              }
              break;
            case "agentMessage":
              if (done) {
                writer.write({ type: "text-end", id: item.id });
                since = performance.now();
              } else {
                thought();
                writer.write({ type: "text-start", id: item.id });
              }
              break;
            case "commandExecution":
              thought();
              writer.write({
                type: "data-command",
                id: item.id,
                data: {
                  command: unwrapShell(item.command),
                  running: !done,
                  exitCode: item.exitCode,
                  output: (item.aggregatedOutput ?? "").slice(-20_000),
                },
              });
              if (done) {
                since = performance.now();
              }
              break;
            case "webSearch":
              thought();
              writer.write({
                type: "data-search",
                id: item.id,
                data: { query: item.query, running: !done },
              });
              if (done) {
                since = performance.now();
              }
              break;
            default:
              break;
          }
        },
      }).catch((error: unknown) => {
        chat = null;
        throw error;
      });
      const chatUsage = callUsage(
        reply.usage,
        Math.round(performance.now() - chatStarted),
      );

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
        curationUsage = callUsage(curation.usage, curation.ms);
        writer.write({
          type: "data-curation",
          data: { prompt: curationPrompt, operations: curation.operations },
        });
      } catch (error) {
        writer.write({ type: "data-error", data: { message: errorMessage(error) } });
      }

      if (reply.usage.context > CONTEXT_WINDOW) {
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
          context: reply.usage.context,
          chatModel: chatSettings.model,
          chatEffort: chatSettings.effort,
        },
      });
      writer.write({ type: "finish" });
      turn = { session, items: reply.items };
    },
    onEnd: ({ responseMessage }) => {
      if (!turn) {
        return;
      }
      saveMessage(userMessage);
      saveMessage({
        ...responseMessage,
        metadata: { createdAt: new Date().toISOString() },
      });
      saveThreadItems(responseMessage.id, turn.items);
      turn.session.messages.push(userMessage.id, responseMessage.id);
    },
  });

  return createUIMessageStreamResponse({ stream });
}
