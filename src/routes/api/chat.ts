import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { chatResponse } from "@/server/memori/chat";

const body = z.object({
  sessionId: z.string(),
  message: z.object({
    id: z.string(),
    parts: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  }),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { sessionId, message } = body.parse(await request.json());
        const text = message.parts
          .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
          .join("")
          .trim();
        if (!text) {
          return new Response("Empty message", { status: 400 });
        }
        return chatResponse(sessionId, message.id, text);
      },
    },
  },
});
