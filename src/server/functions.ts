import { createServerFn } from "@tanstack/react-start";

import { listMemories, listMessages, resetMemories } from "./memori/db";

export const getMessages = createServerFn({ strict: { output: false } }).handler(() =>
  listMessages(),
);

export const getMemories = createServerFn().handler(() => ({
  memories: listMemories("memory"),
  conversations: listMemories("conversation"),
}));

export const resetAllMemories = createServerFn({ method: "POST" }).handler(() => {
  resetMemories();
});
