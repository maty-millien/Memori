import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import {
  CONTEXT_WINDOW,
  type AttachmentType,
  type CallUsage,
  type MemoriUIMessage,
} from "@/shared/lib/memori";

import { runCodex, type CodexUsage } from "./codex";
import { SETTINGS } from "./config";
import { curate } from "./curation";
import { getChatSettings, listLiveMessages, saveMessage } from "./db";
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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const unwrapShell = (command: string) =>
  /^\/bin\/zsh -lc (['"])([\s\S]*)\1$/.exec(command)?.[2] ?? command;

function callUsage(usage: CodexUsage, ms: number): CallUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.reasoning_output_tokens,
    ms,
  };
}

export function chatResponse(messageId: string, text: string, files: Attachment[]) {
  const history = listLiveMessages();
  const chatSettings = getChatSettings();
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
  let completed = false;

  const stream = createUIMessageStream<MemoriUIMessage>({
    originalMessages: [...history, userMessage],
    onError: errorMessage,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });

      const body = userContent(userMessage);
      const retrievalStarted = performance.now();
      const { live, ...retrieval } = retrieve(
        await embedOne(body),
        history[0]?.metadata?.createdAt,
      );
      const retrievalMs = Math.round(performance.now() - retrievalStarted);
      const current = timestampedUserContent(body, createdAt);
      const prompt = buildContextPrompt(
        current,
        retrieval.memories.map((item) => item.memory),
        retrieval.recent,
        retrieval.similar,
      );
      writer.write({ type: "data-retrieval", data: retrieval });
      writer.write({ type: "data-prompt", data: { prompt } });

      const fullPrompt = [
        history.length > 0 ? wrap("conversation_history", transcript(history)) : "",
        prompt,
      ]
        .filter(Boolean)
        .join("\n\n");
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
      const chat = await runCodex({
        name: "chat",
        instructions: CHAT_PROMPT,
        prompt: fullPrompt,
        model: chatSettings.model,
        effort: chatSettings.effort,
        webSearch: true,
        images: userMessage.parts.flatMap((part) =>
          part.type === "file" && part.mediaType.startsWith("image/")
            ? [uploadPath(part.url)]
            : [],
        ),
        onEvent: (event) => {
          if (event.type !== "item.started" && event.type !== "item.completed") {
            return;
          }
          const { item } = event;
          const done = event.type === "item.completed";
          if (item.type === "reasoning" && done) {
            writer.write({ type: "reasoning-start", id: item.id });
            writer.write({ type: "reasoning-delta", id: item.id, delta: item.text });
            writer.write({ type: "reasoning-end", id: item.id });
          }
          if (item.type === "agent_message" && done) {
            thought();
            writer.write({ type: "text-start", id: item.id });
            writer.write({ type: "text-delta", id: item.id, delta: item.text });
            writer.write({ type: "text-end", id: item.id });
            since = performance.now();
          }
          if (item.type === "command_execution") {
            thought();
            writer.write({
              type: "data-command",
              id: item.id,
              data: {
                command: unwrapShell(item.command),
                running: !done,
                exitCode: item.exit_code ?? null,
                output: item.aggregated_output.slice(-20_000),
              },
            });
          }
          if (item.type === "web_search") {
            thought();
            writer.write({
              type: "data-search",
              id: item.id,
              data: { query: item.query, running: !done },
            });
          }
          if (done && item.type !== "reasoning" && item.type !== "agent_message") {
            since = performance.now();
          }
        },
      });
      const chatUsage = callUsage(
        chat.usage,
        Math.round(performance.now() - chatStarted),
      );
      const context = Math.round(fullPrompt.length / 4) + chatUsage.outputTokens;

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
        wrap("latest_turn", `user: ${current}\nassistant: ${chat.text}`),
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

      if (context > SETTINGS.episodeThreshold * CONTEXT_WINDOW) {
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
          context,
          chatModel: chatSettings.model,
          chatEffort: chatSettings.effort,
        },
      });
      writer.write({ type: "finish" });
      completed = true;
    },
    onEnd: ({ responseMessage }) => {
      if (!completed) {
        return;
      }
      saveMessage(userMessage);
      saveMessage({
        ...responseMessage,
        metadata: { createdAt: new Date().toISOString() },
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
