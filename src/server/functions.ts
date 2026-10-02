import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  getSession,
  listMemories,
  listMessages,
  listSessions,
  resetMemories,
} from "./memori/db";
import { activeSessionId, startNewChat } from "./memori/sessions";

export const getSessions = createServerFn().handler(() => listSessions());

export const getActiveSessionId = createServerFn().handler(() => activeSessionId());

export const getSessionWithMessages = createServerFn({ strict: { output: false } })
  .validator(z.string())
  .handler(({ data }) => {
    const session = getSession(data);
    return session ? { session, messages: listMessages(data) } : null;
  });

export const newChat = createServerFn({ method: "POST" }).handler(() => startNewChat());

export const getMemories = createServerFn().handler(() => ({
  memories: listMemories("memory"),
  conversations: listMemories("conversation"),
}));

export const resetAllMemories = createServerFn({ method: "POST" }).handler(() => {
  resetMemories();
});
