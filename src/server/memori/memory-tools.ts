import { tool } from "ai";
import { z } from "zod";

import { IMPORTANCES, SCOPES } from "@/shared/lib/memori";

import { deleteMemory, getMemory, insertMemory, updateMemory } from "./db";
import { embedOne } from "./embeddings";

export const memoryTools = {
  memory_upsert: tool({
    description:
      "Create a new durable memory or replace the content of an existing one. Only call for stable, generalizable information worth recalling later.",
    inputSchema: z.object({
      content: z
        .string()
        .describe(
          "Memory content phrased as a third-person statement that survives outside the current chat.",
        ),
      memory_id: z
        .string()
        .nullable()
        .optional()
        .describe("Existing memory id to replace. Omit when creating a new memory."),
      scope: z.enum(SCOPES).default("topical"),
      importance: z.enum(IMPORTANCES).default("useful_fact"),
    }),
    execute: async ({ content, memory_id, scope, importance }) => {
      if (memory_id) {
        const existing = getMemory(memory_id);
        if (!existing) {
          return `memory "${memory_id}" not found`;
        }
        if (existing.content === content && existing.importance === importance) {
          return `memory "${memory_id}" unchanged, no update needed`;
        }
        updateMemory(memory_id, content, importance, await embedOne(content));
        return `updated memory with id "${memory_id}"`;
      }
      const id = insertMemory(
        { content, scope, kind: "memory", importance },
        await embedOne(content),
      );
      return `created memory with id "${id}"`;
    },
  }),
  memory_delete: tool({
    description:
      "Delete an existing memory when the user asks to forget it or when a retrieved memory is redundant.",
    inputSchema: z.object({
      memory_id: z.string().describe("The id of the memory to delete."),
    }),
    execute: async ({ memory_id }) =>
      deleteMemory(memory_id)
        ? `deleted memory with id "${memory_id}"`
        : `memory "${memory_id}" not found`,
  }),
};
