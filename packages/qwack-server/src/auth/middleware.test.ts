import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { authMiddleware, createAuthMiddleware, ensureDevUser, verifyToken, type AuthVariables } from "./middleware"
import { createTestRepository } from "../db/test-helpers"
import { schema } from "../db/index"

// Existing tests assume dev mode (token = userId)
process.env.QWACK_DEV = "true"

function createTestApp() {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.use("/protected/*", authMiddleware)

  app.get("/protected/resource", (c) => {
    const userId = c.get("userId")
    return c.json({ userId })
  })

  app.get("/public", (c) => c.json({ ok: true }))

  return app
}

describe("authMiddleware", () => {
  const app = createTestApp()

  test("returns 401 without Authorization header", async () => {
    const res = await app.request("/protected/resource")
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
    expect(body.message).toContain("Missing")
  })

  test("returns 401 with non-Bearer scheme", async () => {
    const res = await app.request("/protected/resource", {
      headers: { Authorization: "Basic abc123" },
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  test("returns 401 with empty Bearer token", async () => {
    const res = await app.request("/protected/resource", {
      headers: { Authorization: "Bearer " },
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  test("passes through with valid Bearer token and sets userId", async () => {
    const res = await app.request("/protected/resource", {
      headers: { Authorization: "Bearer user-42" },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe("user-42")
  })

  test("does not affect unprotected routes", async () => {
    const res = await app.request("/public")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

describe("verifyToken", () => {
  test("returns null for empty token", async () => {
    expect(await verifyToken("")).toBeNull()
  })

  test("returns userId for non-empty token", async () => {
    expect(await verifyToken("user-42")).toBe("user-42")
  })

  test("dev mode: WS auth accepts any token as userId", async () => {
    const result = await verifyToken("random-test-user")
    expect(result).toBe("random-test-user")
  })
})

describe("ensureDevUser", () => {
  test("creates a new user record from token", async () => {
    const { repo, db } = createTestRepository()
    await ensureDevUser(repo, "newguy", "New Guy")

    const user = db.select().from(schema.users).where(eq(schema.users.id, "newguy")).get()
    expect(user).toBeDefined()
    expect(user!.name).toBe("New Guy")
    expect(user!.email).toBe("newguy@qwack.dev")
  })

  test("uses token as name when no name provided", async () => {
    const { repo, db } = createTestRepository()
    await ensureDevUser(repo, "anon")

    const user = db.select().from(schema.users).where(eq(schema.users.id, "anon")).get()
    expect(user).toBeDefined()
    expect(user!.name).toBe("anon")
  })

  test("is idempotent — does not fail on duplicate", async () => {
    const { repo, db } = createTestRepository()
    await ensureDevUser(repo, "repeat", "First")
    await ensureDevUser(repo, "repeat", "Second")

    const user = db.select().from(schema.users).where(eq(schema.users.id, "repeat")).get()
    expect(user).toBeDefined()
    expect(user!.name).toBe("First") // original preserved
  })
})

describe("createAuthMiddleware", () => {
  test("auto-creates user and sets userId on request", async () => {
    const { repo, db } = createTestRepository()
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use("/api/*", createAuthMiddleware(repo))
    app.get("/api/me", (c) => c.json({ userId: c.get("userId") }))

    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer brandnewuser" },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { userId: string }
    expect(body.userId).toBe("brandnewuser")

    // User should now exist in DB
    const user = db.select().from(schema.users).where(eq(schema.users.id, "brandnewuser")).get()
    expect(user).toBeDefined()
    expect(user!.name).toBe("brandnewuser")
  })
})

describe("verifyToken (production mode)", () => {
  beforeAll(() => {
    delete process.env.QWACK_DEV
  })
  afterAll(() => {
    process.env.QWACK_DEV = "true"
  })

  test("returns null for empty token", async () => {
    expect(await verifyToken("")).toBeNull()
  })

  test("returns null for invalid JWT (no issuer running)", async () => {
    expect(await verifyToken("not-a-real-jwt")).toBeNull()
  })
})

describe("createAuthMiddleware (production mode)", () => {
  beforeAll(() => {
    delete process.env.QWACK_DEV
  })
  afterAll(() => {
    process.env.QWACK_DEV = "true"
  })

  test("returns 401 for invalid token", async () => {
    const { repo } = createTestRepository()
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use("/api/*", createAuthMiddleware(repo))
    app.get("/api/me", (c) => c.json({ userId: c.get("userId") }))

    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer fake-token" },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("Unauthorized")
  })

  test("returns 401 without Authorization header", async () => {
    const { repo } = createTestRepository()
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use("/api/*", createAuthMiddleware(repo))
    app.get("/api/me", (c) => c.json({ userId: c.get("userId") }))

    const res = await app.request("/api/me")
    expect(res.status).toBe(401)
  })
})
