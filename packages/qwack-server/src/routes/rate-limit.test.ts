import { describe, test, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { rateLimit, clearRateLimitState } from "./rate-limit"

describe("rateLimit", () => {
  beforeEach(() => clearRateLimitState())

  function createApp(max = 3) {
    const app = new Hono()
    app.get("/test", rateLimit({ windowMs: 60_000, max }), (c) => c.json({ ok: true }))
    return app
  }

  test("allows requests under limit", async () => {
    const app = createApp(3)
    const res = await app.request("/test")
    expect(res.status).toBe(200)
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("2")
  })

  test("returns 429 when limit exceeded", async () => {
    const app = createApp(2)
    await app.request("/test")
    await app.request("/test")
    const res = await app.request("/test")
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe("Too many requests")
  })

  test("includes rate limit headers", async () => {
    const app = createApp(5)
    const res = await app.request("/test")
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5")
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4")
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy()
  })

  test("tracks different IPs independently", async () => {
    const app = createApp(1)
    const res1 = await app.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(res1.status).toBe(200)
    const res2 = await app.request("/test", { headers: { "x-forwarded-for": "5.6.7.8" } })
    expect(res2.status).toBe(200)
    const res3 = await app.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(res3.status).toBe(429)
  })

  test("resets after window expires", async () => {
    const app = createApp(1)
    const res1 = await app.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(res1.status).toBe(200)

    // Second request should be blocked
    const res2 = await app.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(res2.status).toBe(429)

    // Simulate time passing by creating a new app with a shorter window
    // and manually testing the reset logic
    clearRateLimitState()
    const appShort = new Hono()
    appShort.get("/test", rateLimit({ windowMs: 100, max: 1 }), (c) => c.json({ ok: true }))

    const res3 = await appShort.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(res3.status).toBe(200)

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150))

    const res4 = await appShort.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(res4.status).toBe(200)
  })
})
