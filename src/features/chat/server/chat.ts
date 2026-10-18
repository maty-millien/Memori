import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUIMessageChunk,
} from "ai";
import { z } from "zod";

import { SETTINGS } from "@/features/memories/server/config";
import { archiveConversation } from "@/features/memories/server/conversations";
import { curate } from "@/features/memories/server/curation";
import { embedOne } from "@/features/memories/server/embeddings";
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
  type CallUsage,
  type Conversation,
  type Memory,
  type MemoriUIMessage,
  type Question,
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
  updateMessageParts,
} from "@/shared/server/db";

import { CHAT_PROMPT, PATCH_DESCRIPTION, QUESTION_DESCRIPTION } from "./prompts";
import {
  applyPatch,
  read,
  READ_MAX_LINES,
  shell,
  SHELL_MAX_LINES,
  SHELL_TIMEOUT_MS,
} from "./tools";

type Chunk = InferUIMessageChunk<MemoriUIMessage>;

let activeTurn: {
  userMessage: MemoriUIMessage;
  chunks: Chunk[];
  followers: Set<ReadableStreamDefaultController<Chunk>>;
  controller: AbortController;
  steer: ((text: string) => void) | null;
} | null = null;

let postTurn = Promise.resolve();

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
  question: z.string(),
  header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string() })),
  multiple: z.boolean(),
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

const FULL_TOOL_OUTPUT_TURNS = 3;

function seedItems(history: MemoriUIMessage[]) {
  const replies = history.filter((message) => message.role !== "user");
  return replies.flatMap((message, index) =>
    z
      .array(itemSchema)
      .parse(getThreadItems(message.id) ?? [])
      .map((item) =>
        item.type === "function_call_output" &&
        index < replies.length - FULL_TOOL_OUTPUT_TURNS
          ? Object.assign(item, {
              output: `[Output${typeof item.output === "string" ? ` (${item.output.split("\n").length} lines)` : ""} elided to save context. Rerun the tool if you need it again.]`,
            })
          : item,
      ),
  );
}

