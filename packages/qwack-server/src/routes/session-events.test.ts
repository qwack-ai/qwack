import { describe, test, expect } from "bun:test"
import { Hono } from "hono"
import { ulid } from "ulid"
import { createSessionEventRoutes } from "./session-events"
import { createSessionParticipantRoutes } from "./session-participants"
import { createTestRepository } from "../db/test-helpers"
import { authMiddleware } from "../auth/middleware"
import { schema } from "../db/index"

type AuthEnv = { Variables: { userId: string } }

function createTestApp(userId: string) {
  const { repo, db, sqlite } = createTestRepository()
  const app = new Hono<AuthEnv>()

  db.insert(schema.users)
    .values({
      id: userId,
      email: `${userId}@test.com`,
      name: userId.charAt(0).toUpperCase() + userId.slice(1),
    })
    .run()

  if (userId !== "bob") {
    db.insert(schema.users)
      .values({
        id: "bob",
        email: "bob@test.com",
        name: "Bob",
      })
      .run()
  }

  // Mock auth middleware
  app.use("*", async (c, next) => {
    c.set("userId", userId)
    await next()
  })

  const eventRoutes = createSessionEventRoutes(repo)
  const participantRoutes = createSessionParticipantRoutes(repo)
  app.route("/", eventRoutes)
  app.route("/", participantRoutes)

  return { app, repo, db, sqlite }
}

function jsonReq(path: string, opts?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  })
}

describe("GET /sessions/:id/events", () => {
  test("returns empty events for session with no events", async () => {
    const { app, db } = createTestApp("alice")
    const sessionId = ulid()

    db.insert(schema.sessions)
      .values({
        id: sessionId,
        title: "Test Session",
        creatorId: "alice",
        status: "active",
      })
      .run()

    db.insert(schema.sessionParticipants)
      .values({
        id: ulid(),
        sessionId,
        userId: "alice",
        role: "host",
      })
      .run()

    const res = await app.request(jsonReq(`/sessions/${sessionId}/events`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([])
  })

  test("returns events ordered by timestamp", async () => {
    const { app, db } = createTestApp("alice")
    const sessionId = ulid()

    db.insert(schema.sessions)
      .values({
        id: sessionId,
        title: "Test Session",
        creatorId: "alice",
        status: "active",
      })
      .run()

    db.insert(schema.sessionParticipants)
      .values({
        id: ulid(),
        sessionId,
        userId: "alice",
        role: "host",
      })
      .run()

    for (let i = 0; i < 3; i++) {
      db.insert(schema.sessionEvents)
        .values({
          id: ulid(),
          sessionId,
          type: "collab:message",
          actorType: "user",
          actorId: "alice",
          payload: JSON.stringify({ content: `msg ${i}` }),
        })
        .run()
    }

    const res = await app.request(jsonReq(`/sessions/${sessionId}/events`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events.length).toBe(3)
    expect(body.events[0].type).toBe("collab:message")
  })

  test("respects limit parameter", async () => {
    const { app, db } = createTestApp("alice")
    const sessionId = ulid()

    db.insert(schema.sessions)
      .values({
        id: sessionId,
        title: "Test Session",
        creatorId: "alice",
        status: "active",
      })
      .run()

    db.insert(schema.sessionParticipants)
      .values({
        id: ulid(),
        sessionId,
        userId: "alice",
        role: "host",
      })
      .run()

    for (let i = 0; i < 5; i++) {
      db.insert(schema.sessionEvents)
        .values({
          id: ulid(),
          sessionId,
          type: "collab:message",
          actorType: "user",
          actorId: "alice",
          payload: JSON.stringify({ content: `msg ${i}` }),
        })
        .run()
    }

    const res = await app.request(jsonReq(`/sessions/${sessionId}/events?limit=2`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events.length).toBe(2)
  })

  test("returns 403 for non-participant", async () => {
    const { app, db } = createTestApp("bob")
    const sessionId = ulid()

    db.insert(schema.users)
      .values({
        id: "alice",
        email: "alice@test.com",
        name: "Alice",
      })
      .run()

    db.insert(schema.sessions)
      .values({
        id: sessionId,
        title: "Test Session",
        creatorId: "alice",
        status: "active",
      })
      .run()

    db.insert(schema.sessionParticipants)
      .values({
        id: ulid(),
        sessionId,
        userId: "alice",
        role: "host",
      })
      .run()

    const res = await app.request(jsonReq(`/sessions/${sessionId}/events`))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Not a participant of this session")
  })

  test("returns 401 without auth", async () => {
    const { db, repo } = createTestApp("alice")
    const sessionId = ulid()

    db.insert(schema.sessions)
      .values({
        id: sessionId,
        title: "Test Session",
        creatorId: "alice",
        status: "active",
      })
      .run()

    db.insert(schema.sessionParticipants)
      .values({
        id: ulid(),
        sessionId,
        userId: "alice",
        role: "host",
      })
      .run()

    const app = new Hono<AuthEnv>()
    app.use("*", authMiddleware)
    const eventRoutes = createSessionEventRoutes(repo)
    app.route("/", eventRoutes)

    const res = await app.request(jsonReq(`/sessions/${sessionId}/events`))
    expect(res.status).toBe(401)
  })
})
