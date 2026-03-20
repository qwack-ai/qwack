import { Hono } from "hono"
import { ulid } from "ulid"
import type { IRepository } from "../repo/types"
import { getHostUserId } from "../ws/handler"
import { generateShortCode } from "./short-code"
import { rateLimit } from "./rate-limit"

const MAX_SESSION_TITLE_LENGTH = 200

type AuthEnv = { Variables: { userId: string } }

export function createSessionRoutes(repo: IRepository) {
  const sessions = new Hono<AuthEnv>()

  sessions.post("/sessions", async (c) => {
    const userId = c.get("userId")
    const body = await c.req.json()
    const { title, id } = body as { title: string; id?: string }

    if (!title || typeof title !== "string") {
      return c.json({ error: "Title is required" }, 400)
    }

    if (title.length > MAX_SESSION_TITLE_LENGTH) {
      return c.json({ error: `Title must be ${MAX_SESSION_TITLE_LENGTH} characters or fewer` }, 400)
    }

    const sessionId = id || ulid()

    // If client provided an ID, check if session already exists
    if (id) {
      const existing = await repo.getSessionById(id)
      if (existing) {
        return c.json(existing, 200)
      }
    }

    const shortCode = await generateShortCode(repo)

    await repo.createSession({
      id: sessionId,
      title,
      creatorId: userId,
      shortCode,
    })

    // Add creator as host
    await repo.addParticipant(sessionId, userId, "host")

    const session = await repo.getSessionById(sessionId)

    return c.json(session, 201)
  })

  sessions.get("/sessions", async (c) => {
    const userId = c.get("userId")

    const sessionList = await repo.getSessionsByUser(userId)
    if (sessionList.length === 0) {
      return c.json([])
    }

    const results = []
    for (const s of sessionList) {
      const full = await repo.getSessionById(s.id)
      if (!full) continue

      const hostUserId = getHostUserId(s.id)

      results.push({
        id: s.id,
        title: s.title,
        status: s.status,
        shortCode: s.shortCode,
        creatorId: s.creatorId,
        participantCount: s.participantCount,
        hasActiveHost: hostUserId !== null,
        createdAt: new Date(full.createdAt * 1000).toISOString(),
        updatedAt: new Date(full.updatedAt * 1000).toISOString(),
      })
    }

    return c.json(results)
  })

  sessions.get("/sessions/code/:code", rateLimit({ windowMs: 60_000, max: 20 }), async (c) => {
    const code = c.req.param("code").toUpperCase()
    const result = await repo.getSessionByShortCode(code)

    if (!result) {
      return c.json({ error: "Session not found" }, 404)
    }

    return c.json({ id: result.id, title: result.title, shortCode: result.shortCode })
  })

  sessions.get("/sessions/:id", async (c) => {
    const userId = c.get("userId")
    const sessionId = c.req.param("id")

    const isParticipant = await repo.isParticipant(sessionId, userId)
    if (!isParticipant) {
      return c.json({ error: "Not a participant of this session" }, 403)
    }

    const session = await repo.getSessionById(sessionId)
    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    return c.json(session)
  })

  sessions.patch("/sessions/:id", async (c) => {
    const userId = c.get("userId")
    const sessionId = c.req.param("id")
    const body = (await c.req.json()) as { status?: "active" | "paused" | "completed" }

    const session = await repo.getSessionById(sessionId)
    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    if (session.creatorId !== userId) {
      const participants = await repo.getParticipants(sessionId)
      const hostParticipant = participants.find((p) => p.userId === userId && p.role === "host")

      if (!hostParticipant) {
        return c.json({ error: "Only the host or creator can update session" }, 403)
      }
    }

    if (body.status) {
      await repo.updateSession(sessionId, { status: body.status })
    }

    const updated = await repo.getSessionById(sessionId)

    return c.json(updated)
  })

  sessions.delete("/sessions/:id", async (c) => {
    const userId = c.get("userId")
    const sessionId = c.req.param("id")

    const session = await repo.getSessionById(sessionId)
    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    if (session.creatorId !== userId) {
      return c.json({ error: "Only the creator can delete a session" }, 403)
    }

    await repo.deleteSession(sessionId)

    return c.json({ ok: true }, 200)
  })

  return sessions
}
