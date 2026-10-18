import { createServerFn } from "@tanstack/react-start";

import {
  listConversations,
  listLiveMessages,
  listMemories,
  resetDatabase,
} from "@/shared/server/db";

import { archiveConversation } from "./conversations";

export const getMemories = createServerFn().handler(() => ({
  memories: listMemories(),
  conversations: listConversations(),
}));

export const resetEverything = createServerFn({ method: "POST" }).handler(() =>
  resetDatabase(),
);

export const triggerCompaction = createServerFn({ method: "POST" }).handler(() =>
  archiveConversation(listLiveMessages()),
);
