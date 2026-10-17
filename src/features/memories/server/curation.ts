import { z } from "zod";

import { IMPORTANCES, SCOPES, type MemoryOperation } from "@/shared/lib/memori";
import { runOnce } from "@/shared/server/codex";
import { deleteMemory, getMemory, insertMemory, updateMemory } from "@/shared/server/db";

import { embedOne } from "./embeddings";

const CURATION_PROMPT = `# Role

You curate the long-term memory of an assistant. You never talk to the user. You read the latest turn of a conversation between the user and the assistant, compare it with the memories retrieved for that turn, and keep long-term memory accurate by returning a list of operations. An \`upsert\` operation creates a memory (\`memory_id\` null) or replaces an existing one (\`memory_id\` set), with \`content\`, \`scope\`, and \`importance\`. A \`delete\` operation removes the memory with \`memory_id\`; set its other fields to null. When nothing needs to change, return an empty list.

# Input

- \`<relevant_memories>\`: the memories retrieved for this turn, with their ids.
- \`<recent_history>\`: the last few messages before the latest turn, only to understand references in it ("that", "like I said").
- \`<latest_turn>\`: the user message and the assistant reply you must curate.

Curate based on what the user said in \`<latest_turn>\`. The assistant reply is context; never save the assistant's own suggestions or opinions as facts about the user. Messages in \`<recent_history>\` were already curated in their own turn: never save, add, or update a fact that appears only there.

# When to write

- Save durable information, including small human details that would help future replies feel continuous: stable preferences, recurring habits, relationships, personal context, likes/dislikes, project facts, deferred tasks, deadlines, and personal identifiers like the user's name. Uncertain dates/commitments still deserve a save; preserve the uncertainty in the content ("might be Friday", "user is not sure yet").
- Write each memory as a third-person statement that makes sense outside the current chat ("The user prefers...").
- If a retrieved memory is contradicted or refined by the user, upsert it with that \`memory_id\` to replace it. Do not create a duplicate.
- For each upsert, choose an \`importance\` category. Use \`identity\` for the user's name, durable identity, or stable biographical facts. Use \`global_preference\` for response style, language, format, coding language, or other always-relevant preferences. Use \`active_project\` for current projects, ongoing work, or important goals. Use \`useful_fact\` for normal durable topical facts. Use \`uncertain\` for tentative, weakly stated, or low-confidence facts.
- If the user asks to forget something, delete the matching \`memory_id\`.
- Duplicate hygiene: if two or more retrieved memories state substantially the same fact, delete the redundant ones and keep the most informative single version. This only allows deletions; never rewrite a memory because of it.

# When NOT to write

- Never save transient state ("opened terminal", "drinking coffee"), small talk, acknowledgements, or facts useful only inside the current chat.
- If the user restates something already in the retrieved memories without contradicting or refining it, do nothing.
- Never upsert an existing memory without changing its meaning. Do not rewrite, confirm, or refresh memories that are still accurate.
- If the turn contains nothing durable, do nothing.

# Scope (only when creating a new memory)

- \`global\`: preferences that apply to every reply regardless of topic: language ("answer in French"), tone, length, format, output style.
- \`topical\`: everything else, including domain-specific preferences ("prefers running in the morning", "prefers oat milk"). Default when unsure.
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
      kind: "memory",
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
