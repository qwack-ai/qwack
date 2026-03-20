import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { healthRoutes } from "./health";

describe("health routes", () => {
  test("GET /health returns status ok", async () => {
    const app = new Hono();
    app.route("/", healthRoutes);

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("qwack");
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });
});
