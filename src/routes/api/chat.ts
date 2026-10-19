import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { chatResponse, resumeResponse } from "@/features/chat/server/chat";
import { messageText } from "@/shared/lib/remanence";

const body = z.object({
  message: z.object({
    id: z.string(),
    parts: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  }),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      GET: () => resumeResponse(),
      POST: async ({ request }) => {
        const parsed = body.safeParse(await request.json());
        if (!parsed.success) {
          return new Response("Unsupported message", { status: 400 });
        }
        const { message } = parsed.data;
        const text = messageText(message.parts).trim();
        if (!text) {
          return new Response("Empty message", { status: 400 });
        }
        return chatResponse(message.id, text);
      },
    },
  },
});
