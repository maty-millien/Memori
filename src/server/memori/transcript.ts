import type { MemoriUIMessage } from "@/shared/lib/memori";

import { timestampedUserContent } from "./prompting";

export function messageText(message: MemoriUIMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
}

export function attachmentNames(message: MemoriUIMessage) {
  return message.parts.flatMap((part) =>
    part.type === "file" ? [part.filename ?? "attachment"] : [],
  );
}

export function userBody(text: string, names: string[]) {
  const note = names.length > 0 ? `[attached: ${names.join(", ")}]` : "";
  return [text, note].filter(Boolean).join("\n\n");
}

export function historyContent(message: MemoriUIMessage) {
  const text = messageText(message);
  if (message.role !== "user") {
    return text;
  }
  return timestampedUserContent(
    userBody(text, attachmentNames(message)),
    new Date(message.metadata?.createdAt ?? Date.now()),
  );
}

export function transcript(messages: MemoriUIMessage[]) {
  return messages
    .map((message) => `${message.role}: ${historyContent(message)}`)
    .join("\n");
}
