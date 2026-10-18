import type { MemoriUIMessage } from "@/shared/lib/memori";
import { runOnce } from "@/shared/server/codex";
import { assignEpisode, getThreadItems, insertMemory } from "@/shared/server/db";

import { embedOne } from "./embeddings";
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

export async function createEpisode(history: MemoriUIMessage[]) {
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
  const conversation = transcript(messages);
  if (!conversation) {
    return null;
  }
  const { text } = await runOnce(SUMMARY_PROMPT, conversation);
  const summary = text.trim();
  if (!summary) {
    return null;
  }
  const episodeId = insertMemory(
    {
      content: summary,
      scope: "topical",
      kind: "conversation",
      importance: "useful_fact",
    },
    await embedOne(summary, "document"),
  );
  assignEpisode(
    messages.map((message) => message.id),
    episodeId,
  );
  return { episodeId, summary, messageCount: messages.length };
}
