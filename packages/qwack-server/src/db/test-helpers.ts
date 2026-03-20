import { createDatabase } from "./index";
import { SqliteRepository } from "../repo/sqlite";

export const SQL_CREATE_TABLES = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    github_id TEXT UNIQUE,
    password_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    creator_id TEXT REFERENCES users(id),
    agent_autonomy TEXT NOT NULL DEFAULT 'hybrid',
    permission_model TEXT NOT NULL DEFAULT 'host_decides',
    disagreement_threshold TEXT NOT NULL DEFAULT 'configurable',
    plan_yjs_state BLOB,
    short_code TEXT UNIQUE,
    context_snapshot TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE session_participants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'collaborator',
    is_connected INTEGER DEFAULT 0,
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(session_id, user_id)
  );
  CREATE TABLE session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
    type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX session_events_session_idx ON session_events(session_id);
  CREATE INDEX session_events_timestamp_idx ON session_events(timestamp);
`;

export function createTestDatabase() {
  const result = createDatabase(":memory:");
  result.sqlite.exec(SQL_CREATE_TABLES);
  return result;
}

export function createTestRepository() {
  const { db, sqlite } = createTestDatabase();
  const repo = new SqliteRepository(db);
  return { repo, db, sqlite };
}
