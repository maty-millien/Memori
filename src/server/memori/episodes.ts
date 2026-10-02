import type { MemoriUIMessage } from "@/shared/lib/memori";

import { summaryAgent } from "./agents";
import { assignEpisode, insertMemory } from "./db";
import { embedOne } from "./embeddings";
import { transcript } from "./transcript";

async function summarize(conversation: string) {
  if (!conversation) {
    return "";
  }
  const result = await summaryAgent.stream({ prompt: conversation });
  const { summary } = await result.output;
  return summary.trim();
}

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
