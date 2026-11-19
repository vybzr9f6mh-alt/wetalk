import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  avatar_hue    INTEGER NOT NULL DEFAULT 0,
  signature     TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, contact_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,                -- direct | group
  name            TEXT NOT NULL DEFAULT '',
  owner_id        INTEGER,
  dm_key          TEXT UNIQUE,
  created_at      INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       INTEGER NOT NULL,
  last_read_id    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id),
  type            TEXT NOT NULL DEFAULT 'text', -- text | image | system
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_members_user  ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id, status);
`;

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

/** chat 类型会话的成员校验 */
export function isMember(db, conversationId, userId) {
  const row = db
    .prepare('SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
  return Boolean(row);
}

export function memberIds(db, conversationId) {
  return db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId)
    .map((r) => r.user_id);
}

/** 取（或创建）两人单聊会话，按 uid 大小生成唯一 dm_key */
export function getOrCreateDirect(db, a, b) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  const found = db.prepare('SELECT id FROM conversations WHERE dm_key = ?').get(key);
  if (found) return found.id;

  const now = Date.now();
  const info = db
    .prepare('INSERT INTO conversations (type, name, owner_id, dm_key, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('direct', '', a, key, now);
  const cid = Number(info.lastInsertRowid);
  const add = db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)');
  add.run(cid, a, now);
  add.run(cid, b, now);
  return cid;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatarHue: row.avatar_hue,
    signature: row.signature,
    lastSeen: row.last_seen,
  };
}
