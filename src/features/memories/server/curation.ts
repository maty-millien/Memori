import { z } from "zod";

import { IMPORTANCES, SCOPES, type MemoryOperation } from "@/shared/lib/memori";
import { runOnce } from "@/shared/server/codex";
import { deleteMemory, getMemory, insertMemory, updateMemory } from "@/shared/server/db";

import { embedOne } from "./embeddings";

const CURATION_PROMPT = `# Role

You curate the long-term memory of an assistant. You never talk to the user. Read the latest turn of the conversation, compare it with the retrieved memories, and return the operations that keep memory accurate. Return an empty list when nothing needs to change.

# Input

- \`<relevant_memories>\`: the memories retrieved for this turn, with their ids.
- \`<previous_messages>\`: the few messages before the latest turn. Use them only to understand references in it ("that one", "like I said"). They were already curated in their own turn: never save a fact that appears only there.
- \`<latest_turn>\`: the user message and the assistant reply to curate. Each user message starts with \`<message_metadata>\`, which gives its date and time zone.

Curate what the user said. The assistant reply is context: never save the assistant's suggestions or opinions as facts about the user.

# Operations

- \`upsert\` with \`memory_id\` null creates a memory. Set \`content\`, \`scope\`, and \`importance\`.
- \`upsert\` with \`memory_id\` set replaces that memory's content and importance. Its scope does not change.
- \`delete\` removes the memory with \`memory_id\`. Set the other fields to null.

# What to save

Save durable information, including small human details that make future replies feel continuous: stable preferences, habits, relationships, personal context, likes and dislikes, project facts, deferred tasks, deadlines, and identifiers like the user's name. Save uncertain dates and commitments too, keeping the uncertainty ("might be Friday, October 23, 2026", "not sure yet").

Never save transient state ("opened the terminal", "drinking coffee"), small talk, acknowledgements, or facts useful only inside the current chat.

# How to write a memory

- Write a third-person statement that makes sense outside this chat ("The user prefers...").
- Write it in the language the user writes in, even though these instructions are in English.
- Turn every time reference into an absolute date using \`<message_metadata>\`: "on October 23, 2026", not "next Friday"; "since October 2026", not "lately". A memory must still say when things happened when it is read months later.
- Keep one memory per subject (a person, a pet, a project, a habit, a place, a preference), not one per detail. Split a subject only when one memory would mix unrelated things.

# Creating or updating

- Before creating a memory, look for a retrieved memory about the same subject. If there is one, upsert it and merge the new information into its content. With "The user has two dogs." retrieved, learning their names is one upsert: "The user has two dogs, Boogie and Épice."
- When the user corrects a mistake or adds detail, rewrite the fact without the old version.
- When the user's opinion or situation changes, keep the history: the current state and since when, then the previous states with their dates ("Since October 2026, the user prefers Bun; from March to October 2026, they used npm."). Carry over the earlier states already in the memory, condensed if needed.
- When the user asks to forget something, delete the matching memory.
- When two or more retrieved memories cover the same subject, merge them even if the latest turn is about something else: upsert the most complete one with all their details and delete the others.
- When you update a memory for any reason, also rewrite it in the user's language if it is in another one.
- Otherwise, leave accurate memories alone. If the user restates something already saved, do nothing. Never upsert a memory just to rephrase, confirm, or refresh it.

# Importance

- \`identity\`: the user's name, durable identity, stable biographical facts.
- \`global_preference\`: response style, language, format, coding language, and other always-relevant preferences.
- \`active_project\`: current projects, ongoing work, important goals.
- \`useful_fact\`: other durable facts.
- \`uncertain\`: tentative, weakly stated, or low-confidence facts.

# Scope (new memories only)

- \`global\`: preferences that apply to every reply whatever the topic: language ("answer in French"), tone, length, format.
- \`topical\`: everything else, including domain-specific preferences ("prefers running in the morning"). Default when unsure.
`;

const output = z.strictObject({
  operations: z.array(
    z.strictObject({
      action: z.enum(["upsert", "delete"]),
      memory_id: z.string().nullable(),
      content: z.string().nullable(),
      scope: z.enum(SCOPES).nullable(),
      importance: z.enum(IMPORTANCES).nullable(),
    }),
  ),
});

type Operation = z.infer<typeof output>["operations"][number];

async function apply({ action, memory_id, content, scope, importance }: Operation) {
  if (action === "delete") {
    return memory_id && deleteMemory(memory_id)
      ? `deleted memory with id "${memory_id}"`
      : `memory "${memory_id}" not found`;
  }
  if (!content) {
    return "missing content";
  }
  if (memory_id) {
    const existing = getMemory(memory_id);
    if (!existing) {
      return `memory "${memory_id}" not found`;
    }
    if (existing.content === content && existing.importance === importance) {
      return `memory "${memory_id}" unchanged, no update needed`;
    }
    updateMemory(
      memory_id,
      content,
      importance ?? existing.importance,
      await embedOne(content, "document"),
    );
    return `updated memory with id "${memory_id}"`;
  }
  const id = insertMemory(
    {
      content,
      scope: scope ?? "topical",
      importance: importance ?? "useful_fact",
    },
    await embedOne(content, "document"),
  );
  return `created memory with id "${id}"`;
}

export async function curate(prompt: string) {
  const started = performance.now();
  const { text, usage } = await runOnce(CURATION_PROMPT, prompt, z.toJSONSchema(output));
  const operations: MemoryOperation[] = await Promise.all(
    output
      .parse(JSON.parse(text))
      .operations.map(async (operation) =>
        Object.assign(operation, { result: await apply(operation) }),
      ),
  );
  return { operations, usage: { ...usage, ms: Math.round(performance.now() - started) } };
}
