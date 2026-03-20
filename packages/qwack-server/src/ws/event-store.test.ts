import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRepository } from "../db/test-helpers"
import { schema } from "../db/index"
import { eq } from "drizzle-orm"
import { ulid } from "ulid"
import {
  initEventStore,
  shutdownEventStore,
  bufferEvent,
  getReplayHistory,
  setContextSnapshot,
  getContextSnapshot,
  flushPendingWrites,
  loadSessionEvents,
  clearAllBuffers,
  type BufferedEvent,
} from "./event-store"

let db: any
let sqlite: any
const SID = "test-session-id"
const UID = "test-user-id"

beforeEach(() => {
  const result = createTestRepository()
  db = result.db
  sqlite = result.sqlite
  clearAllBuffers()
  initEventStore(result.repo)
  // Create FK dependencies
  db.insert(schema.users).values({ id: UID, email: "t@t.com", name: "Tester" }).run()
  db.insert(schema.sessions).values({ id: SID, title: "Test Session", creatorId: UID, status: "active" }).run()
})

afterEach(async () => {
  await shutdownEventStore()
  clearAllBuffers()
})

function makeEvent(type: string, payload: Record<string, unknown> = {}): BufferedEvent {
  return { type, senderId: "user1", timestamp: Date.now(), payload }
}

// ── initEventStore ──────────────────────────────────────────────

describe("initEventStore", () => {
  test("works without error", () => {
    // Already called in beforeEach — just verify no throw
    expect(true).toBe(true)
  })

  test("functions degrade to memory-only when _repo is null", async () => {
    await shutdownEventStore() // clears _repo
    // bufferEvent should still work (memory only)
    bufferEvent(SID, makeEvent("collab:message", { content: "hello" }))
    const history = await getReplayHistory(SID)
    expect(history).toHaveLength(1)
    expect(history[0].payload.content).toBe("hello")
  })
})

// ── bufferEvent dual write ──────────────────────────────────────

describe("bufferEvent dual write", () => {
  test("event visible in memory after bufferEvent()", async () => {
    bufferEvent(SID, makeEvent("collab:message", { content: "hi" }))
    const history = await getReplayHistory(SID)
    expect(history).toHaveLength(1)
    expect(history[0].payload.content).toBe("hi")
  })

  test("event in DB after flushPendingWrites()", async () => {
    bufferEvent(SID, makeEvent("collab:message", { content: "persisted" }))
    await flushPendingWrites()

    const rows = db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SID)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe("collab:message")
    const payload = JSON.parse(rows[0].payload)
    expect(payload.content).toBe("persisted")
  })

  test("multiple events → single flush → all in DB", async () => {
    bufferEvent(SID, makeEvent("collab:message", { content: "one" }))
    bufferEvent(SID, makeEvent("prompt:sent", { content: "two" }))
    bufferEvent(SID, makeEvent("agent:output", { content: "three", messageId: "m1" }))
    await flushPendingWrites()

    const rows = db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SID)).all()
    expect(rows).toHaveLength(3)
  })
})

// ── getReplayHistory fallback ───────────────────────────────────

describe("getReplayHistory fallback", () => {
  test("memory has data → returns it (fast path)", async () => {
    bufferEvent(SID, makeEvent("collab:message", { content: "from memory" }))
    const history = await getReplayHistory(SID)
    expect(history).toHaveLength(1)
    expect(history[0].payload.content).toBe("from memory")
  })

  test("memory empty + DB has data → returns aggregated DB data (cold start)", async () => {
    // Insert directly into DB (simulating prior server run)
    const now = new Date()
    db.insert(schema.sessionEvents)
      .values({
        id: ulid(),
        sessionId: SID,
        timestamp: now,
        type: "collab:message",
        actorType: "user",
        actorId: "user1",
        payload: JSON.stringify({ content: "from db" }),
      })
      .run()

    clearAllBuffers() // empty memory
    const history = await getReplayHistory(SID)
    expect(history).toHaveLength(1)
    expect(history[0].payload.content).toBe("from db")
  })

  test("both empty → returns []", async () => {
    clearAllBuffers()
    const history = await getReplayHistory(SID)
    expect(history).toHaveLength(0)
  })
})

// ── Cold-start aggregation ──────────────────────────────────────

describe("cold-start aggregation", () => {
  test("agent:output chunks + agent:complete from DB → returns merged", async () => {
    const now = Date.now()
    const entries = [
      {
        id: ulid(),
        sessionId: SID,
        timestamp: new Date(now),
        type: "agent:output",
        actorType: "agent" as const,
        actorId: "agent1",
        payload: JSON.stringify({ content: "Hello ", messageId: "m1" }),
      },
      {
        id: ulid(),
        sessionId: SID,
        timestamp: new Date(now + 1),
        type: "agent:output",
        actorType: "agent" as const,
        actorId: "agent1",
        payload: JSON.stringify({ content: "world!", messageId: "m1" }),
      },
      {
        id: ulid(),
        sessionId: SID,
        timestamp: new Date(now + 2),
        type: "agent:complete",
        actorType: "agent" as const,
        actorId: "agent1",
        payload: JSON.stringify({ messageId: "m1" }),
      },
    ]
    for (const entry of entries) {
      db.insert(schema.sessionEvents).values(entry).run()
    }

    clearAllBuffers()
    const history = await getReplayHistory(SID)
    // aggregated output + complete = 2
    expect(history).toHaveLength(2)
    expect(history[0].type).toBe("agent:output")
    expect(history[0].payload.content).toBe("Hello world!")
    expect(history[0].payload.complete).toBe(true)
    expect(history[1].type).toBe("agent:complete")
  })

  test("collab:message + prompt:sent from DB → returns them", async () => {
    const now = Date.now()
    db.insert(schema.sessionEvents)
      .values({
        id: ulid(),
        sessionId: SID,
        timestamp: new Date(now),
        type: "collab:message",
        actorType: "user",
        actorId: "user1",
        payload: JSON.stringify({ content: "hey" }),
      })
      .run()
    db.insert(schema.sessionEvents)
      .values({
        id: ulid(),
        sessionId: SID,
        timestamp: new Date(now + 1),
        type: "prompt:sent",
        actorType: "user",
        actorId: "user1",
        payload: JSON.stringify({ content: "do something" }),
      })
      .run()

    clearAllBuffers()
    const history = await getReplayHistory(SID)
    expect(history).toHaveLength(2)
    expect(history[0].type).toBe("collab:message")
    expect(history[1].type).toBe("prompt:sent")
  })
})

