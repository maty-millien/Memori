import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { chatOptions } from "./memori/codex";
import {
  listLiveMessages,
  listMemories,
  listMessages,
  resetDatabase,
  setChatSettings,
} from "./memori/db";
import { createEpisode } from "./memori/episodes";
import { trashUploads } from "./memori/uploads";

export const getMessages = createServerFn({ strict: { output: false } }).handler(() =>
  listMessages(),
);

export const loadChatOptions = createServerFn().handler(() => chatOptions());

export const saveChatSettings = createServerFn({ method: "POST" })
  .validator(z.object({ model: z.string(), effort: z.string() }))
  .handler(({ data }) => {
    setChatSettings(data);
  });

export const getMemories = createServerFn().handler(() => ({
  memories: listMemories("memory"),
  conversations: listMemories("conversation"),
}));

export const resetEverything = createServerFn({ method: "POST" }).handler(() => {
  resetDatabase();
  trashUploads();
});

export const triggerEpisode = createServerFn({ method: "POST" }).handler(async () => {
  const history = listLiveMessages();
  if (history.length === 0) {
    return null;
  }
  return createEpisode(history);
});
