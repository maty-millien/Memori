import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type FilePart,
  type LanguageModelUsage,
  type ModelMessage,
} from "ai";

import {
  CONTEXT_WINDOW,
  type AttachmentType,
  type CallUsage,
  type MemoriUIMessage,
} from "@/shared/lib/memori";

import {
  chatProviderOptions,
  codexChatModel,
  codexModel,
  codexProviderOptions,
} from "./codex";
import { SETTINGS } from "./config";
import { getChatSettings, listLiveMessages, saveMessage } from "./db";
import { embedOne } from "./embeddings";
import { createEpisode } from "./episodes";
import { errorMessage } from "./errors";
import { memoryTools } from "./memory-tools";
import {
  buildContextPrompt,
  formatMemories,
  timestampedUserContent,
  wrap,
} from "./prompting";
import { CHAT_PROMPT, CURATION_PROMPT } from "./prompts";
import { retrieve } from "./retrieval";
import { historyContent, transcript, userBody } from "./transcript";
import { readUpload, saveUpload } from "./uploads";

export type Attachment = {
  bytes: Uint8Array;
  mediaType: AttachmentType;
  filename: string;
};

function callUsage(
  usage: LanguageModelUsage,
  requests: number,
  started: number,
): CallUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
    requests,
    ms: Math.round(performance.now() - started),
  };
}

function historyMessages(history: MemoriUIMessage[]): ModelMessage[] {
  return history.flatMap((message): ModelMessage[] => {
    const content = historyContent(message);
    if (!content) {
      return [];
    }
    if (message.role !== "user") {
      return [{ role: "assistant", content }];
    }
    const files = message.parts.flatMap((part): FilePart[] =>
      part.type === "file"
        ? [
            {
              type: "file",
              data: readUpload(part.url),
              mediaType: part.mediaType,
              filename: part.filename,
            },
          ]
        : [],
    );
    return [{ role: "user", content: [{ type: "text", text: content }, ...files] }];
  });
}

export function chatResponse(messageId: string, text: string, files: Attachment[]) {
  const history = listLiveMessages();
  const chatSettings = getChatSettings();
  const createdAt = new Date();
  const userMessage: MemoriUIMessage = {
    id: messageId,
    role: "user",
    parts: [{ type: "text", text }],
    metadata: { createdAt: createdAt.toISOString() },
  };
  const body = userBody(
    text,
    files.map((file) => file.filename),
  );
  let completed = false;

  const stream = createUIMessageStream<MemoriUIMessage>({
    originalMessages: [...history, userMessage],
    onError: errorMessage,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });

      const retrievalStarted = performance.now();
      const retrieval = retrieve(await embedOne(body));
      const retrievalMs = Math.round(performance.now() - retrievalStarted);
      const userContent = timestampedUserContent(body, createdAt);
      const prompt = buildContextPrompt(
        userContent,
        retrieval.memories.map((item) => item.memory),
        retrieval.recent,
        retrieval.similar,
      );
      writer.write({ type: "data-retrieval", data: retrieval });
      writer.write({ type: "data-prompt", data: { prompt } });

      const chatStarted = performance.now();
      const chat = streamText({
        model: codexChatModel(chatSettings.model),
        providerOptions: chatProviderOptions(chatSettings.effort),
        system: CHAT_PROMPT,
        messages: [
          ...historyMessages(history),
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...files.map((file): FilePart => ({
                type: "file",
                data: file.bytes,
                mediaType: file.mediaType,
                filename: file.filename,
              })),
            ],
          },
        ],
      });
      for await (const chunk of chat.toUIMessageStream<MemoriUIMessage>({
        sendStart: false,
        sendFinish: false,
        onError: errorMessage,
      })) {
        writer.write(chunk);
        if (chunk.type === "error") {
          return;
        }
      }
      const reply = await chat.text;
      const chatUsage = callUsage(
        await chat.totalUsage,
        (await chat.steps).length,
        chatStarted,
      );

      writer.write({
        type: "data-curation",
        data: { startedAt: new Date().toISOString() },
      });
      const curationStarted = performance.now();
      let curationUsage: CallUsage | null = null;
      try {
        const curation = streamText({
          model: codexModel,
          providerOptions: codexProviderOptions,
          system: CURATION_PROMPT,
          prompt: [
            wrap(
              "relevant_memories",
              formatMemories(retrieval.memories.map((item) => item.memory)) || "(none)",
            ),
            wrap(
              "recent_history",
              transcript(history.slice(-SETTINGS.curationHistoryMessages)) || "(none)",
            ),
            wrap("latest_turn", `user: ${userContent}\nassistant: ${reply}`),
          ].join("\n\n"),
          tools: memoryTools,
          stopWhen: stepCountIs(5),
        });
        for await (const chunk of curation.toUIMessageStream<MemoriUIMessage>({
          sendStart: false,
          sendFinish: false,
          onError: errorMessage,
        })) {
          if (chunk.type === "error") {
            throw new Error(chunk.errorText);
          }
          if (!chunk.type.startsWith("text-")) {
            writer.write(chunk);
          }
        }
        curationUsage = callUsage(
          await curation.totalUsage,
          (await curation.steps).length,
          curationStarted,
        );
      } catch (error) {
        writer.write({ type: "data-error", data: { message: errorMessage(error) } });
      }

      if (
        chatUsage.inputTokens + chatUsage.outputTokens >
        SETTINGS.episodeThreshold * CONTEXT_WINDOW
      ) {
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
      saveMessage({
        ...userMessage,
        parts: [
          ...files.map((file) => ({
            type: "file" as const,
            mediaType: file.mediaType,
            filename: file.filename,
            url: saveUpload(file.bytes, file.mediaType),
          })),
          ...(text ? userMessage.parts : []),
        ],
      });
      saveMessage({
        ...responseMessage,
        metadata: { createdAt: new Date().toISOString() },
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
