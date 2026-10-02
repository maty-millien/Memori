import type { MemoriUIMessage } from "@/shared/lib/memori";

import { timestampedUserContent } from "./prompting";
import { uploadPath } from "./uploads";

export function userContent(message: MemoriUIMessage) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
  const files = message.parts.flatMap((part) =>
    part.type === "file"
      ? [`${part.filename ?? "attachment"} (${uploadPath(part.url)})`]
      : [],
  );
  const note = files.length > 0 ? `[attached: ${files.join(", ")}]` : "";
  return [text, note].filter(Boolean).join("\n\n");
}

function assistantLines(message: MemoriUIMessage) {
  return message.parts.flatMap((part) => {
    if (part.type === "text" && part.text.trim()) {
      return [`assistant: ${part.text.trim()}`];
    }
    if (part.type === "data-command") {
      return [`assistant ran: ${part.data.command}`];
    }
    if (part.type === "data-search") {
      return [`assistant searched: ${part.data.query}`];
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
