import { createServerFn } from "@tanstack/react-start";

import { listLiveMessages, listMemories, resetDatabase } from "@/shared/server/db";

import { createEpisode } from "./episodes";

export const getMemories = createServerFn().handler(() => ({
  memories: listMemories("memory"),
  conversations: listMemories("conversation"),
}));

export const resetEverything = createServerFn({ method: "POST" }).handler(() =>
  resetDatabase(),
);

export const triggerEpisode = createServerFn({ method: "POST" }).handler(() =>
  createEpisode(listLiveMessages()),
);
