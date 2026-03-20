import { Hono } from "hono"
import type { IRepository } from "../repo/types"

type AuthEnv = { Variables: { userId: string } }

export function createSessionEventRoutes(repo: IRepository) {
  const routes = new Hono<AuthEnv>()

  routes.get("/sessions/:id/events", async (c) => {
    const userId = c.get("userId")
    const sessionId = c.req.param("id")
    const limitParam = c.req.query("limit")
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 500

    // Verify user is a participant
    const isParticipant = await repo.isParticipant(sessionId, userId)
    if (!isParticipant) {
      return c.json({ error: "Not a participant of this session" }, 403)
    }

    const events = await repo.getEvents(sessionId, limit)

    return c.json({ events })
  })

  return routes
}
