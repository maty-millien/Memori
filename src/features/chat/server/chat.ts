import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  modelMessageSchema,
  streamText,
  tool,
  type InferUIMessageChunk,
  type ModelMessage,
} from "ai";
import { z } from "zod";

import { SETTINGS } from "@/features/memories/server/config";
import { archiveConversation } from "@/features/memories/server/conversations";
import { curate } from "@/features/memories/server/curation";
import { embedOne } from "@/features/memories/server/embeddings";
import {
  buildContextPrompt,
  formatMemories,
  localIso,
  timestampedUserContent,
  timezone,
  transcript,
  wrap,
} from "@/features/memories/server/prompting";
import { recall, retrieve } from "@/features/memories/server/retrieval";
import {
  CONTEXT_WINDOW,
  messageText,
  type CallUsage,
  type Conversation,
  type Memory,
  type RemanenceUIMessage,
  type Question,
} from "@/shared/lib/remanence";
import { chatOptions, codex, codexOptions, tokenUsage } from "@/shared/server/codex";
import {
  deleteWakeup,
  dueWakeup,
  getThreadItems,
  insertWakeup,
  listLiveMessages,
  saveMessage,
  saveThreadItems,
  scheduleCheckIn,
  updateMessageParts,
} from "@/shared/server/db";

import { CHAT_PROMPT, PATCH_DESCRIPTION, QUESTION_DESCRIPTION, SILENT } from "./prompts";
import {
  applyPatch,
  read,
  READ_MAX_LINES,
  shell,
  SHELL_MAX_LINES,
  SHELL_PATH,
  SHELL_TIMEOUT_MS,
} from "./tools";

type Chunk = InferUIMessageChunk<RemanenceUIMessage>;

type Turn = {
  controller: AbortController;
  steer: ((text: string) => void) | null;
};

type Wakeup = NonNullable<ReturnType<typeof dueWakeup>>;

let activeTurn:
  | (Turn & {
      userMessage: RemanenceUIMessage;
      chunks: Chunk[];
      followers: Set<ReadableStreamDefaultController<Chunk>>;
    })
  | null = null;

let wakeTurn: Turn | null = null;

let postTurn = Promise.resolve();

const CHECK_IN_MS = 6 * 60 * 60 * 1000;

const listeners = new Set<() => void>();

