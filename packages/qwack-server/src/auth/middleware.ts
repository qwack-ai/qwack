import { createMiddleware } from "hono/factory"
import type { Context, Next } from "hono"
import { createClient } from "@openauthjs/openauth/client"
import type { IRepository } from "../repo/types"
import { subjects } from "./openauth"
import { config } from "../config"

export type AuthVariables = {
  userId: string
}

function isDev(): boolean {
  return process.env.QWACK_DEV === "true"
}

let _client: ReturnType<typeof createClient> | null = null
function getAuthClient() {
  if (!_client) {
    _client = createClient({
      clientID: "qwack-server",
      issuer: config.openAuthIssuerUrl,
    })
  }
  return _client
}

/**
 * Auto-create a user record if one doesn't exist (dev stub).
 * Idempotent — safe to call on every request.
 */
export async function ensureDevUser(repo: IRepository, userId: string, name?: string): Promise<void> {
  const existing = await repo.getUserById(userId)
  if (existing) return
  try {
    await repo.createUser({
      id: userId,
      email: `${userId}@qwack.dev`,
      name: name || userId,
    })
  } catch {
    // Race condition or constraint violation — another request created it first
  }
}

export function createAuthMiddleware(repo: IRepository) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization")

    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401)
    }

    const token = authHeader.slice(7)
    if (!token) {
      return c.json({ error: "Unauthorized", message: "Empty token" }, 401)
    }

    if (isDev()) {
      await ensureDevUser(repo, token)
      c.set("userId", token)
    } else {
      const userId = await verifyToken(token)
      if (!userId) {
        return c.json({ error: "Unauthorized", message: "Invalid token" }, 401)
      }
      c.set("userId", userId)
    }

    await next()
  })
}

/** @deprecated Use createAuthMiddleware(repo) instead. Kept for tests that don't need DB. */
export const authMiddleware = createMiddleware<{
  Variables: AuthVariables
}>(async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401)
  }
  const token = authHeader.slice(7)
  if (!token) {
    return c.json({ error: "Unauthorized", message: "Empty token" }, 401)
  }
  c.set("userId", token)
  await next()
})

export async function verifyToken(token: string): Promise<string | null> {
  if (!token) return null

  if (isDev()) return token

  try {
    const client = getAuthClient()
    const verified = await client.verify(subjects, token)
    if (verified.err) return null
    return verified.subject.properties.id
  } catch {
    return null
  }
}
