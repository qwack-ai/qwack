import { Hono } from "hono"
import type { IRepository } from "../repo/types"
import { getHostUserId, getSessionConnections, hasActiveConnections, broadcastToSession } from "../ws/connection-registry"

type AuthEnv = { Variables: { userId: string } }

export function createSessionParticipantRoutes(repo: IRepository) {
  const routes = new Hono<AuthEnv>()

  routes.post("/sessions/:id/join", async (c) => {
    const userId = c.get("userId")
    const sessionId = c.req.param("id")

    const session = await repo.getSessionById(sessionId)
    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    const existing = await repo.isParticipant(sessionId, userId)
    if (existing) {
      return c.json({ error: "Already a participant" }, 409)
    }

    if (!hasActiveConnections(sessionId)) {
      const participantCount = await repo.getParticipantCount(sessionId)
      if (participantCount > 0) {
        return c.json({ error: "Session is inactive \u2014 only existing participants can rejoin" }, 403)
      }
    }

    await repo.addParticipant(sessionId, userId, "collaborator")

    return c.json({ ok: true, sessionId }, 201)
  })

  routes.post("/sessions/:id/kick/:userId", async (c) => {
    const requesterId = c.get("userId")
    const sessionId = c.req.param("id")
    const targetUserId = c.req.param("userId")

    // Only the host can kick
    const hostId = getHostUserId(sessionId)
    if (!hostId || hostId !== requesterId) {
      return c.json({ error: "Only the host can kick participants" }, 403)
    }

    if (targetUserId === requesterId) {
      return c.json({ error: "Cannot kick yourself" }, 400)
    }

    const isTarget = await repo.isParticipant(sessionId, targetUserId)
    if (!isTarget) {
      return c.json({ error: "User is not a participant" }, 404)
    }

    // Close their WebSocket connections
    const conns = getSessionConnections(sessionId)
    const targetConns = conns.get(targetUserId)
    if (targetConns) {
      for (const ws of targetConns) {
        try {
          ws.send(JSON.stringify({
            type: "session:kicked",
            payload: { reason: "Removed by host" },
          }))
          ws.close(4003, "Kicked by host")
        } catch {}
      }
      conns.delete(targetUserId)
    }

    // Broadcast to remaining participants
    broadcastToSession(sessionId, {
      type: "presence:leave",
      payload: { userId: targetUserId, reason: "kicked" },
    })

    return c.json({ ok: true })
  })

  routes.get("/sessions/:id/participants", async (c) => {
    const userId = c.get("userId")
    const sessionId = c.req.param("id")

    const isSelf = await repo.isParticipant(sessionId, userId)
    if (!isSelf) {
      return c.json({ error: "Not a participant" }, 403)
    }

    const participants = await repo.getParticipants(sessionId)

    return c.json(participants)
  })

  return routes
}
