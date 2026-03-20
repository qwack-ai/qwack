import { describe, test, expect } from "bun:test"
import { Hono } from "hono"
import { ulid } from "ulid"
import { createSessionRoutes } from "./sessions"
import { createSessionParticipantRoutes } from "./session-participants"
import { createTestRepository } from "../db/test-helpers"
import { schema } from "../db/index"
import { getSessionConnections, setUserMeta } from "../ws/connection-registry"

type AuthEnv = { Variables: { userId: string } }

function createTestApp() {
  const { repo, db, sqlite } = createTestRepository()
  const app = new Hono<AuthEnv>()

  // Insert a test user
  const testUserId = ulid()
  db.insert(schema.users)
    .values({
      id: testUserId,
      email: "test@qwack.ai",
      name: "Test User",
    })
    .run()

  // Mock auth middleware
  app.use("*", async (c, next) => {
    c.set("userId", testUserId)
    await next()
  })

  const sessionRoutes = createSessionRoutes(repo)
  const participantRoutes = createSessionParticipantRoutes(repo)
  app.route("/", sessionRoutes)
  app.route("/", participantRoutes)

  return { app, repo, db, sqlite, testUserId }
}

function jsonReq(path: string, opts?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  })
}

describe("session routes", () => {
  test("POST /sessions creates session with creator as host", async () => {
    const { app, db, testUserId } = createTestApp()
    const res = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Test Session" }),
      }),
    )
    expect(res.status).toBe(201)
    const session = await res.json()
    expect(session.title).toBe("Test Session")
    expect(session.status).toBe("active")
    expect(session.creatorId).toBe(testUserId)

    // Verify host participant was created
    const participants = db.select().from(schema.sessionParticipants).all()
    expect(participants.length).toBe(1)
    expect(participants[0].role).toBe("host")
    expect(participants[0].userId).toBe(testUserId)
  })

  test("POST /sessions returns 400 without title", async () => {
    const { app } = createTestApp()
    const res = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Title is required")
  })

  test("GET /sessions returns user's sessions with enriched fields", async () => {
    const { app } = createTestApp()

    // Create two sessions
    await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Session 1" }),
      }),
    )
    await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Session 2" }),
      }),
    )

    const res = await app.request("/sessions")
    expect(res.status).toBe(200)
    const sessions = await res.json()
    expect(sessions.length).toBe(2)

    // Verify enriched QwackSessionListItem fields
    const session = sessions[0]
    expect(session).toHaveProperty("id")
    expect(session).toHaveProperty("title")
    expect(session).toHaveProperty("status")
    expect(session).toHaveProperty("creatorId")
    expect(session).toHaveProperty("participantCount")
    expect(session).toHaveProperty("hasActiveHost")
    expect(session).toHaveProperty("createdAt")
    expect(session).toHaveProperty("updatedAt")
    expect(typeof session.participantCount).toBe("number")
    expect(session.participantCount).toBe(1) // creator is the only participant
    expect(typeof session.hasActiveHost).toBe("boolean")
    expect(session.hasActiveHost).toBe(false) // no WS connection = no active host
    expect(typeof session.createdAt).toBe("string")
    expect(typeof session.updatedAt).toBe("string")
  })

  test("GET /sessions returns empty array for user with no sessions", async () => {
    const { repo, db } = createTestApp()
    // Create a fresh app with a different user who has no sessions
    const otherApp = new Hono<AuthEnv>()
    const otherUserId = ulid()
    db.insert(schema.users).values({ id: otherUserId, email: "other@qwack.ai", name: "Other" }).run()
    otherApp.use("*", async (c, next) => {
      c.set("userId", otherUserId)
      await next()
    })
    otherApp.route("/", createSessionRoutes(repo))

    const res = await otherApp.request("/sessions")
    expect(res.status).toBe(200)
    const sessions = await res.json()
    expect(sessions).toEqual([])
  })

  test("GET /sessions/:id returns session for participant", async () => {
    const { app } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "My Session" }),
      }),
    )
    const created = await createRes.json()

    const res = await app.request(`/sessions/${created.id}`)
    expect(res.status).toBe(200)
    const session = await res.json()
    expect(session.id).toBe(created.id)
    expect(session.title).toBe("My Session")
  })

  test("GET /sessions/:id returns 403 for non-participant", async () => {
    const { app, repo, db } = createTestApp()

    // Create session
    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Private Session" }),
      }),
    )
    const created = await createRes.json()

    // Create a different user app
    const otherApp = new Hono<AuthEnv>()
    const otherUserId = ulid()
    db.insert(schema.users).values({ id: otherUserId, email: "stranger@qwack.ai", name: "Stranger" }).run()
    otherApp.use("*", async (c, next) => {
      c.set("userId", otherUserId)
      await next()
    })
    otherApp.route("/", createSessionRoutes(repo))

    const res = await otherApp.request(`/sessions/${created.id}`)
    expect(res.status).toBe(403)
  })

  test("PATCH /sessions/:id updates status", async () => {
    const { app } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Update Me" }),
      }),
    )
    const created = await createRes.json()

    const res = await app.request(
      jsonReq(`/sessions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "paused" }),
      }),
    )
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(updated.status).toBe("paused")
  })

  test("PATCH /sessions/:id returns 404 for missing session", async () => {
    const { app } = createTestApp()
    const res = await app.request(
      jsonReq("/sessions/nonexistent", {
        method: "PATCH",
        body: JSON.stringify({ status: "paused" }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

describe("session participant routes", () => {
  test("POST /sessions/:id/join adds collaborator", async () => {
    const { app, repo, db } = createTestApp()

    // Create session as test user
    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Join Me" }),
      }),
    )
    const created = await createRes.json()

    // Simulate host connected via WebSocket (required for new joins)
    const mockWs = { send: () => {}, close: () => {} } as any
    getSessionConnections(created.id).set("test-user", [mockWs])
    setUserMeta(created.id, "test-user", { id: "test-user", name: "Test", role: "host" })
    // Create second user and app
    const joinerApp = new Hono<AuthEnv>()
    const joinerId = ulid()
    db.insert(schema.users).values({ id: joinerId, email: "joiner@qwack.ai", name: "Joiner" }).run()
    joinerApp.use("*", async (c, next) => {
      c.set("userId", joinerId)
      await next()
    })
    joinerApp.route("/", createSessionParticipantRoutes(repo))

    const res = await joinerApp.request(jsonReq(`/sessions/${created.id}/join`, { method: "POST" }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test("POST /sessions/:id/join returns 409 if already participant", async () => {
    const { app } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Double Join" }),
      }),
    )
    const created = await createRes.json()

    // Try to join own session (already a participant as host)
    const res = await app.request(jsonReq(`/sessions/${created.id}/join`, { method: "POST" }))
    expect(res.status).toBe(409)
  })

  test("POST /sessions/:id/join returns 404 for missing session", async () => {
    const { app } = createTestApp()
    const res = await app.request(jsonReq("/sessions/nonexistent/join", { method: "POST" }))
    expect(res.status).toBe(404)
  })

  test("GET /sessions/:id/participants returns list", async () => {
    const { app } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Participants" }),
      }),
    )
    const created = await createRes.json()

    const res = await app.request(`/sessions/${created.id}/participants`)
    expect(res.status).toBe(200)
    const participants = await res.json()
    expect(participants.length).toBe(1)
    expect(participants[0].role).toBe("host")
  })

  test("GET /sessions/:id/participants returns 403 for non-participant", async () => {
    const { app, repo, db } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "No Peeking" }),
      }),
    )
    const created = await createRes.json()

    // Create outsider
    const outsiderApp = new Hono<AuthEnv>()
    const outsiderId = ulid()
    db.insert(schema.users).values({ id: outsiderId, email: "outsider@qwack.ai", name: "Outsider" }).run()
    outsiderApp.use("*", async (c, next) => {
      c.set("userId", outsiderId)
      await next()
    })
    outsiderApp.route("/", createSessionParticipantRoutes(repo))

    const res = await outsiderApp.request(`/sessions/${created.id}/participants`)
    expect(res.status).toBe(403)
  })

  test("POST /sessions/:id/join blocks new users when session is inactive", async () => {
    const { app, repo, db } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Inactive Session" }),
      }),
    )
    const created = await createRes.json()

    // Session has 1 participant (creator) but nobody connected via WS
    const outsiderApp = new Hono<AuthEnv>()
    const outsiderId = ulid()
    db.insert(schema.users).values({ id: outsiderId, email: "outsider2@qwack.ai", name: "Outsider2" }).run()
    outsiderApp.use("*", async (c, next) => {
      c.set("userId", outsiderId)
      await next()
    })
    outsiderApp.route("/", createSessionParticipantRoutes(repo))

    // No WS connections = inactive. New user should be blocked.
    const res = await outsiderApp.request(jsonReq(`/sessions/${created.id}/join`, { method: "POST" }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain("inactive")
  })

  test("POST /sessions/:id/join allows new users when host is connected", async () => {
    const { app, repo, db } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Active Session" }),
      }),
    )
    const created = await createRes.json()

    // Simulate host connected
    const mockWs = { send: () => {}, close: () => {} } as any
    getSessionConnections(created.id).set("test-user", [mockWs])
    setUserMeta(created.id, "test-user", { id: "test-user", name: "Test", role: "host" })

    const joinerApp = new Hono<AuthEnv>()
    const joinerId = ulid()
    db.insert(schema.users).values({ id: joinerId, email: "joiner2@qwack.ai", name: "Joiner2" }).run()
    joinerApp.use("*", async (c, next) => {
      c.set("userId", joinerId)
      await next()
    })
    joinerApp.route("/", createSessionParticipantRoutes(repo))

    const res = await joinerApp.request(jsonReq(`/sessions/${created.id}/join`, { method: "POST" }))
    expect(res.status).toBe(201)
  })

  test("POST /sessions/:id/kick/:userId removes participant", async () => {
    const { app, repo, db } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Kick Test" }),
      }),
    )
    const created = await createRes.json()

    // Simulate host connected
    const hostId = "test-user"
    const mockHostWs = { send: () => {}, close: () => {} } as any
    getSessionConnections(created.id).set(hostId, [mockHostWs])
    setUserMeta(created.id, hostId, { id: hostId, name: "Host", role: "host" })

    // Add a collaborator
    const collabId = ulid()
    db.insert(schema.users).values({ id: collabId, email: "collab@qwack.ai", name: "Collab" }).run()
    await repo.addParticipant(created.id, collabId, "collaborator")
    const mockCollabWs = { send: () => {}, close: () => {} } as any
    getSessionConnections(created.id).set(collabId, [mockCollabWs])

    // Host kicks collab
    const kickApp = new Hono<AuthEnv>()
    kickApp.use("*", async (c, next) => { c.set("userId", hostId); await next() })
    kickApp.route("/", createSessionParticipantRoutes(repo))

    const res = await kickApp.request(jsonReq(`/sessions/${created.id}/kick/${collabId}`, { method: "POST" }))
    expect(res.status).toBe(200)
  })

  test("POST /sessions/:id/kick/:userId rejects non-host", async () => {
    const { app, repo, db } = createTestApp()

    const createRes = await app.request(
      jsonReq("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Kick Auth Test" }),
      }),
    )
    const created = await createRes.json()

    // Simulate host connected
    const hostId = "test-user"
    const mockWs = { send: () => {}, close: () => {} } as any
    getSessionConnections(created.id).set(hostId, [mockWs])
    setUserMeta(created.id, hostId, { id: hostId, name: "Host", role: "host" })

    // Non-host tries to kick
    const collabId = ulid()
    db.insert(schema.users).values({ id: collabId, email: "collab2@qwack.ai", name: "Collab2" }).run()
    await repo.addParticipant(created.id, collabId, "collaborator")

    const collabApp = new Hono<AuthEnv>()
    collabApp.use("*", async (c, next) => { c.set("userId", collabId); await next() })
    collabApp.route("/", createSessionParticipantRoutes(repo))

    const res = await collabApp.request(jsonReq(`/sessions/${created.id}/kick/${hostId}`, { method: "POST" }))
    expect(res.status).toBe(403)
  })
})
