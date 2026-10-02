import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { CHAT_MODEL_IDS, REASONING_EFFORTS } from "@/shared/lib/memori";

import {
  getChatSettings,
  listMemories,
  listMessages,
  resetMemories,
  setChatSettings,
} from "./memori/db";

export const getMessages = createServerFn({ strict: { output: false } }).handler(() =>
  listMessages(),
);

export const loadChatSettings = createServerFn().handler(() => getChatSettings());

export const saveChatSettings = createServerFn({ method: "POST" })
  .validator(
    z.object({ model: z.enum(CHAT_MODEL_IDS), effort: z.enum(REASONING_EFFORTS) }),
  )
  .handler(({ data }) => {
    setChatSettings(data);
  });

export const getMemories = createServerFn().handler(() => ({
  memories: listMemories("memory"),
  conversations: listMemories("conversation"),
}));

export const resetAllMemories = createServerFn({ method: "POST" }).handler(() => {
  resetMemories();
});
