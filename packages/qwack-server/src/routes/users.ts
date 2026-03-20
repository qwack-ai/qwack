import { Hono } from "hono"
import type { IRepository } from "../repo/types"

type AuthEnv = { Variables: { userId: string } }

export function createUserRoutes(repo: IRepository) {
  const users = new Hono<AuthEnv>()

  users.get("/users/me", async (c) => {
    const userId = c.get("userId")
    const user = await repo.getUserById(userId)

    if (!user) {
      return c.json({ error: "User not found" }, 404)
    }

    // Strip password hash from response
    const { passwordHash, ...safeUser } = user
    return c.json(safeUser)
  })

  users.patch("/users/me", async (c) => {
    const userId = c.get("userId")
    const body = (await c.req.json()) as {
      name?: string
      avatarUrl?: string
    }

    const updates: Record<string, unknown> = {}
    if (body.name) updates.name = body.name
    if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400)
    }

    await repo.updateUser(userId, updates as { name?: string; avatarUrl?: string })

    const user = await repo.getUserById(userId)
    if (!user) {
      return c.json({ error: "User not found" }, 404)
    }

    const { passwordHash, ...safeUser } = user
    return c.json(safeUser)
  })

  return users
}
