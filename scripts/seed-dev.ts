#!/usr/bin/env bun

/**
 * Seed the dev database with test users.
 * Safe to run multiple times — uses INSERT OR IGNORE.
 *
 * Usage:
 *   bun scripts/seed-dev.ts                    # uses default ./qwack.db
 *   QWACK_DATABASE_URL=file:./dev.db bun scripts/seed-dev.ts
 */

import { Database } from "bun:sqlite";
import { resolve, dirname } from "node:path";

const scriptDir = dirname(new URL(import.meta.url).pathname);
const serverDir = resolve(scriptDir, "..", "packages", "qwack-server");
const dbUrl = process.env.QWACK_DATABASE_URL ?? `file:${resolve(serverDir, "qwack.db")}`;
const dbPath = dbUrl.startsWith("file:") ? dbUrl.slice(5) : dbUrl;
const fullPath = resolve(dbPath);

console.log(`🦆 Seeding database: ${fullPath}`);

const sqlite = new Database(fullPath);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

// Create tables if they don't exist (for fresh DBs)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    github_id TEXT UNIQUE,
    password_hash TEXT,
    public_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS sessions (
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
  CREATE TABLE IF NOT EXISTS session_participants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'collaborator',
    is_connected INTEGER DEFAULT 0,
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(session_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
    type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_sender_keys (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL REFERENCES users(id),
    recipient_user_id TEXT NOT NULL REFERENCES users(id),
    encrypted_skdm TEXT NOT NULL,
    iv TEXT NOT NULL,
    sender_public_key TEXT NOT NULL,
    distribution_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Seed test users (stub auth: token = userId)
const users = [
  { id: "alice", email: "alice@qwack.dev", name: "Alice" },
  { id: "bob", email: "bob@qwack.dev", name: "Bob" },
  { id: "charlie", email: "charlie@qwack.dev", name: "Charlie" },
];

const stmt = sqlite.prepare(
  "INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)",
);

for (const user of users) {
  const result = stmt.run(user.id, user.email, user.name);
  if (result.changes > 0) {
    console.log(`  ✅ Created user: ${user.name} (token: ${user.id})`);
  } else {
    console.log(`  ⏭️  User exists: ${user.name} (token: ${user.id})`);
  }
}

sqlite.close();
console.log("\n🦆 Seed complete. Start the server with: bun run dev:server");
console.log("   Then connect as alice: bun scripts/test-client.ts alice");
console.log("   Or connect as bob:    bun scripts/test-client.ts bob");
