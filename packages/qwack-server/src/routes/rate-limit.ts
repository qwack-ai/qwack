import { createMiddleware } from "hono/factory"

interface RateLimitWindow {
  count: number
  resetAt: number
}

const windows = new Map<string, RateLimitWindow>()

const CLEANUP_INTERVAL = 60_000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key)
  }
}

export function rateLimit(opts: { windowMs: number; max: number }) {
  return createMiddleware(async (c, next) => {
    cleanup()

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown"
    const key = `${ip}:${c.req.path}`
    const now = Date.now()

    let window = windows.get(key)
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + opts.windowMs }
      windows.set(key, window)
    }

    window.count++

    c.header("X-RateLimit-Limit", String(opts.max))
    c.header("X-RateLimit-Remaining", String(Math.max(0, opts.max - window.count)))
    c.header("X-RateLimit-Reset", String(Math.ceil(window.resetAt / 1000)))

    if (window.count > opts.max) {
      return c.json({ error: "Too many requests", retryAfter: Math.ceil((window.resetAt - now) / 1000) }, 429)
    }

    await next()
  })
}

// Export for testing
export function clearRateLimitState() {
  windows.clear()
}