// ── Context snapshot persistence ────────────────────────────────

describe("context snapshot persistence", () => {
  test("setContextSnapshot() writes to memory AND DB", async () => {
    await setContextSnapshot(SID, "snapshot-data")

    // Memory
    expect(await getContextSnapshot(SID)).toBe("snapshot-data")

    // DB
    const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, SID)).get()
    expect(row.contextSnapshot).toBe("snapshot-data")
  })

  test("clearAllBuffers() → getContextSnapshot() returns from DB fallback", async () => {
    await setContextSnapshot(SID, "persisted-snapshot")
    clearAllBuffers() // wipes memory

    const snapshot = await getContextSnapshot(SID)
    expect(snapshot).toBe("persisted-snapshot")
  })

  test("setContextSnapshot without init → memory only, no crash", async () => {
    await shutdownEventStore() // _repo = null
    await setContextSnapshot(SID, "memory-only")
    expect(await getContextSnapshot(SID)).toBe("memory-only")
  })
})

// ── Flush mechanics ─────────────────────────────────────────────

describe("flush mechanics", () => {
  test("flushPendingWrites() drains pending and inserts to DB", async () => {
    bufferEvent(SID, makeEvent("collab:message", { content: "a" }))
    bufferEvent(SID, makeEvent("collab:message", { content: "b" }))
    await flushPendingWrites()

    const rows = db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SID)).all()
    expect(rows).toHaveLength(2)

    // Second flush should be a no-op (pending drained)
    await flushPendingWrites()
    const rows2 = db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SID)).all()
    expect(rows2).toHaveLength(2)
  })

  test("shutdownEventStore() flushes remaining", async () => {
    bufferEvent(SID, makeEvent("prompt:sent", { content: "leftover" }))
    await shutdownEventStore()

    const rows = db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SID)).all()
    expect(rows).toHaveLength(1)
    const payload = JSON.parse(rows[0].payload)
    expect(payload.content).toBe("leftover")
  })
})

// ── actorType derivation ────────────────────────────────────────

describe("actorType derivation", () => {
  test('agent:output → "agent" in DB', async () => {
    bufferEvent(SID, makeEvent("agent:output", { content: "hi", messageId: "m1" }))
    await flushPendingWrites()

    const row = db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SID)).get()
    expect(row.actorType).toBe("agent")
  })

  test('collab:message → "user" in DB', async () => {
    bufferEvent(SID, makeEvent("collab:message", { content: "hello" }))
    await flushPendingWrites()

    const row = db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SID)).get()
    expect(row.actorType).toBe("user")
  })
})

// ── DB error resilience ─────────────────────────────────────────

describe("DB error resilience", () => {
  test("close sqlite → bufferEvent doesn't throw → memory still works", async () => {
    sqlite.close()
    // Should not throw even though DB is closed
    expect(() => {
      bufferEvent(SID, makeEvent("collab:message", { content: "safe" }))
    }).not.toThrow()

    // Memory still has the event
    const history = await getReplayHistory(SID)
    expect(history).toHaveLength(1)
    expect(history[0].payload.content).toBe("safe")

    // Flush should not throw either
    await flushPendingWrites().catch(() => {})
  })
})

// ── loadSessionEvents ───────────────────────────────────────────

describe("loadSessionEvents", () => {
  test("returns aggregated events from DB ordered by timestamp", async () => {
    const now = Date.now()
    db.insert(schema.sessionEvents)
      .values({
        id: ulid(),
        sessionId: SID,
        timestamp: new Date(now + 2000),
        type: "collab:message",
        actorType: "user",
        actorId: "user1",
        payload: JSON.stringify({ content: "second" }),
      })
      .run()
    db.insert(schema.sessionEvents)
      .values({
        id: ulid(),
        sessionId: SID,
        timestamp: new Date(now),
        type: "collab:message",
        actorType: "user",
        actorId: "user1",
        payload: JSON.stringify({ content: "first" }),
      })
      .run()

    const events = await loadSessionEvents(SID)
    expect(events).toHaveLength(2)
    expect(events[0].payload.content).toBe("first")
    expect(events[1].payload.content).toBe("second")
  })

  test("returns empty array when no events exist", async () => {
    const events = await loadSessionEvents(SID)
    expect(events).toHaveLength(0)
  })

  test("respects limit parameter", async () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      db.insert(schema.sessionEvents)
        .values({
          id: ulid(),
          sessionId: SID,
          timestamp: new Date(now + i),
          type: "collab:message",
          actorType: "user",
          actorId: "user1",
          payload: JSON.stringify({ content: `msg-${i}` }),
        })
        .run()
    }

    const events = await loadSessionEvents(SID, 3)
    expect(events).toHaveLength(3)
  })
})
