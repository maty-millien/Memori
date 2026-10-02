import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { chatResponse } from "@/server/memori/chat";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@/shared/lib/memori";

const body = z.object({
  message: z.object({
    id: z.string(),
    parts: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), text: z.string() }),
        z.object({
          type: z.literal("file"),
          mediaType: z.enum(ATTACHMENT_TYPES),
          filename: z.string().optional(),
          url: z.string().regex(/^data:[^,]*;base64,/),
        }),
      ]),
    ),
  }),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = body.safeParse(await request.json());
        if (!parsed.success) {
          return new Response("Unsupported message or attachment", { status: 400 });
        }
        const { message } = parsed.data;
        const text = message.parts
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("")
          .trim();
        const files = message.parts.flatMap((part) =>
          part.type === "file"
            ? [
                {
                  bytes: Buffer.from(part.url.slice(part.url.indexOf(",") + 1), "base64"),
                  mediaType: part.mediaType,
                  filename: part.filename ?? "attachment",
                },
              ]
            : [],
        );
        if (!text && files.length === 0) {
          return new Response("Empty message", { status: 400 });
        }
        if (files.some((file) => file.bytes.length > MAX_ATTACHMENT_BYTES)) {
          return new Response("Attachments must be 20 MB or smaller", { status: 400 });
        }
        return chatResponse(message.id, text, files);
      },
    },
  },
});
