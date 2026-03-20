import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { authRoutes } from "./auth";

process.env.QWACK_DEV = "true";

function createTestApp() {
  const app = new Hono();
  app.route("/auth", authRoutes);
  return app;
}

describe("auth routes", () => {
  test("GET /auth/login redirects to OpenAuth issuer", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/login");
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("/authorize");
    expect(location).toContain("provider=github");
    expect(location).toContain("client_id=qwack-web");
  });

  test("GET /auth/login accepts provider query param", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/login?provider=email");
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("provider=email");
  });

  test("GET /auth/callback returns 400 without code", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/callback");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing authorization code");
  });

  test("GET /auth/callback returns tokens with code", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/callback?code=test-auth-code");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBe("test-auth-code");
    expect(body.refreshToken).toContain("refresh-");
    expect(body.expiresIn).toBe(86400);
  });

  test("POST /auth/logout returns ok", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("POST /auth/refresh returns 400 without refresh token", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing refresh token");
  });

  test("POST /auth/refresh returns new tokens", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "refresh-old" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toContain("refreshed-");
    expect(body.refreshToken).toContain("refresh-");
    expect(body.expiresIn).toBe(86400);
  });
});
