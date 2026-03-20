import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const version = (() => {
  try {
    // Try server package.json first (works in Docker), fall back to root
    for (const rel of ["../../package.json", "../../../package.json"]) {
      try {
        const pkg = JSON.parse(readFileSync(resolve(__dirname, rel), "utf-8"));
        if (pkg.version) return pkg.version;
      } catch {}
    }
    return process.env.QWACK_VERSION ?? "unknown";
  } catch {
    return "unknown";
  }
})();

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "qwack",
    version,
    uptime: process.uptime(),
  });
});
