import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import {
  IMPORTANCES,
  SCOPES,
  type ChatSettings,
  type Conversation,
  type Importance,
  type Memory,
  type RemanenceUIMessage,
} from "@/shared/lib/remanence";

mkdirSync(".remanence", { recursive: true });

const db = new DatabaseSync(".remanence/remanence.db");

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    scope TEXT NOT NULL,
    importance TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_accessed_at TEXT,
    access_count INTEGER NOT NULL DEFAULT 0,
    embedding BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    embedding BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS archived_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    embedding BLOB NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS archived_turns_fts USING fts5(
    content,
    content = 'archived_turns',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    created_at TEXT NOT NULL,
    conversation_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS thread_items (
    message_id TEXT PRIMARY KEY,
    items TEXT NOT NULL
  );
`);

const memoryRow = z
  .object({
    id: z.number(),
    content: z.string(),
    scope: z.enum(SCOPES),
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
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
  }));

const conversationRow = z
  .object({
    id: z.number(),
    content: z.string(),
    started_at: z.string(),
    ended_at: z.string(),
  })
  .transform((row): Conversation => ({
    id: String(row.id),
    content: row.content,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }));

const CONVERSATION_QUERY = `SELECT conversations.id, conversations.content, conversations.embedding,
  MIN(messages.created_at) AS started_at, MAX(messages.created_at) AS ended_at
  FROM conversations JOIN messages ON messages.conversation_id = conversations.id
  GROUP BY conversations.id ORDER BY conversations.id`;

const turnRow = z
  .object({ id: z.number(), content: z.string() })
  .transform((row) => ({ id: String(row.id), content: row.content }));

const vectorRow = z.object({ embedding: z.instanceof(Uint8Array) });

const settingRow = z.object({ value: z.string() });

const messageRow = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.string(),
  created_at: z.string(),
});

const MEMORY_COLUMNS =
  "id, content, scope, importance, created_at, updated_at, last_accessed_at, access_count";

function toBlob(embedding: Float32Array) {
  return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

function fromBlob(blob: Uint8Array) {
  return new Float32Array(blob.slice().buffer);
}

export function listMemories() {
  return db
    .prepare(`SELECT ${MEMORY_COLUMNS} FROM memories ORDER BY id`)
    .all()
    .map((row) => memoryRow.parse(row));
}

export function listMemoryVectors() {
  return db
    .prepare(`SELECT ${MEMORY_COLUMNS}, embedding FROM memories`)
    .all()
    .map((row) => ({
      memory: memoryRow.parse(row),
      embedding: fromBlob(vectorRow.parse(row).embedding),
    }));
}

export function listConversations() {
  return db
    .prepare(CONVERSATION_QUERY)
    .all()
    .map((row) => conversationRow.parse(row));
}

export function listConversationVectors() {
  return db
    .prepare(CONVERSATION_QUERY)
    .all()
    .map((row) => ({
      conversation: conversationRow.parse(row),
      embedding: fromBlob(vectorRow.parse(row).embedding),
    }));
}

export function insertConversation(content: string, embedding: Float32Array) {
  const result = db
    .prepare(
      "INSERT INTO conversations (content, created_at, embedding) VALUES (?, ?, ?)",
    )
    .run(content, new Date().toISOString(), toBlob(embedding));
  return String(result.lastInsertRowid);
}

export function insertArchivedTurns(
  turns: { content: string; createdAt: string; embedding: Float32Array }[],
) {
  const insert = db.prepare(
    "INSERT INTO archived_turns (content, created_at, embedding) VALUES (?, ?, ?)",
  );
  const index = db.prepare(
    "INSERT INTO archived_turns_fts (rowid, content) VALUES (?, ?)",
  );
  for (const turn of turns) {
    const { lastInsertRowid } = insert.run(
      turn.content,
      turn.createdAt,
      toBlob(turn.embedding),
    );
    index.run(lastInsertRowid, turn.content);
  }
}

export function listArchivedTurnVectors() {
  return db
    .prepare("SELECT id, content, embedding FROM archived_turns")
    .all()
    .map((row) => ({
      turn: turnRow.parse(row),
      embedding: fromBlob(vectorRow.parse(row).embedding),
    }));
}

export function searchArchivedTurns(query: string, limit: number) {
  const words = query.match(/[\p{L}\p{N}]+/gu);
  if (!words) {
    return [];
  }
  return db
    .prepare(
      `SELECT archived_turns.id, archived_turns.content
       FROM archived_turns_fts JOIN archived_turns ON archived_turns.id = archived_turns_fts.rowid
       WHERE archived_turns_fts MATCH ? ORDER BY bm25(archived_turns_fts) LIMIT ?`,
    )
    .all(words.map((word) => `"${word}"`).join(" OR "), limit)
    .map((row) => turnRow.parse(row));
}

export function getMemory(id: string) {
  const row = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ?`).get(id);
  return row ? memoryRow.parse(row) : undefined;
}

export function insertMemory(
  memory: Pick<Memory, "content" | "scope" | "importance">,
  embedding: Float32Array,
) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO memories (content, scope, importance, created_at, updated_at, embedding)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(memory.content, memory.scope, memory.importance, now, now, toBlob(embedding));
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

export function resetDatabase() {
  db.exec(
    "DELETE FROM memories; DELETE FROM conversations; DELETE FROM archived_turns; INSERT INTO archived_turns_fts (archived_turns_fts) VALUES ('delete-all'); DELETE FROM messages; DELETE FROM settings; DELETE FROM thread_items; DELETE FROM sqlite_sequence;",
  );
}

function queryMessages(where: string): RemanenceUIMessage[] {
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
  return queryMessages("WHERE conversation_id IS NULL");
}

export function saveMessage(message: RemanenceUIMessage) {
  db.prepare(
    "INSERT INTO messages (id, role, parts, created_at) VALUES (?, ?, ?, ?)",
  ).run(
    message.id,
    message.role,
    JSON.stringify(message.parts),
    message.metadata?.createdAt ?? new Date().toISOString(),
  );
}

export function updateMessageParts(id: string, parts: RemanenceUIMessage["parts"]) {
  db.prepare("UPDATE messages SET parts = ? WHERE id = ?").run(JSON.stringify(parts), id);
}

export function assignConversation(messageIds: string[], conversationId: string) {
  const statement = db.prepare("UPDATE messages SET conversation_id = ? WHERE id = ?");
  for (const id of messageIds) {
    statement.run(conversationId, id);
  }
}

export function saveThreadItems(messageId: string, items: unknown[]) {
  db.prepare("INSERT INTO thread_items (message_id, items) VALUES (?, ?)").run(
    messageId,
    JSON.stringify(items),
  );
}

export function getThreadItems(messageId: string): unknown {
  const row = db
    .prepare("SELECT items FROM thread_items WHERE message_id = ?")
    .get(messageId);
  return row ? JSON.parse(z.object({ items: z.string() }).parse(row).items) : undefined;
}

function getSetting(key: string) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? settingRow.parse(row).value : undefined;
}

export function getChatSettings() {
  return {
    model: getSetting("chat_model"),
    effort: getSetting("chat_effort"),
  };
}

export function setChatSettings(settings: ChatSettings) {
  const statement = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  statement.run("chat_model", settings.model);
  statement.run("chat_effort", settings.effort);
}
