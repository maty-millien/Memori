import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { chatOptions } from "@/shared/server/codex";
import { listMessages, setChatSettings } from "@/shared/server/db";

export const getMessages = createServerFn({ strict: { output: false } }).handler(() =>
  listMessages(),
);

export const loadChatOptions = createServerFn().handler(() => chatOptions());

export const saveChatSettings = createServerFn({ method: "POST" })
  .validator(z.object({ model: z.string(), effort: z.string() }))
  .handler(({ data }) => {
    setChatSettings(data);
  });
