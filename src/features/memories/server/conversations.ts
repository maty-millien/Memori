import type { RemanenceUIMessage } from "@/shared/lib/remanence";
import { runOnce } from "@/shared/server/codex";
import {
  assignConversation,
  getThreadItems,
  insertArchivedTurns,
  insertConversation,
} from "@/shared/server/db";

import { embed, embedOne } from "./embeddings";
import { transcript } from "./prompting";

const SUMMARY_PROMPT =
  "Summarize the conversation so the work can continue from it later. Reply with the summary only, " +
  "in plain text, in the third person, under 300 words. Use these short labeled sections and omit any that would be empty:\n" +
  "Goals: what the user wanted to achieve.\n" +
  "Decisions: what was decided and why.\n" +
  "Artifacts: exact file paths, commands, URLs, and names that were created, changed, or used.\n" +
  "Failed attempts: what was tried and did not work, and why.\n" +
  "Open: unanswered questions and next steps.\n" +
  "Keep only what this conversation adds. Skip greetings, small talk, and general facts about the user.";

export async function archiveConversation(history: RemanenceUIMessage[]) {
  const weights = history.map(
    (message) => JSON.stringify(getThreadItems(message.id) ?? message.parts).length,
  );
  const half = weights.reduce((sum, weight) => sum + weight, 0) / 2;
  let archived = 0;
  const cut = history.findIndex((message, index) => {
    const reached = archived >= half && message.role === "user";
    archived += weights[index];
    return reached;
  });
  const messages = history.slice(0, cut === -1 ? history.length : cut);
  const log = transcript(messages);
  if (!log) {
    return null;
  }
  const turns: RemanenceUIMessage[][] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (message.role === "user" || !last) {
      turns.push([message]);
    } else {
      last.push(message);
    }
  }
  const indexed = turns
    .map((turn) => ({
      content: transcript(turn),
      createdAt: turn[0].metadata?.createdAt ?? new Date().toISOString(),
    }))
    .filter((turn) => turn.content);
  const [{ text }, embeddings] = await Promise.all([
    runOnce(SUMMARY_PROMPT, log),
    embed(
      indexed.map((turn) => turn.content),
      "document",
    ),
  ]);
  const summary = text.trim();
  if (!summary) {
    return null;
  }
  insertArchivedTurns(
    indexed.map((turn, index) => Object.assign(turn, { embedding: embeddings[index] })),
  );
  const conversationId = insertConversation(summary, await embedOne(summary, "document"));
  assignConversation(
    messages.map((message) => message.id),
    conversationId,
  );
  return { summary, messageCount: messages.length };
}
