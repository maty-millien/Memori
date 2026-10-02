import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import {
  IMPORTANCES,
  KINDS,
  SCOPES,
  type Importance,
  type Kind,
  type Memory,
  type MemoriUIMessage,
} from "@/shared/lib/memori";

mkdirSync(".memori", { recursive: true });

const db = new DatabaseSync(".memori/memori.db");

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    importance TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_accessed_at TEXT,
    access_count INTEGER NOT NULL DEFAULT 0,
    embedding BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    created_at TEXT NOT NULL,
    episode_id INTEGER
  );
`);

const memoryRow = z
  .object({
    id: z.number(),
    content: z.string(),
    scope: z.enum(SCOPES),
    kind: z.enum(KINDS),
    importance: z.enum(IMPORTANCES),
    created_at: z.string(),
    updated_at: z.string(),
    last_accessed_at: z.string().nullable(),
    access_count: z.number(),
  })
  .transform((row): Memory => ({
    id: String(row.id),
    content: row.content,
    scope: row.scope,
    kind: row.kind,
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
  }));

const vectorRow = z.object({ embedding: z.instanceof(Uint8Array) });

const messageRow = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.string(),
  created_at: z.string(),
});

const MEMORY_COLUMNS =
  "id, content, scope, kind, importance, created_at, updated_at, last_accessed_at, access_count";

function toBlob(embedding: Float32Array) {
  return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

function fromBlob(blob: Uint8Array) {
  return new Float32Array(blob.slice().buffer);
}

export function listMemories(kind: Kind) {
  return db
    .prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE kind = ? ORDER BY id`)
    .all(kind)
    .map((row) => memoryRow.parse(row));
}

export function listMemoryVectors(kind: Kind) {
  return db
    .prepare(`SELECT ${MEMORY_COLUMNS}, embedding FROM memories WHERE kind = ?`)
    .all(kind)
    .map((row) => ({
      memory: memoryRow.parse(row),
      embedding: fromBlob(vectorRow.parse(row).embedding),
    }));
}

export function getMemory(id: string) {
  const row = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ?`).get(id);
  return row ? memoryRow.parse(row) : undefined;
}

export function insertMemory(
  memory: Pick<Memory, "content" | "scope" | "kind" | "importance">,
  embedding: Float32Array,
) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO memories (content, scope, kind, importance, created_at, updated_at, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      memory.content,
      memory.scope,
      memory.kind,
      memory.importance,
      now,
      now,
      toBlob(embedding),
    );
  return String(result.lastInsertRowid);
}

export function updateMemory(
  id: string,
  content: string,
  importance: Importance,
  embedding: Float32Array,
) {
  db.prepare(
    "UPDATE memories SET content = ?, importance = ?, embedding = ?, updated_at = ? WHERE id = ?",
  ).run(content, importance, toBlob(embedding), new Date().toISOString(), id);
}

export function deleteMemory(id: string) {
  return db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
}

export function markAccessed(ids: string[]) {
  const statement = db.prepare(
    "UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
  );
  const now = new Date().toISOString();
  for (const id of ids) {
    statement.run(now, id);
  }
}

export function resetMemories() {
  db.exec("DELETE FROM memories; DELETE FROM sqlite_sequence WHERE name = 'memories';");
}

function queryMessages(where: string): MemoriUIMessage[] {
  return db
    .prepare(`SELECT id, role, parts, created_at FROM messages ${where} ORDER BY rowid`)
    .all()
    .map((row) => {
      const message = messageRow.parse(row);
      return {
        id: message.id,
        role: message.role,
        parts: JSON.parse(message.parts),
        metadata: { createdAt: message.created_at },
      };
    });
}

export function listMessages() {
  return queryMessages("");
}

export function listLiveMessages() {
  return queryMessages("WHERE episode_id IS NULL");
}

export function saveMessage(message: MemoriUIMessage) {
  db.prepare(
    "INSERT INTO messages (id, role, parts, created_at) VALUES (?, ?, ?, ?)",
  ).run(
    message.id,
    message.role,
    JSON.stringify(message.parts),
    message.metadata?.createdAt ?? new Date().toISOString(),
  );
}

export function assignEpisode(messageIds: string[], episodeId: string) {
  const statement = db.prepare("UPDATE messages SET episode_id = ? WHERE id = ?");
  for (const id of messageIds) {
    statement.run(episodeId, id);
  }
}
