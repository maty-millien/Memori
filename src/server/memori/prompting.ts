import type { Memory } from "@/shared/lib/memori";

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

function formatConversations(memories: Memory[]) {
  return memories
    .map(
      (memory) =>
        `- [local_datetime: ${localIso(new Date(memory.createdAt))}; timezone: ${timezone()}] ${memory.content}`,
    )
    .join("\n");
}

export function buildContextPrompt(
  userContent: string,
  memories: Memory[],
  recent: Memory[],
  similar: Memory[],
) {
  const blocks = [];
  if (recent.length > 0) {
    blocks.push(wrap("recent_conversations", formatConversations(recent)));
  }
  if (similar.length > 0) {
    blocks.push(wrap("similar_conversations", formatConversations(similar)));
  }
  if (memories.length > 0) {
    blocks.push(wrap("relevant_memories", formatMemories(memories)));
  }
  return [...blocks, userContent].join("\n\n");
}
