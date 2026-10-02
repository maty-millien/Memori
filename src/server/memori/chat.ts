import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type FilePart,
  type LanguageModelUsage,
  type ModelMessage,
  type TextPart,
  type ToolCallPart,
} from "ai";

import {
  CONTEXT_WINDOW,
  type AttachmentType,
  type CallUsage,
  type MemoriUIMessage,
} from "@/shared/lib/memori";

import { chatAgent, curationAgent } from "./agents";
import { SETTINGS } from "./config";
import { getChatSettings, listLiveMessages, saveMessage } from "./db";
import { embedOne } from "./embeddings";
import { createEpisode } from "./episodes";
import { errorMessage } from "./errors";
import {
  buildContextPrompt,
  formatMemories,
  timestampedUserContent,
  wrap,
} from "./prompting";
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

function assistantMessages(message: MemoriUIMessage): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let content: (TextPart | ToolCallPart)[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) {
      content.push({ type: "text", text: part.text });
    }
    if (part.type === "tool-shell" && part.state === "output-available") {
      const { toolCallId, input, output } = part;
      messages.push(
        {
          role: "assistant",
          content: [
            ...content,
            { type: "tool-call", toolCallId, toolName: "shell", input },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId,
              toolName: "shell",
              output: {
                type: "text",
                value: `Exit code ${output.exitCode}. Output not kept in history.`,
              },
            },
          ],
        },
      );
      content = [];
    }
  }
  if (content.length > 0) {
    messages.push({ role: "assistant", content });
  }
  return messages;
}

function historyMessages(history: MemoriUIMessage[]): ModelMessage[] {
  return history.flatMap((message): ModelMessage[] => {
    if (message.role !== "user") {
      return assistantMessages(message);
    }
    const content = historyContent(message);
    if (!content) {
      return [];
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
      const { live, ...retrieval } = retrieve(
        await embedOne(body),
        history[0]?.metadata?.createdAt,
      );
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
      const chat = await chatAgent.stream({
        options: chatSettings,
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
      let stepStarted: number | null = null;
      for await (const chunk of chat.toUIMessageStream<MemoriUIMessage>({
        sendStart: false,
        sendFinish: false,
        onError: errorMessage,
      })) {
        if (chunk.type === "start-step") {
          stepStarted = performance.now();
        }
        if (
          stepStarted !== null &&
          (chunk.type === "text-start" || chunk.type === "tool-input-start")
        ) {
          writer.write({
            type: "data-thought",
            data: { ms: Math.round(performance.now() - stepStarted) },
          });
          stepStarted = null;
        }
        writer.write(chunk);
        if (chunk.type === "error") {
          return;
        }
      }
      const reply = await chat.text;
      const steps = await chat.steps;
      const chatUsage = callUsage(await chat.totalUsage, steps.length, chatStarted);
      const lastUsage = steps.at(-1)?.usage;
      const context = (lastUsage?.inputTokens ?? 0) + (lastUsage?.outputTokens ?? 0);

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
        wrap("latest_turn", `user: ${userContent}\nassistant: ${reply}`),
      ].join("\n\n");
      writer.write({
        type: "data-curation",
        data: { startedAt: new Date().toISOString(), prompt: curationPrompt },
      });
      const curationStarted = performance.now();
      let curationUsage: CallUsage | null = null;
      try {
        const curation = await curationAgent.stream({ prompt: curationPrompt });
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
