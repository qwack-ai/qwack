import { describe, test, expect } from "bun:test"
import { Hono } from "hono"
import { ulid } from "ulid"
import { createUserRoutes } from "./users"
import { createTestRepository } from "../db/test-helpers"
import { createTestDatabase } from "../db/test-helpers"
import { schema } from "../db/index"
import { SqliteRepository } from "../repo/sqlite"

type AuthEnv = { Variables: { userId: string } }

function createTestApp() {
  const { repo, db, sqlite } = createTestRepository()
  const app = new Hono<AuthEnv>()

  const testUserId = ulid()
  db.insert(schema.users)
    .values({
      id: testUserId,
      email: "test@qwack.ai",
      name: "Test User",
      avatarUrl: "https://example.com/avatar.png",
    })
    .run()

  app.use("*", async (c, next) => {
    c.set("userId", testUserId)
    await next()
  })

  app.route("/", createUserRoutes(repo))

  return { app, repo, db, sqlite, testUserId }
}

describe("user routes", () => {
  test("GET /users/me returns current user without password hash", async () => {
    const { app, testUserId } = createTestApp()
    const res = await app.request("/users/me")
    expect(res.status).toBe(200)
    const user = await res.json()
    expect(user.id).toBe(testUserId)
    expect(user.name).toBe("Test User")
    expect(user.email).toBe("test@qwack.ai")
    expect(user.passwordHash).toBeUndefined()
  })

  test("GET /users/me returns 404 for missing user", async () => {
    const { db } = createTestDatabase()
    const repo = new SqliteRepository(db)
    const app = new Hono<AuthEnv>()
    app.use("*", async (c, next) => {
      c.set("userId", "nonexistent")
      await next()
    })
    app.route("/", createUserRoutes(repo))

    const res = await app.request("/users/me")
    expect(res.status).toBe(404)
  })

  test("PATCH /users/me updates name", async () => {
    const { app } = createTestApp()
    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    })
    expect(res.status).toBe(200)
    const user = await res.json()
    expect(user.name).toBe("Updated Name")
    expect(user.passwordHash).toBeUndefined()
  })

  test("PATCH /users/me updates avatar URL", async () => {
    const { app } = createTestApp()
    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: "https://new-avatar.com/pic.png" }),
    })
    expect(res.status).toBe(200)
    const user = await res.json()
    expect(user.avatarUrl).toBe("https://new-avatar.com/pic.png")
  })

  test("PATCH /users/me returns 400 with empty body", async () => {
    const { app } = createTestApp()
    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
