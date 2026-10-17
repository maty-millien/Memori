import type { MemoriUIMessage } from "@/shared/lib/memori";
import { runOnce } from "@/shared/server/codex";
import { assignEpisode, insertMemory } from "@/shared/server/db";

import { embedOne } from "./embeddings";
import { transcript } from "./prompting";

const SUMMARY_PROMPT =
  "Summarize the conversation in one short paragraph. Reply with the summary only. " +
  "Write it in the third person, focusing on the topics discussed, what the user wanted, " +
  "and what was decided. Skip greetings and small talk.";

export async function createEpisode(history: MemoriUIMessage[]) {
  const cut = history.findIndex(
    (message, index) => index >= history.length / 2 && message.role === "user",
  );
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
