import type { MemoriUIMessage } from "@/shared/lib/memori";

import { assignEpisode, insertMemory } from "./db";
import { embedOne } from "./embeddings";
import { summarize } from "./summarization";
import { transcript } from "./transcript";

export async function createEpisode(history: MemoriUIMessage[]) {
  const cut = history.findIndex(
    (message, index) => index >= history.length / 2 && message.role === "user",
  );
  const messages = history.slice(0, cut === -1 ? history.length : cut);
  const summary = await summarize(transcript(messages));
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
    await embedOne(summary),
  );
  assignEpisode(
    messages.map((message) => message.id),
    episodeId,
  );
  return { episodeId, summary, messageCount: messages.length };
}
