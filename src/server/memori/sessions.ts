import {
  createSession,
  endSession,
  getActiveSession,
  insertMemory,
  listMessages,
} from "./db";
import { embedOne } from "./embeddings";
import { summarize } from "./summarization";
import { transcript } from "./transcript";

export function activeSessionId() {
  return getActiveSession()?.id ?? createSession();
}

export async function startNewChat() {
  const active = getActiveSession();
  if (!active) {
    return createSession();
  }
  const messages = listMessages(active.id);
  if (messages.length === 0) {
    return active.id;
  }
  const summary = await summarize(transcript(messages));
  if (summary) {
    insertMemory(
      {
        content: summary,
        scope: "topical",
        kind: "conversation",
        importance: "useful_fact",
        sessionId: active.id,
      },
      await embedOne(summary),
    );
  }
  endSession(active.id, summary);
  return createSession();
}
