import {
  messageText,
  type Conversation,
  type Memory,
  type RemanenceUIMessage,
} from "@/shared/lib/remanence";

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
  return `<user_message datetime="${localIso(date)}" timezone="${timezone()}">\n${content}\n</user_message>`;
}

export function formatMemories(memories: Memory[]) {
  return memories
    .map(
      (memory) =>
        `- id: "${memory.id}"\n  importance: ${memory.importance}\n  updated: ${localIso(new Date(memory.updatedAt)).slice(0, 10)}\n  content: ${memory.content}`,
    )
    .join("\n");
}

function formatConversations(conversations: Conversation[]) {
  return conversations
    .map(
      (conversation) =>
        `- period: ${localIso(new Date(conversation.startedAt))} to ${localIso(new Date(conversation.endedAt))}\n  summary: ${conversation.content.replaceAll("\n", "\n  ")}`,
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

export function userContent(message: RemanenceUIMessage) {
  return messageText(message.parts).trim();
}

function assistantLines(message: RemanenceUIMessage) {
  return message.parts.flatMap((part) => {
    if (part.type === "text" && part.text.trim()) {
      return [part.text.trim()];
    }
    if (part.type === "data-command") {
      return [`[ran] ${part.data.command}`];
    }
    if (part.type === "data-steer") {
      return [`[user, while the assistant was working] ${part.data.text}`];
    }
    if (part.type === "data-patch") {
      return [`[edited] ${part.data.output}`];
    }
    if (part.type === "data-question") {
      return part.data.questions.map(
        (question, index) =>
          `[asked] ${question.question} -> user answered: ${part.data.answers?.[index]?.join(", ") || "nothing"}`,
      );
    }
    if (part.type === "data-read") {
      return [`[read] ${part.data.path}`];
    }
    if (part.type === "data-recall") {
      return [`[recalled] ${part.data.query}`];
    }
    if (part.type === "data-search") {
      return [
        part.data.url ? `[opened] ${part.data.url}` : `[searched] ${part.data.query}`,
      ];
    }
    return [];
  });
}

export function transcript(messages: RemanenceUIMessage[]) {
  return messages
    .flatMap((message) => {
      const body =
        message.role === "user"
          ? userContent(message)
          : assistantLines(message).join("\n");
      if (!body) {
        return [];
      }
      const attributes =
        message.role === "user"
          ? ` datetime="${localIso(new Date(message.metadata?.createdAt ?? Date.now()))}"`
          : "";
      return [`<message role="${message.role}"${attributes}>\n${body}\n</message>`];
    })
    .join("\n");
}
