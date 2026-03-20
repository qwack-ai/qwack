import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { createAuthMiddleware, type AuthVariables } from "./auth/middleware"
import { healthRoutes } from "./routes/health"
import { authRoutes } from "./routes/auth"
import { createSessionRoutes } from "./routes/sessions"
import { createSessionParticipantRoutes } from "./routes/session-participants"
import { createSessionEventRoutes } from "./routes/session-events"
import { createUserRoutes } from "./routes/users"
import { wsApp } from "./ws/handler"
import { createRepository } from "./repo/factory"
import { registerWsHandlers } from "./ws/register-handlers"
import type { IRepository } from "./repo/types"
import { createAuthIssuer } from "./auth/openauth"

/** Build a Hono app with the given repo (or default from env). */
export function createApp(repo?: IRepository): Hono {
  registerWsHandlers(repo)

  const app = new Hono()

  app.use("*", logger())
  app.use("/api/*", cors())
  app.use("/auth/*", cors())

  app.route("/", healthRoutes)
  app.route("/auth", authRoutes)

  app.route("/", wsApp)

  if (repo) {
    // Mount OpenAuth issuer for OAuth flows (handles /authorize, /token, etc.)
    const issuerApp = createAuthIssuer(repo)
    app.route("/", issuerApp)

    const api = new Hono<{ Variables: AuthVariables }>()
    api.use("*", createAuthMiddleware(repo))
    api.route("/", createSessionRoutes(repo))
    api.route("/", createSessionParticipantRoutes(repo))
    api.route("/", createSessionEventRoutes(repo))
    api.route("/", createUserRoutes(repo))
    app.route("/api", api)
  }

  return app
}

const repo = await createRepository()
export const app = createApp(repo)