export function chatResponse(messageId: string, userText: string) {
  const createdAt = new Date();
  const userMessage: MemoriUIMessage = {
    id: messageId,
    role: "user",
    parts: [{ type: "text", text: userText }],
    metadata: { createdAt: createdAt.toISOString() },
  };
  let items: Item[] | null = null;
  let finishTurn: ((message: MemoriUIMessage) => Promise<void>) | null = null;
  const turn: NonNullable<typeof activeTurn> = {
    userMessage,
    chunks: [],
    followers: new Set(),
    controller: new AbortController(),
    steer: null,
  };
  activeTurn = turn;
  const { signal } = turn.controller;

  const stream = createUIMessageStream<MemoriUIMessage>({
    onError: errorMessage,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      await postTurn;
      const history = listLiveMessages();
      const inbox: string[] = [];
      const steers: string[] = [];
      turn.steer = (text) => {
        inbox.push(text);
        steers.push(text);
        writer.write({ type: "data-steer", data: { text } });
      };
      const drain = () =>
        inbox.splice(0).map((text): Item => ({
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: timestampedUserContent(text, new Date()) },
          ],
        }));

      const { models, settings: chatSettings } = await chatOptions();
      const images =
        models.find((model) => model.id === chatSettings.model)?.images ?? false;
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
                  ...part.data.memories.map((item) => memoryKey(item.memory)),
                  ...[...part.data.recent, ...part.data.similar].map(conversationKey),
                ]
              : [],
          ),
        ),
      );
      const unseen = <T>(entries: T[], key: (entry: T) => string) =>
        entries.filter((entry) => !seen.has(key(entry)));
      const current = timestampedUserContent(body, createdAt);
      const prompt = buildContextPrompt(
        current,
        unseen(
          retrieval.memories.map((item) => item.memory),
          memoryKey,
        ),
        unseen(retrieval.recent, conversationKey),
        unseen(retrieval.similar, conversationKey),
      );
      writer.write({ type: "data-retrieval", data: retrieval });
      writer.write({ type: "data-prompt", data: { prompt } });

      const userItem: Item = {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
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
          const result = await shell(command, workdir, timeout, signal);
          writer.write({
            type: "data-command",
            id: callId,
            data: { ...data, running: false, ...result },
          });
          since = performance.now();
          return result.output;
        },
      };
      const readTool: Tool = {
        definition: {
          type: "function",
          name: "read",
          description: `Read a file or directory on the user's Mac. Supports text files, images, and PDFs; images and PDFs are shown to you directly. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files in sections. Prefer one larger read over many small slices.`,
          strict: true,
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "File or directory to read, absolute or relative to the user's home directory",
              },
              offset: {
                type: ["integer", "null"],
                description:
                  "The line or directory entry to start reading from (1-based)",
              },
              limit: {
                type: ["integer", "null"],
                description: `The maximum number of lines or directory entries to read (defaults to and capped at ${READ_MAX_LINES})`,
              },
            },
            required: ["path", "offset", "limit"],
            additionalProperties: false,
          },
        },
        run: async (args, callId) => {
          const { path, offset, limit } = z
            .object({
              path: z.string(),
              offset: z.number().int().nullable(),
              limit: z.number().int().positive().nullable(),
            })
            .parse(JSON.parse(args));
          thought();
          writer.write({ type: "data-read", id: callId, data: { path, running: true } });
          const result = read(path, offset, limit, images);
          writer.write({ type: "data-read", id: callId, data: { path, running: false } });
          since = performance.now();
          return result;
        },
      };
      const patchTool: Tool = {
        definition: {
          type: "function",
          name: "patch",
          description: PATCH_DESCRIPTION,
          strict: true,
          parameters: {
            type: "object",
            properties: {
              patchText: {
                type: "string",
                description:
                  "The full patch text describing add, update, and delete operations",
              },
            },
            required: ["patchText"],
            additionalProperties: false,
          },
        },
        run: async (args, callId) => {
          const { patchText } = z
            .object({ patchText: z.string() })
            .parse(JSON.parse(args));
          const data = { patch: patchText, running: true, output: "" };
          thought();
          writer.write({ type: "data-patch", id: callId, data });
          let output: string;
          try {
            output = applyPatch(patchText);
          } catch (error) {
            output = `Patch failed: ${errorMessage(error)}`;
          }
          writer.write({
            type: "data-patch",
            id: callId,
            data: { ...data, running: false, output },
          });
          since = performance.now();
          return output;
        },
      };
      const questionTool: Tool = {
        definition: {
          type: "function",
          name: "question",
          description: QUESTION_DESCRIPTION,
          strict: true,
          parameters: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                description: "Questions to ask",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string", description: "Complete question" },
                    header: {
                      type: "string",
                      description: "Very short label (max 30 chars)",
                    },
                    options: {
                      type: "array",
                      description: "Available choices",
                      items: {
                        type: "object",
                        properties: {
                          label: {
                            type: "string",
                            description: "Display text (1-5 words, concise)",
                          },
                          description: {
                            type: "string",
                            description: "Explanation of choice",
                          },
                        },
                        required: ["label", "description"],
                        additionalProperties: false,
                      },
                    },
                    multiple: {
                      type: "boolean",
                      description: "Allow selecting multiple choices",
                    },
                  },
                  required: ["question", "header", "options", "multiple"],
                  additionalProperties: false,
                },
              },
            },
            required: ["questions"],
            additionalProperties: false,
          },
        },
        run: async (args, callId) => {
          const { questions } = z
            .object({ questions: z.array(questionSchema).min(1) })
            .parse(JSON.parse(args));
          thought();
          writer.write({
            type: "data-question",
            id: callId,
            data: { questions, answers: null },
          });
          const answers = await new Promise<string[][]>((resolve) => {
            pendingQuestions.set(callId, resolve);
            signal.addEventListener("abort", () => resolve(questions.map(() => [])), {
              once: true,
            });
          });
          pendingQuestions.delete(callId);
          writer.write({
            type: "data-question",
            id: callId,
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
      };
      const threadItems: Item[] = [];
      const reply = await runAgent(
        {
          instructions: CHAT_PROMPT,
          input: [...seedItems(history), userItem],
          model: chatSettings.model,
          effort: chatSettings.effort,
          tools: [shellTool, readTool, patchTool, questionTool],
          webSearch: true,
          steer: drain,
          signal,
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
                  data: {
                    query: output.action?.query ?? "",
                    url: output.action?.url,
                    running: !done,
                  },
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
        },
        threadItems,
      ).catch((error: unknown) => {
        if (!signal.aborted) {
          throw error;
        }
        return null;
      });
      turn.steer = null;
      if (!reply) {
        writer.write({ type: "data-stopped", data: {} });
        writer.write({ type: "finish" });
        items = [
          userItem,
          ...threadItems,
          ...drain(),
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "[The user stopped your previous response before it finished.]",
              },
            ],
          },
        ];
        return;
      }
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
        wrap(
          "latest_turn",
          [
            `user: ${current}`,
            ...steers.map((text) => `user (while the assistant was working): ${text}`),
            `assistant: ${reply.text}`,
          ].join("\n"),
        ),
      ].join("\n\n");
      writer.write({
        type: "data-usage",
        data: {
          retrievalMs,
          chat: chatUsage,
          curation: null,
          context: reply.context,
          chatModel: chatSettings.model,
          chatEffort: chatSettings.effort,
        },
      });
      writer.write({ type: "finish" });
      items = [userItem, ...reply.items];
      finishTurn = async (message) => {
        const parts: MemoriUIMessage["parts"] = [];
        let curationUsage: CallUsage | null = null;
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

        if (reply.context > CONTEXT_WINDOW) {
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
      activeTurn = null;
      if (!items) {
        return;
      }
      saveMessage(userMessage);
      const message = {
        ...responseMessage,
        metadata: { createdAt: new Date().toISOString() },
      };
      saveMessage(message);
      saveThreadItems(responseMessage.id, items);
      if (finishTurn) {
        postTurn = finishTurn(message).catch(() => {});
      }
    },
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
