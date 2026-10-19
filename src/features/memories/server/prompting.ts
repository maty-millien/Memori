import {
  messageText,
  type Conversation,
  type Memory,
  type MemoriUIMessage,
} from "@/shared/lib/memori";

const pad = (value: number) => String(value).padStart(2, "0");

export const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function localIso(date: Date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

export function wrap(tag: string, body: string) {
  return `<${tag}>\n${body}\n</${tag}>`;
}

export function timestampedUserContent(content: string, date: Date) {
  const metadata = `datetime: ${localIso(date)}\ntimezone: ${timezone()}`;
  return [wrap("message_metadata", metadata), content].join("\n\n");
}

export function formatMemories(memories: Memory[]) {
  return memories
    .map(
      (memory) =>
        `- id: "${memory.id}"\n  importance: ${memory.importance}\n  content: ${memory.content}`,
    )
    .join("\n");
}

function formatConversations(conversations: Conversation[]) {
  return conversations
    .map(
      (conversation) =>
        `- [local_datetime: ${localIso(new Date(conversation.createdAt))}; timezone: ${timezone()}] ${conversation.content.replaceAll("\n", "\n  ")}`,
    )
    .join("\n");
}

export function buildContextPrompt(
  content: string,
  memories: Memory[],
  latest: Conversation[],
  relevant: Conversation[],
) {
  const blocks = [];
  if (latest.length > 0) {
    blocks.push(wrap("latest_conversations", formatConversations(latest)));
  }
  if (relevant.length > 0) {
    blocks.push(wrap("relevant_conversations", formatConversations(relevant)));
  }
  if (memories.length > 0) {
    blocks.push(wrap("relevant_memories", formatMemories(memories)));
  }
  return [...blocks, content].join("\n\n");
}

export function userContent(message: MemoriUIMessage) {
  return messageText(message.parts).trim();
}

function assistantLines(message: MemoriUIMessage) {
  return message.parts.flatMap((part) => {
    if (part.type === "text" && part.text.trim()) {
      return [`assistant: ${part.text.trim()}`];
    }
    if (part.type === "data-command") {
      return [`assistant ran: ${part.data.command}`];
    }
    if (part.type === "data-steer") {
      return [`user (while the assistant was working): ${part.data.text}`];
    }
    if (part.type === "data-patch") {
      return [`assistant edited files: ${part.data.output}`];
    }
    if (part.type === "data-question") {
      return part.data.questions.map(
        (question, index) =>
          `assistant asked: ${question.question} -> user answered: ${part.data.answers?.[index]?.join(", ") || "nothing"}`,
      );
    }
    if (part.type === "data-read") {
      return [`assistant read: ${part.data.path}`];
    }
    if (part.type === "data-search") {
      return [
        part.data.url
          ? `assistant opened: ${part.data.url}`
          : `assistant searched: ${part.data.query}`,
      ];
    }
    return [];
  });
}

export function transcript(messages: MemoriUIMessage[]) {
  return messages
    .flatMap((message) =>
      message.role === "user"
        ? [
            `user: ${timestampedUserContent(
              userContent(message),
              new Date(message.metadata?.createdAt ?? Date.now()),
            )}`,
          ]
        : assistantLines(message),
    )
    .join("\n");
}
