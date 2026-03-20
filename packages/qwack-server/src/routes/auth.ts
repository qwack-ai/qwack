import { Hono } from "hono";
import { createClient } from "@openauthjs/openauth/client";
import { config } from "../config";

function isDev(): boolean {
  return process.env.QWACK_DEV === "true";
}

function getClient() {
  return createClient({
    clientID: "qwack-web",
    issuer: config.openAuthIssuerUrl,
  });
}

export const authRoutes = new Hono();

authRoutes.get("/login", async (c) => {
  const provider = c.req.query("provider") ?? "github";
  const redirectUri =
    c.req.query("redirect_uri") ?? "http://localhost:9999/callback";

  if (isDev()) {
    const issuerUrl = config.openAuthIssuerUrl;
    const url = `${issuerUrl}/authorize?provider=${provider}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&client_id=qwack-web`;
    return c.redirect(url);
  }

  const client = getClient();
  const { url } = await client.authorize(redirectUri, "code", { provider });
  return c.redirect(url);
});

authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) {
    return c.json({ error: "Missing authorization code" }, 400);
  }

  if (isDev()) {
    return c.json({
      accessToken: code,
      refreshToken: `refresh-${code}`,
      expiresIn: 86400,
    });
  }

  const redirectUri =
    c.req.query("redirect_uri") ?? "http://localhost:9999/callback";
  const client = getClient();
  const exchanged = await client.exchange(code, redirectUri);
  if (exchanged.err) {
    return c.json({ error: "Token exchange failed" }, 401);
  }

  return c.json({
    access: exchanged.tokens.access,
    refresh: exchanged.tokens.refresh,
  });
});

authRoutes.post("/logout", (c) => {
  return c.json({ ok: true });
});

authRoutes.post("/refresh", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (isDev()) {
    const refreshToken = (body as Record<string, unknown>).refreshToken as
      | string
      | undefined;
    if (!refreshToken) {
      return c.json({ error: "Missing refresh token" }, 400);
    }
    return c.json({
      accessToken: `refreshed-${Date.now()}`,
      refreshToken: `refresh-${Date.now()}`,
      expiresIn: 86400,
    });
  }

  const refreshToken = (body as Record<string, unknown>).refresh as
    | string
    | undefined;
  if (!refreshToken) {
    return c.json({ error: "Missing refresh token" }, 400);
  }

  const client = getClient();
  const refreshed = await client.refresh(refreshToken);
  if (refreshed.err) {
    return c.json({ error: "Refresh failed" }, 401);
  }

  return c.json({
    access: refreshed.tokens?.access,
    refresh: refreshed.tokens?.refresh,
  });
});
