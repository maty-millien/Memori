import type { MemoriUIMessage } from "@/shared/lib/memori";

import { runOnce } from "./codex";
import { assignEpisode, insertMemory } from "./db";
import { embedOne } from "./embeddings";
import { SUMMARY_PROMPT } from "./prompts";
import { transcript } from "./transcript";

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
