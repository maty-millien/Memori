import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
} from "ai";

import type { CallUsage, MemoriUIMessage } from "@/shared/lib/memori";

import { codexModel, codexProviderOptions } from "./codex";
import { getSession, listMessages, saveMessage, setSessionTitle } from "./db";
import { embedOne } from "./embeddings";
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
import { historyContent, transcript } from "./transcript";

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
    return message.role === "user"
      ? [{ role: "user", content }]
      : [{ role: "assistant", content }];
  });
}

export function chatResponse(sessionId: string, messageId: string, text: string) {
  const session = getSession(sessionId);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }
  if (session.status === "ended") {
    return new Response("Session ended", { status: 409 });
  }
  const history = listMessages(sessionId);
  const createdAt = new Date();
  const userMessage: MemoriUIMessage = {
    id: messageId,
    role: "user",
    parts: [{ type: "text", text }],
    metadata: { createdAt: createdAt.toISOString() },
  };
  let completed = false;

  const stream = createUIMessageStream<MemoriUIMessage>({
    originalMessages: [...history, userMessage],
    onError: errorMessage,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });

      const retrievalStarted = performance.now();
      const retrieval = retrieve(await embedOne(text));
      const retrievalMs = Math.round(performance.now() - retrievalStarted);
      const userContent = timestampedUserContent(text, createdAt);
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
        model: codexModel,
        providerOptions: codexProviderOptions,
        system: CHAT_PROMPT,
        messages: [...historyMessages(history), { role: "user", content: prompt }],
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
            wrap("session_history", transcript(history) || "(none)"),
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

      writer.write({
        type: "data-usage",
        data: { retrievalMs, chat: chatUsage, curation: curationUsage },
      });
      writer.write({ type: "finish" });
      completed = true;
    },
    onEnd: ({ responseMessage }) => {
      if (!completed) {
        return;
      }
      saveMessage(sessionId, userMessage);
      saveMessage(sessionId, {
        ...responseMessage,
        metadata: { createdAt: new Date().toISOString() },
      });
      setSessionTitle(sessionId, text.slice(0, 80));
    },
  });

  return createUIMessageStreamResponse({ stream });
}
