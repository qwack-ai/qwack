#!/usr/bin/env bun

/**
 * End-to-end verification of Qwack WebSocket relay.
 *
 * Seeds the database, starts the server, connects two WS clients (Alice + Bob),
 * and verifies all relay paths:
 *   1. Auth (auth:ok for both)
 *   2. Presence (join events, presence:list)
 *   3. Collab messages (collab:message relay)
 *   4. Agent output (agent:output relay)
 *   5. Agent thinking (agent:thinking relay)
 *   6. Agent complete (agent:complete relay)
 *
 * Usage:
 *   bun scripts/verify-e2e.ts
 *
 * Exit code 0 = all pass, 1 = failures.
 */

import { Database } from "bun:sqlite"
import { resolve, dirname } from "node:path"
import { Subprocess } from "bun"

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname)
const REPO_ROOT = resolve(SCRIPT_DIR, "..")
const SERVER_DIR = resolve(REPO_ROOT, "packages", "qwack-server")
const PORT = 4111 // Use non-standard port to avoid conflicts
const TIMEOUT_MS = 10_000

// ── Helpers ──────────────────────────────────────────────────────

let passed = 0
let failed = 0

function ok(name: string) {
  passed++
  console.log(`  ✅ ${name}`)
}

function fail(name: string, reason: string) {
  failed++
  console.error(`  ❌ ${name}: ${reason}`)
}

function waitFor<T>(msgs: T[], predicate: (m: T) => boolean, label: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    // Check existing messages first
    const found = msgs.find(predicate)
    if (found) return resolve(found)

    const interval = setInterval(() => {
      const found = msgs.find(predicate)
      if (found) {
        clearInterval(interval)
        clearTimeout(timer)
        resolve(found)
      }
    }, 50)

    const timer = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(`Timed out waiting for: ${label}`))
    }, timeoutMs)
  })
}

type WsMsg = { type: string; payload: Record<string, unknown>; [k: string]: unknown }

function connectClient(token: string, sessionId: string): Promise<{ ws: WebSocket; msgs: WsMsg[] }> {
  return new Promise((resolve, reject) => {
    const msgs: WsMsg[] = []
    const url = `ws://localhost:${PORT}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}&name=${token}`
    const ws = new WebSocket(url)

    const timer = setTimeout(() => reject(new Error(`WS connect timeout for ${token}`)), 5000)

    ws.onopen = () => {
      clearTimeout(timer)
      ws.onmessage = (event) => {
        try {
          msgs.push(JSON.parse(event.data as string))
        } catch {}
      }
      resolve({ ws, msgs })
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error(`WS connection failed for ${token}`))
    }
  })
}

function wsSend(ws: WebSocket, type: string, sessionId: string, payload: Record<string, unknown>) {
  ws.send(JSON.stringify({ type, sessionId, senderId: "test", timestamp: Date.now(), payload }))
}

// ── Seed ─────────────────────────────────────────────────────────

console.log("\n🦆 Qwack E2E Verification\n")
console.log("Seeding database...")

const dbPath = resolve(SERVER_DIR, "qwack-e2e.db")
const sqlite = new Database(dbPath)
sqlite.exec("PRAGMA journal_mode = WAL;")
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    avatar_url TEXT, github_id TEXT UNIQUE, password_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    creator_id TEXT REFERENCES users(id), agent_autonomy TEXT NOT NULL DEFAULT 'hybrid',
    permission_model TEXT NOT NULL DEFAULT 'driver_decides',
    disagreement_threshold TEXT NOT NULL DEFAULT 'configurable',
    plan_yjs_state BLOB,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS session_participants (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL DEFAULT 'collaborator',
    is_connected INTEGER DEFAULT 0, joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(session_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL DEFAULT (unixepoch()), type TEXT NOT NULL,
    actor_type TEXT NOT NULL, actor_id TEXT, payload TEXT NOT NULL
  );
`)
sqlite.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)").run("alice", "alice@e2e.dev", "Alice")
sqlite.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)").run("bob", "bob@e2e.dev", "Bob")
sqlite.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)").run("charlie", "charlie@e2e.dev", "Charlie")
sqlite.close()
console.log("  Seeded alice + bob + charlie\n")

// ── Start server ─────────────────────────────────────────────────

console.log("Starting server...")
const serverProc = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    QWACK_PORT: String(PORT),
    QWACK_DATABASE_URL: `file:${dbPath}`,
  },
  stdout: "pipe",
  stderr: "pipe",
})

// Wait for server to be ready
let serverReady = false
for (let i = 0; i < 40; i++) {
  try {
    const resp = await fetch(`http://localhost:${PORT}/health`)
    if (resp.ok) {
      serverReady = true
      break
    }
  } catch {}
  await Bun.sleep(250)
}