export function eventsResponse() {
  let listener: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      listener = () => controller.enqueue(new TextEncoder().encode("data: message\n\n"));
      listeners.add(listener);
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
    },
    cancel() {
      listeners.delete(listener);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

function wake() {
  if (activeTurn || wakeTurn) {
    return;
  }
  const wakeup = dueWakeup();
  if (!wakeup) {
    return;
  }
  const now = localIso(new Date());
  const turn: Turn = { controller: new AbortController(), steer: null };
  wakeTurn = turn;
  void runTurn(turn, {
    content: wakeup.note
      ? `<wakeup datetime="${now}" timezone="${timezone()}" scheduled_for="${localIso(new Date(wakeup.at))}">\n${wakeup.note}\n</wakeup>`
      : `<wakeup datetime="${now}" timezone="${timezone()}" />`,
    topic: wakeup.note ?? "",
    userMessage: null,
    wakeup,
  }).pipeTo(new WritableStream());
}

setInterval(wake, 60_000);

export const activeUserMessage = () => activeTurn?.userMessage;

export function stopTurn() {
  activeTurn?.controller.abort();
}

export function steerTurn(text: string) {
  if (!activeTurn?.steer) {
    return false;
  }
  activeTurn.steer(text);
  return true;
}

const questionSchema = z.object({
  question: z.string().describe("Complete question"),
  header: z.string().describe("Very short label (max 30 chars)"),
  options: z
    .array(
      z.object({
        label: z.string().describe("Display text (1-5 words, concise)"),
        description: z.string().describe("Explanation of choice"),
      }),
    )
    .describe("Available choices"),
  multiple: z.boolean().describe("Allow selecting multiple choices"),
}) satisfies z.ZodType<Question>;

const pendingQuestions = new Map<string, (answers: string[][]) => void>();

export function answerQuestion(id: string, answers: string[][]) {
  pendingQuestions.get(id)?.(answers);
}

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

const conversationKey = (conversation: Conversation) => `conversation:${conversation.id}`;

function seedMessages(history: RemanenceUIMessage[]) {
  return history
    .filter((message) => message.role !== "user")
    .flatMap((message) => z.array(modelMessageSchema).parse(getThreadItems(message.id)));
}

export function chatResponse(messageId: string, userText: string) {
  wakeTurn?.controller.abort();
  const createdAt = new Date();
  const userMessage: RemanenceUIMessage = {
    id: messageId,
    role: "user",
    parts: [{ type: "text", text: userText }],
    metadata: { createdAt: createdAt.toISOString() },
  };
  const turn: NonNullable<typeof activeTurn> = {
    userMessage,
    chunks: [],
    followers: new Set(),
    controller: new AbortController(),
    steer: null,
  };
  activeTurn = turn;
  const stream = runTurn(turn, {
    content: timestampedUserContent(userText, createdAt),
    topic: userText,
    userMessage,
    wakeup: null,
  });

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

function runTurn(
  turn: Turn,
  {
    content,
    topic,
    userMessage,
    wakeup,
  }: {
    content: string;
    topic: string;
    userMessage: RemanenceUIMessage | null;
    wakeup: Wakeup | null;
  },
) {
  let items: ModelMessage[] | null = null;
  let silent = false;
  let finishTurn: ((message: RemanenceUIMessage) => Promise<void>) | null = null;
  const { signal } = turn.controller;

  return createUIMessageStream<RemanenceUIMessage>({
    onError: errorMessage,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      await postTurn;
      const history = listLiveMessages();
      const inbox: string[] = [];
      turn.steer = (text) => {
        inbox.push(text);
        writer.write({ type: "data-steer", data: { text } });
      };
      const drain = () =>
        inbox.splice(0).map((text): ModelMessage => ({
          role: "user",
          content: timestampedUserContent(text, new Date()),
        }));

      const { models, settings: chatSettings } = await chatOptions();
      const images =
        models.find((model) => model.id === chatSettings.model)?.images ?? false;
      const retrievalQuery = [
        ...history.slice(-2).map((message) => messageText(message.parts).slice(-500)),
        topic,
      ].join("\n\n");
      const retrievalStarted = performance.now();
      const { live, ...retrieval } = retrieve(
        await embedOne(retrievalQuery, "query"),
        history[0]?.metadata?.createdAt,
      );
      const retrievalMs = Math.round(performance.now() - retrievalStarted);
      const seen = new Set(
        history.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "data-prompt" ? part.data.injected : [],
          ),
        ),
      );
      const unseen = <T>(entries: T[], key: (entry: T) => string) =>
        entries.filter((entry) => !seen.has(key(entry)));
      const memories = unseen(
        retrieval.memories.map((item) => item.memory),
        memoryKey,
      );
      const latest = unseen(retrieval.latest, conversationKey);
      const relevant = unseen(retrieval.relevant, conversationKey);
      const prompt = buildContextPrompt(content, memories, latest, relevant);
      const injected = [
        ...memories.map(memoryKey),
        ...[...latest, ...relevant].map(conversationKey),
      ];
      writer.write({ type: "data-retrieval", data: retrieval });
      writer.write({ type: "data-prompt", data: { prompt, injected } });

      const userInput: ModelMessage = { role: "user", content: prompt };
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
      const tools = {
        web_search: codex.tools.webSearch({}),
        shell: tool({
          description: `Run a command with ${SHELL_PATH} on the machine and return its combined output. Quote file paths containing spaces or special characters. When output is large, the full result is saved to a file and the last ${SHELL_MAX_LINES} lines are returned.`,
          strict: true,
          inputSchema: z.object({
            command: z.string().describe("Shell command string to execute"),
            workdir: z
              .string()
              .nullable()
              .describe(
                "Working directory to execute the command in. Defaults to the user's home directory. Set it here instead of changing directories in the command.",
              ),
            timeout: z
              .number()
              .int()
              .nonnegative()
              .nullable()
              .describe(
                `Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to ${SHELL_TIMEOUT_MS}.`,
              ),
          }),
          execute: async ({ command, workdir, timeout }, { toolCallId }) => {
            const data = { command, running: true, exitCode: null, output: "" };
            thought();
            writer.write({ type: "data-command", id: toolCallId, data });
            const result = await shell(command, workdir, timeout, signal);
            writer.write({
              type: "data-command",
              id: toolCallId,
              data: { ...data, running: false, ...result },
            });
            since = performance.now();
            return result.output;
          },
        }),
        read: tool({
          description: `Read a file or directory on the machine. Supports text files, images, and PDFs; images and PDFs are shown to you directly. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files in sections. Prefer one larger read over many small slices.`,
          strict: true,
          inputSchema: z.object({
            path: z
              .string()
              .describe(
                "File or directory to read, absolute or relative to the user's home directory",
              ),
            offset: z
              .number()
              .int()
              .nullable()
              .describe("The line or directory entry to start reading from (1-based)"),
            limit: z
              .number()
              .int()
              .positive()
              .nullable()
              .describe(
                `The maximum number of lines or directory entries to read (defaults to and capped at ${READ_MAX_LINES})`,
              ),
          }),
          execute: async ({ path, offset, limit }, { toolCallId }) => {
            thought();
            writer.write({
              type: "data-read",
              id: toolCallId,
              data: { path, running: true },
            });
            const result = read(path, offset, limit, images);
            writer.write({
              type: "data-read",
              id: toolCallId,
              data: { path, running: false },
            });
            since = performance.now();
            return result;
          },
          toModelOutput: ({ output }) =>
            typeof output === "string"
              ? { type: "text", value: output }
              : { type: "content", value: [output] },
        }),
        recall: tool({
          description:
            "Search the earlier parts of this conversation that are no longer in the chat history. Returns the most relevant past exchanges, each with its date. Matches both meaning and exact words, so include specific names, paths, or numbers when you know them.",
          strict: true,
          inputSchema: z.object({ query: z.string().describe("What to look for") }),
          execute: async ({ query }, { toolCallId }) => {
            thought();
            writer.write({
              type: "data-recall",
              id: toolCallId,
              data: { query, running: true },
            });
            const turns = await recall(query);
            writer.write({
              type: "data-recall",
              id: toolCallId,
              data: { query, running: false },
            });
            since = performance.now();
            return turns.join("\n\n") || "No earlier exchanges match.";
          },
        }),
        patch: tool({
          description: PATCH_DESCRIPTION,
          strict: true,
          inputSchema: z.object({
            patchText: z
              .string()
              .describe(
                "The full patch text describing add, update, and delete operations",
              ),
          }),
          execute: async ({ patchText }, { toolCallId }) => {
            const data = { patch: patchText, running: true, output: "" };
            thought();
            writer.write({ type: "data-patch", id: toolCallId, data });
            let output: string;
            try {
              output = applyPatch(patchText);
            } catch (error) {
              output = `Patch failed: ${errorMessage(error)}`;
            }
            writer.write({
              type: "data-patch",
              id: toolCallId,
              data: { ...data, running: false, output },
            });
            since = performance.now();
            return output;
          },
        }),
        schedule: tool({
          description:
            "Schedule a moment to write to the user first, without waiting for them: a follow-up on an event they mentioned, a reminder before it, or a reminder they asked for. Call it on your own initiative whenever the user mentions something with a time or an outcome. At that time you get a <wakeup> with your note, and you decide then what to send, if anything.",
          strict: true,
          inputSchema: z.object({
            at: z.iso
              .datetime({ offset: true })
              .describe(
                "When to wake up, as an ISO 8601 datetime with a timezone offset",
              ),
            note: z
              .string()
              .describe(
                "What to do then, written for yourself with the context you'll need",
              ),
          }),
          execute: async ({ at, note }, { toolCallId }) => {
            thought();
            writer.write({ type: "data-schedule", id: toolCallId, data: { at, note } });
            insertWakeup(new Date(at).toISOString(), note);
            since = performance.now();
            return `Scheduled for ${localIso(new Date(at))}.`;
          },
        }),
        question: tool({
          description: QUESTION_DESCRIPTION,
          strict: true,
          inputSchema: z.object({
            questions: z.array(questionSchema).min(1).describe("Questions to ask"),
          }),
          execute: async ({ questions }, { toolCallId }) => {
            thought();
            writer.write({
              type: "data-question",
              id: toolCallId,
              data: { questions, answers: null },
            });
            const answers = await new Promise<string[][]>((resolve) => {
              pendingQuestions.set(toolCallId, resolve);
              signal.addEventListener("abort", () => resolve(questions.map(() => [])), {
                once: true,
              });
            });
            pendingQuestions.delete(toolCallId);
            writer.write({
              type: "data-question",
              id: toolCallId,
              data: { questions, answers },
            });
            since = performance.now();
            const formatted = questions
              .map(
                (question, index) =>
                  `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
              )
              .join(", ");
            return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`;
          },
        }),
      };
      const seed = seedMessages(history);
      const thread: ModelMessage[] = [userInput];
      const usage = {
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      };
      let context = 0;
      let text = "";
      const summaries = new Set<string>();
      const run = async (): Promise<void> => {
        const result = streamText({
          model: codex.responses(chatSettings.model),
          providerOptions: codexOptions(CHAT_PROMPT, chatSettings.effort),
          messages: [...seed, ...thread],
          tools,
          activeTools: wakeup
            ? ["web_search", "shell", "read", "recall", "patch", "schedule"]
            : undefined,
          stopWhen: () => inbox.length > 0,
          abortSignal: signal,
          onStepEnd: (step) => {
            thread.push(...step.response.messages);
            const stepUsage = tokenUsage(step.usage);
            usage.inputTokens += stepUsage.inputTokens;
            usage.cachedTokens += stepUsage.cachedTokens;
            usage.outputTokens += stepUsage.outputTokens;
            usage.reasoningTokens += stepUsage.reasoningTokens;
            context = stepUsage.inputTokens + stepUsage.outputTokens;
            text = step.text;
          },
        });
        for await (const part of result.fullStream) {
          switch (part.type) {
            case "reasoning-delta":
              if (part.text && !summaries.has(part.id)) {
                summaries.add(part.id);
                writer.write({ type: "reasoning-start", id: part.id });
              }
              if (part.text) {
                writer.write({ type: "reasoning-delta", id: part.id, delta: part.text });
              }
              break;
            case "reasoning-end":
              if (summaries.has(part.id)) {
                writer.write({ type: "reasoning-end", id: part.id });
              }
              break;
            case "text-start":
              thought();
              writer.write({
                type: "text-start",
                id: part.id,
                providerMetadata: {
                  codex: { phase: part.providerMetadata!.openai.phase },
                },
              });
              break;
            case "text-delta":
              writer.write({ type: "text-delta", id: part.id, delta: part.text });
              break;
            case "text-end":
              writer.write({ type: "text-end", id: part.id });
              since = performance.now();
              break;
            case "tool-input-start":
              if (part.toolName === "web_search") {
                thought();
                writer.write({
                  type: "data-search",
                  id: part.id,
                  data: { query: "", running: true },
                });
              }
              break;
            case "tool-result":
              if (!part.dynamic && part.toolName === "web_search") {
                const action = part.output.action!;
                writer.write({
                  type: "data-search",
                  id: part.toolCallId,
                  data:
                    action.type === "search"
                      ? { query: action.query!, running: false }
                      : { query: "", url: action.url, running: false },
                });
                since = performance.now();
              }
              break;
            case "error":
              throw part.error;
            default:
              break;
          }
        }
        const steered = signal.aborted ? [] : drain();
        if (steered.length > 0) {
          thread.push(...steered);
          await run();
        }
      };
      await run();
      turn.steer = null;
      if (signal.aborted && wakeup) {
        return;
      }
      if (signal.aborted) {
        writer.write({ type: "data-stopped", data: {} });
        writer.write({ type: "finish" });
        items = [
          ...thread,
          ...drain(),
          {
            role: "user",
            content: "[The user stopped your previous response before it finished.]",
          },
        ];
        return;
      }
      const chatUsage = {
        ...usage,
        ms: Math.round(performance.now() - chatStarted),
      };

      writer.write({
        type: "data-usage",
        data: {
          retrievalMs,
          chat: chatUsage,
          curation: null,
          context,
          chatModel: chatSettings.model,
          chatEffort: chatSettings.effort,
        },
      });
      writer.write({ type: "finish" });
      items = thread;
      silent = wakeup !== null && text.trim() === SILENT;
      finishTurn = async (message) => {
        const parts: RemanenceUIMessage["parts"] = [];
        let curationUsage: CallUsage | null = null;
        if (userMessage) {
          const curationPrompt = [
            wrap(
              "relevant_memories",
              formatMemories([
                ...retrieval.memories.map((item) => item.memory),
                ...live,
              ]) || "(none)",
            ),
            wrap(
              "previous_messages",
              transcript(history.slice(-SETTINGS.curationPreviousMessages)) || "(none)",
            ),
            wrap("latest_turn", transcript([userMessage, message])),
          ].join("\n\n");
          try {
            const curation = await curate(curationPrompt);
            curationUsage = curation.usage;
            parts.push({
              type: "data-curation",
              data: { prompt: curationPrompt, operations: curation.operations },
            });
          } catch (error) {
            parts.push({ type: "data-error", data: { message: errorMessage(error) } });
          }
        }

        if (context > CONTEXT_WINDOW) {
          try {
            const compaction = await archiveConversation(history);
            if (compaction) {
              parts.push({ type: "data-compaction", data: compaction });
            }
          } catch (error) {
            parts.push({ type: "data-error", data: { message: errorMessage(error) } });
          }
        }

        updateMessageParts(message.id, [
          ...message.parts.map((part) =>
            part.type === "data-usage"
              ? { ...part, data: { ...part.data, curation: curationUsage } }
              : part,
          ),
          ...parts,
        ]);
      };
    },
    onEnd: ({ responseMessage }) => {
      if (wakeup) {
        wakeTurn = null;
      } else {
        activeTurn = null;
      }
      if (!items) {
        return;
      }
      if (wakeup) {
        deleteWakeup(wakeup.id);
      }
      scheduleCheckIn(new Date(Date.now() + CHECK_IN_MS).toISOString());
      if (silent) {
        return;
      }
      if (userMessage) {
        saveMessage(userMessage);
      }
      const message = {
        ...responseMessage,
        metadata: { createdAt: new Date().toISOString() },
      };
      saveMessage(message);
      saveThreadItems(responseMessage.id, items);
      if (wakeup) {
        for (const listener of listeners) {
          listener();
        }
      }
      if (finishTurn) {
        postTurn = finishTurn(message).catch(() => {});
      }
    },
  });
}
