import { describe, test, expect } from "bun:test";
import { app } from "./app";

describe("app integration", () => {
  test("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("auth routes are mounted (not 404)", async () => {
    const res = await app.request("/auth/login");
    // Should redirect to OAuth issuer, not 404
    expect(res.status).not.toBe(404);
  });

  test("GET /api/sessions returns 401 without auth", async () => {
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(401);
  });

  test("GET /api/users/me returns 401 without auth", async () => {
    const res = await app.request("/api/users/me");
    expect(res.status).toBe(401);
  });

  test("POST /api/sessions/:id/join returns 401 without auth", async () => {
    const res = await app.request("/api/sessions/test-id/join", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});
