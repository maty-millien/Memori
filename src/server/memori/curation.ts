import { z } from "zod";

import { IMPORTANCES, SCOPES, type MemoryOperation } from "@/shared/lib/memori";

import { runOnce } from "./codex";
import { deleteMemory, getMemory, insertMemory, updateMemory } from "./db";
import { embedOne } from "./embeddings";
import { CURATION_PROMPT } from "./prompts";

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
  return { operations, usage, ms: Math.round(performance.now() - started) };
}