if (!serverReady) {
  console.error("❌ Server failed to start")
  serverProc.kill()
  process.exit(1)
}
console.log(`  Server running on port ${PORT}\n`)

// ── Tests ────────────────────────────────────────────────────────

const SESSION_ID = "e2e-test-session"

try {
  // Connect Alice
  console.log("Connecting clients...")
  const alice = await connectClient("alice", SESSION_ID)
  await Bun.sleep(200)

  // Connect Bob
  const bob = await connectClient("bob", SESSION_ID)
  await Bun.sleep(500) // Let presence events settle

  // ── 1. Auth ──
  console.log("\n[1] Auth")
  try {
    await waitFor(alice.msgs, (m) => m.type === "auth:ok", "alice auth:ok")
    ok("Alice received auth:ok")
  } catch (e: any) {
    fail("Alice auth:ok", e.message)
  }

  try {
    await waitFor(bob.msgs, (m) => m.type === "auth:ok", "bob auth:ok")
    ok("Bob received auth:ok")
  } catch (e: any) {
    fail("Bob auth:ok", e.message)
  }

  // ── 2. Presence ──
  console.log("\n[2] Presence")
  try {
    await waitFor(bob.msgs, (m) => m.type === "presence:list", "bob presence:list")
    ok("Bob received presence:list")
  } catch (e: any) {
    fail("Bob presence:list", e.message)
  }

  try {
    // Bob should see Alice's join event (since Alice connected first)
    const bobPresenceList = bob.msgs.find((m) => m.type === "presence:list")
    const participants = (bobPresenceList?.payload?.participants as any[]) ?? []
    const aliceInList = participants.some((p: any) => p.id === "alice" || p.name === "alice")
    if (aliceInList) ok("Alice appears in Bob's presence:list")
    else fail("Alice in presence:list", `participants: ${JSON.stringify(participants)}`)
  } catch (e: any) {
    fail("Alice in presence:list", e.message)
  }

  try {
    // Alice should have received Bob's presence:join
    await waitFor(alice.msgs, (m) => m.type === "presence:join", "alice sees bob join")
    ok("Alice received Bob's presence:join")
  } catch (e: any) {
    fail("Alice presence:join for Bob", e.message)
  }

  // Send a prompt (gets buffered for late joiners)
  wsSend(alice.ws, "prompt:sent", SESSION_ID, { content: "fix the auth bug", authorName: "Alice" })
  await Bun.sleep(200)

  // ── 3. Collab messages ──
  console.log("\n[3] Collab messages")
  wsSend(alice.ws, "collab:message", SESSION_ID, { authorName: "Alice", content: "Hello from Alice!" })
  await Bun.sleep(300)

  try {
    await waitFor(
      bob.msgs,
      (m) => m.type === "collab:message" && (m.payload?.content as string) === "Hello from Alice!",
      "bob receives alice message",
    )
    ok("Bob received Alice's collab:message")
  } catch (e: any) {
    fail("Bob receives collab:message", e.message)
  }

  // Verify Alice does NOT receive her own message
  const aliceCollabSelf = alice.msgs.filter(
    (m) => m.type === "collab:message" && (m.payload?.content as string) === "Hello from Alice!",
  )
  if (aliceCollabSelf.length === 0) ok("Alice does NOT receive her own collab:message (excluded)")
  else fail("Alice self-exclusion", `Got ${aliceCollabSelf.length} self-messages`)

  // Bob sends a message back
  wsSend(bob.ws, "collab:message", SESSION_ID, { authorName: "Bob", content: "Hey Alice!" })
  await Bun.sleep(300)

  try {
    await waitFor(
      alice.msgs,
      (m) => m.type === "collab:message" && (m.payload?.content as string) === "Hey Alice!",
      "alice receives bob message",
    )
    ok("Alice received Bob's collab:message")
  } catch (e: any) {
    fail("Alice receives collab:message", e.message)
  }

  // ── 4. Agent output ──
  console.log("\n[4] Agent output relay")
  wsSend(alice.ws, "agent:output", SESSION_ID, { content: "Creating file...", messageId: "msg-1" })
  await Bun.sleep(300)

  try {
    await waitFor(
      bob.msgs,
      (m) => m.type === "agent:output" && (m.payload?.content as string) === "Creating file...",
      "bob receives agent output",
    )
    ok("Bob received agent:output")
  } catch (e: any) {
    fail("Bob receives agent:output", e.message)
  }

  // ── 5. Agent thinking ──
  console.log("\n[5] Agent thinking relay")
  wsSend(alice.ws, "agent:thinking", SESSION_ID, { content: "Let me analyze...", messageId: "msg-1" })
  await Bun.sleep(300)

  try {
    await waitFor(
      bob.msgs,
      (m) => m.type === "agent:thinking" && (m.payload?.content as string) === "Let me analyze...",
      "bob receives agent thinking",
    )
    ok("Bob received agent:thinking")
  } catch (e: any) {
    fail("Bob receives agent:thinking", e.message)
  }

  // ── 6. Agent complete ──
  console.log("\n[6] Agent complete relay")
  wsSend(alice.ws, "agent:complete", SESSION_ID, { messageId: "msg-1" })
  await Bun.sleep(300)

  try {
    await waitFor(
      bob.msgs,
      (m) => m.type === "agent:complete" && (m.payload?.messageId as string) === "msg-1",
      "bob receives agent complete",
    )
    ok("Bob received agent:complete")
  } catch (e: any) {
    fail("Bob receives agent:complete", e.message)
  }

  // ── 7. Late joiner receives history ──
  console.log("\n[7] Late joiner history replay")

  // Charlie joins AFTER all the above events happened
  const charlie = await connectClient("charlie", SESSION_ID)
  await Bun.sleep(500)

  try {
    const historyMsg = await waitFor(
      charlie.msgs,
      (m) => m.type === "session:history",
      "charlie receives session:history",
    )
    ok("Charlie received session:history")

    const events = (historyMsg.payload?.events as any[]) ?? []
    // Should contain: prompt:sent, collab:message (x2), agent:output, agent:thinking, agent:complete
    const types = events.map((e: any) => e.type)

    if (types.includes("collab:message")) ok("History includes collab:message")
    else fail("History collab:message", `types: ${JSON.stringify(types)}`)

    if (types.includes("prompt:sent")) ok("History includes prompt:sent")
    else fail("History prompt:sent", `types: ${JSON.stringify(types)}`)

    if (types.includes("agent:output")) ok("History includes agent:output (aggregated)")
    else fail("History agent:output", `types: ${JSON.stringify(types)}`)

    if (types.includes("agent:thinking")) ok("History includes agent:thinking (aggregated)")
    else fail("History agent:thinking", `types: ${JSON.stringify(types)}`)

    // Verify agent output is pre-aggregated (complete content, not deltas)
    const agentOutput = events.find((e: any) => e.type === "agent:output")
    if (agentOutput?.payload?.complete === true) ok("Agent output is pre-aggregated (complete: true)")
    else fail("Agent output aggregation", `payload: ${JSON.stringify(agentOutput?.payload)}`)

  } catch (e: any) { fail("Charlie history replay", e.message) }

  // ── 8. Driver model: first joiner is driver ──
  console.log("\n[8] Driver model: first joiner is driver")
  try {
    // Alice was first to connect — she should be the driver
    const alicePresenceList = alice.msgs.find(
      (m) => m.type === "presence:list"
    )
    const aliceParticipants = (alicePresenceList?.payload?.participants as any[]) ?? []
    const aliceEntry = aliceParticipants.find((p: any) => p.id === "alice" || p.name === "alice")
    if (aliceEntry?.role === "driver") ok("First joiner (Alice) is driver")
    else fail("First joiner is driver", `Alice role: ${aliceEntry?.role}`)
  } catch (e: any) { fail("Driver detection", e.message) }

  // ── 9. Driver model: prompt:request → prompt:execute ──
  console.log("\n[9] Driver model: prompt:request → prompt:execute")
  try {
    // Bob (non-driver) sends prompt:request
    wsSend(bob.ws, "prompt:request", SESSION_ID, {
      authorId: "bob",
      authorName: "Bob",
      content: "implement auth module",
    })
    await Bun.sleep(300)

    // Alice (driver) should receive prompt:execute
    const executeMsg = await waitFor(
      alice.msgs,
      (m) => m.type === "prompt:execute" && (m.payload?.content as string) === "implement auth module",
      "alice receives prompt:execute",
    )
    ok("Driver received prompt:execute from non-driver")
    if (executeMsg.payload?.requestedBy === "bob") ok("prompt:execute includes requestedBy")
    else fail("requestedBy field", `got: ${executeMsg.payload?.requestedBy}`)

    // Bob should also see prompt:sent (broadcast)
    const sentMsg = await waitFor(
      bob.msgs,
      (m) => m.type === "prompt:sent" && (m.payload?.content as string) === "implement auth module",
      "bob receives prompt:sent echo",
      2000,
    ).catch(() => null)
    // Note: bob is excluded from broadcast of his own prompt:sent, but charlie should see it
  } catch (e: any) { fail("prompt:request flow", e.message) }

  // ── 10. Driver model: driver handoff ──
  console.log("\n[10] Driver model: driver handoff")
  try {
    // Alice (current driver) hands off to Bob
    wsSend(alice.ws, "session:driver_change", SESSION_ID, { newDriverId: "bob" })
    await Bun.sleep(300)

    // Bob should receive session:driver_change
    const changeMsg = await waitFor(
      bob.msgs,
      (m) => m.type === "session:driver_change" && (m.payload?.newDriverId as string) === "bob",
      "bob receives driver_change",
    )
    ok("Non-driver received session:driver_change")

    // Charlie should also receive it
    const charlieChange = await waitFor(
      charlie.msgs,
      (m) => m.type === "session:driver_change" && (m.payload?.newDriverId as string) === "bob",
      "charlie receives driver_change",
    )
    ok("Other collaborators received session:driver_change")
  } catch (e: any) { fail("Driver handoff", e.message) }

  // ── Done ──
  alice.ws.close()
  bob.ws.close()
  charlie.ws.close()
} catch (e: any) {
  console.error(`\n💥 Unexpected error: ${e.message}`)
  failed++
} finally {
  serverProc.kill()
  // Cleanup test DB
  try {
    require("node:fs").unlinkSync(dbPath)
  } catch {}
  try {
    require("node:fs").unlinkSync(dbPath + "-wal")
  } catch {}
  try {
    require("node:fs").unlinkSync(dbPath + "-shm")
  } catch {}
}

// ── Summary ──────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`)
console.log(`  Passed: ${passed}`)
console.log(`  Failed: ${failed}`)
console.log(`${"─".repeat(40)}\n`)

process.exit(failed > 0 ? 1 : 0)
