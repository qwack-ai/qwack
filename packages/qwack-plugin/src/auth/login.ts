import type { QwackConfig } from "./store";
import { writeConfig } from "./store";

/**
 * Performs the login flow:
 * 1. Opens browser to server's auth page
 * 2. Starts a temporary local HTTP server to receive the callback
 * 3. Exchanges the code for tokens
 * 4. Stores the config
 */
export async function loginFlow(serverUrl: string): Promise<QwackConfig> {
  const server = serverUrl.replace(/\/$/, "");

  const callbackPort = await findAvailablePort(9876);
  const redirectUri = `http://localhost:${callbackPort}/callback`;

  return new Promise<QwackConfig>((resolve, reject) => {
    const timeout = setTimeout(() => {
      httpServer.stop();
      reject(new Error("Login timed out after 5 minutes"));
    }, 5 * 60 * 1000);

    const httpServer = Bun.serve({
      port: callbackPort,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          if (!code) {
            return new Response("Missing code", { status: 400 });
          }

          try {
            // Exchange code for tokens
            const tokenResponse = await fetch(
              `${server}/auth/callback?code=${encodeURIComponent(code)}`,
            );
            if (!tokenResponse.ok) {
              throw new Error(`Token exchange failed: ${tokenResponse.status}`);
            }
            const tokens = (await tokenResponse.json()) as {
              accessToken: string;
              refreshToken?: string;
            };

            const config: QwackConfig = {
              server,
              token: tokens.accessToken,
              refreshToken: tokens.refreshToken,
            };

            writeConfig(config);
            clearTimeout(timeout);
            httpServer.stop();
            resolve(config);

            return new Response(
              `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Qwack</title>
              <style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a1a;color:#c2c2b0}div{text-align:center}h1{font-size:48px;margin:0 0 8px}p{color:#888;font-size:16px}</style>
              </head><body><div><h1>\uD83E\uDD86</h1><p>Logged in. You can close this tab.</p></div></body></html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          } catch (err) {
            clearTimeout(timeout);
            httpServer.stop();
            reject(err);
            return new Response("Login failed", { status: 500 });
          }
        }
        return new Response("Not found", { status: 404 });
      },
    });

    // Open browser
    const loginUrl = `${server}/auth/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
    openBrowser(loginUrl);
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      const server = Bun.serve({ port, fetch: () => new Response("") });
      server.stop();
      return port;
    } catch {
      continue;
    }
  }
  throw new Error("No available port found");
}

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      Bun.spawn(["open", url]);
    } else if (platform === "linux") {
      Bun.spawn(["xdg-open", url]);
    } else if (platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", url]);
    }
  } catch {
    console.log(`Open this URL in your browser: ${url}`);
  }
}
