import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { chatOptions } from "@/shared/server/codex";
import { listMessages, setChatSettings } from "@/shared/server/db";

import { activeUserMessage, answerQuestion } from "./chat";

export const getMessages = createServerFn({ strict: { output: false } }).handler(() => {
  const userMessage = activeUserMessage();
  return userMessage ? [...listMessages(), userMessage] : listMessages();
});

export const loadChatOptions = createServerFn().handler(() => chatOptions());

export const saveChatSettings = createServerFn({ method: "POST" })
  .validator(z.object({ model: z.string(), effort: z.string() }))
  .handler(({ data }) => {
    setChatSettings(data);
  });

export const sendAnswers = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), answers: z.array(z.array(z.string())) }))
  .handler(({ data }) => {
    answerQuestion(data.id, data.answers);
  });
