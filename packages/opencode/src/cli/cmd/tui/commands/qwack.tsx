import { useCommandDialog, type CommandOption } from "@tui/component/dialog-command"
import { useQwack } from "@tui/context/qwack"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { DialogQwackInvite, DialogQwackJoin } from "@tui/ui/dialog-qwack-invite"

/** triggerSlash() extends DialogContext with the raw slash input string */
type SlashDialogContext = DialogContext & { input?: string }

const LOGIN_TIMEOUT_MS = 120000

async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    try {
      const server = Bun.serve({ port, fetch: () => new Response() })
      server.stop()
      return port
    } catch {}
  }
  return start
}

export function QwackCommands() {
  const qwack = useQwack()
  const route = useRoute()
  const command = useCommandDialog()
  const toast = useToast()
  const dialog = useDialog()
  const connected = () => qwack.status() === "connected"
  const loggedIn = () => qwack.hasToken()
  const isHost = () => qwack.currentUserRole() === "host"

  const show = (message: string, variant: "success" | "warning" = "success") =>
    toast.show({ message, variant })

  command.register(() => [
    {
      title: "Share this session", value: "qwack.share", category: "Qwack",
      enabled: loggedIn() && !connected(),
      suggested: !connected(), slash: { name: "qwack share", aliases: ["qshare"] },
      description: "Convert current session to collaborative Qwack session",
      onSelect: async (d) => {
        d.clear()
        if (connected()) {
          show("Already in a Qwack session", "warning")
          return
        }
        show("Sharing session...")
        const success = await qwack.shareCurrentSession()
        if (success) {
          show("Session shared! Invite collaborators with the session ID.")
          DialogQwackInvite.show(dialog)
        } else {
          show("Failed to share session", "warning")
        }
      },
    },
    {
      title: "Start collab session", value: "qwack.start", category: "Qwack",
      enabled: loggedIn() && !connected(),
      suggested: !connected(), slash: { name: "qwack start", aliases: ["qstart"] },
      description: "Start a new Qwack collaboration session",
      onSelect: (d) => {
        const sid = crypto.randomUUID()
        qwack.connect(sid)
        d.clear()
        DialogQwackInvite.show(dialog)
      },
    },
    {
      title: "Join collab session", value: "qwack.join", category: "Qwack",
      enabled: loggedIn() && !connected(),
      suggested: !connected(), slash: { name: "qwack join", aliases: ["qjoin"] },
      description: "Join an existing Qwack session",
      onSelect: (d) => {
        d.clear()
        DialogQwackJoin.show(dialog, (sid) => qwack.joinSession(sid))
      },
    },
    {
      title: "Get invite link", value: "qwack.invite", category: "Qwack",
      enabled: connected(),
      slash: { name: "qwack invite", aliases: ["qinvite"] }, description: "Generate a session invite link",
      onSelect: (d) => {
        d.clear()
        DialogQwackInvite.show(dialog)
      },
    },
    {
      title: "Who's online", value: "qwack.who", category: "Qwack",
      enabled: connected(),
      suggested: connected(), slash: { name: "qwack who", aliases: ["qwho"] },
      description: "List online participants",
      onSelect: (d) => {
        const list = qwack.presence()
        show(list.length ? list.map((p) => `${p.name} (${p.role})`).join(", ") : "No one online")
        d.clear()
      },
    },
    {
      title: "Leave session", value: "qwack.leave", category: "Qwack",
      enabled: connected(),
      suggested: connected(), slash: { name: "qwack leave", aliases: ["qleave"] },
      description: "Leave the current Qwack session",
      onSelect: (d) => { qwack.disconnect(); show("Left session"); d.clear() },
    },
    {
      title: "Connection status", value: "qwack.status", category: "Qwack",
      suggested: true, slash: { name: "qwack status", aliases: ["qstatus"] },
      description: "Show Qwack connection status",
      onSelect: (d) => {
        const server = qwack.serverUrl() ?? "not configured"
        const code = qwack.shortCode() ?? "none"
        const sid = qwack.sessionId() ?? "none"
        const role = qwack.currentUserRole() ?? "none"
        show(`Status: ${qwack.status()} | Code: ${code} | Session: ${sid} | Role: ${role} | Server: ${server}`)
        d.clear()
      },
    },
    {
      title: "Home (session list)", value: "qwack.home", category: "Qwack",
      slash: { name: "qwack home", aliases: ["qhome"] },
      description: "Return to splash screen",
      onSelect: (d) => {
        d.clear()
        qwack.disconnect()
        route.navigate({ type: "home" })
      },
    },
    {
      title: "Login to Qwack", value: "qwack.login", category: "Qwack",
      enabled: !loggedIn(),
      slash: { name: "qwack login", aliases: ["qlogin"] }, description: "Authenticate with Qwack server",
      onSelect: async (d) => {
        d.clear()
        const server = qwack.serverUrl() ?? "https://qwack.ai"
        const callbackPort = await findAvailablePort(9876)
        const redirectUri = `http://localhost:${callbackPort}/callback`
        show("Opening browser for login...")

        try {
          const issuerUrl = `${server.replace(/:4000$/, ":4001")}`
          const { createClient } = await import("@openauthjs/openauth/client")
          const client = createClient({ clientID: "qwack-cli", issuer: issuerUrl })

          const tokenPromise = new Promise<{ access: string; refresh?: string }>((resolve, reject) => {
            const timeout = setTimeout(() => { callbackServer?.stop(); reject(new Error("Login timed out")) }, LOGIN_TIMEOUT_MS)
            const callbackServer = Bun.serve({
              port: callbackPort,
              fetch: async (req) => {
                const url = new URL(req.url)
                if (url.pathname === "/callback") {
                  const code = url.searchParams.get("code")
                  if (!code) return new Response("Missing code", { status: 400 })
                  try {
                    const exchanged = await client.exchange(code, redirectUri)
                    if (exchanged.err) { reject(new Error("Token exchange failed")); return new Response("Auth failed. Close this tab.") }
                    clearTimeout(timeout)
                    resolve({ access: exchanged.tokens.access, refresh: exchanged.tokens.refresh })
                    setTimeout(() => callbackServer.stop(), 500)
                    return Response.redirect("https://qwack.ai", 302)
                  } catch (err) {
                    reject(err)
                    return new Response("Auth error. Close this tab.")
                  }
                }
                return new Response("Not found", { status: 404 })
              },
            })
          })

          const { url } = await client.authorize(redirectUri, "code", { provider: "github" })
          const { platform } = await import("node:os")
          const p = platform()
          if (p === "win32") {
            Bun.spawn(["powershell", "-Command", `Start-Process '${url}'`], { stdout: "ignore", stderr: "ignore" })
          } else {
            Bun.spawn([p === "darwin" ? "open" : "xdg-open", url], { stdout: "ignore", stderr: "ignore" })
          }

          const tokens = await tokenPromise

          const { writeAuthConfig, readAuthConfig } = await import("@tui/context/qwack-types")
          const config = { server, token: tokens.access, refreshToken: tokens.refresh, name: "User" }
          writeAuthConfig(config)
          qwack.onLogin(config)
          show("Logged in!")

          setTimeout(async () => {
            try {
              const current = readAuthConfig()
              if (!current?.token) return
              const res = await fetch(`${server}/api/users/me`, {
                headers: { Authorization: `Bearer ${current.token}` },
              })
              if (res.ok) {
                const me = await res.json() as { name?: string }
                if (me.name) {
                  writeAuthConfig({ ...current, name: me.name })
                  qwack.onLogin({ ...current, name: me.name })
                  show(`Logged in as ${me.name}!`)
                }
              }
            } catch {}
          }, 2000)
        } catch (err) {
          show(`Login failed: ${err instanceof Error ? err.message : "unknown error"}`, "warning")
        }
      },
    },
    {
      title: "Logout from Qwack", value: "qwack.logout", category: "Qwack",
      enabled: loggedIn(),
      slash: { name: "qwack logout", aliases: ["qlogout"] }, description: "Clear Qwack credentials",
      onSelect: async (d) => {
        d.clear()
        const { clearAuthConfig } = await import("@tui/context/qwack-types")
        clearAuthConfig()
        qwack.onLogout()
        show("Logged out.")
      },
    },
    {
      title: "Open documentation", value: "qwack.docs", category: "Qwack",
      slash: { name: "qwack docs", aliases: ["qdocs"] },
      description: "Open Qwack docs in your browser",
      onSelect: async (d) => {
        d.clear()
        const { exec } = await import("node:child_process")
        const { platform } = await import("node:os")
        const url = "https://docs.qwack.ai"
        const p = platform()
        if (p === "win32") exec(`start ${url}`)
        else if (p === "darwin") exec(`open ${url}`)
        else exec(`xdg-open ${url}`)
        show("Opening docs...")
      },
    },
    {
      title: "Send collab message", value: "qwack.msg", category: "Qwack",
      enabled: connected(),
      suggested: connected(), slash: { name: "qwack msg", aliases: ["qmsg"] },
      description: "Send a side-channel message to collaborators",
      onSelect: (d) => {
        if (!connected()) { show("Not connected to a session", "warning"); d.clear(); return }
        const raw = (d as SlashDialogContext).input ?? ""
        const msg = raw.replace(/^\/(qwack\s+msg|qmsg)\s*/i, "").trim()
        if (!msg) { show("Usage: /qwack msg <message>", "warning"); d.clear(); return }
        qwack.sendMessage(msg)
        d.clear()
      },
    },
    {
      title: "Transfer host role", value: "qwack.host", category: "Qwack",
      enabled: connected() && isHost(),
      suggested: connected(), slash: { name: "qwack host", aliases: ["qhost"] },
      description: "Hand off the host role to another collaborator",
      onSelect: (d) => {
        if (!connected()) { show("Not connected to a session", "warning"); d.clear(); return }
        if (qwack.currentUserRole() !== "host") { show("Only the host can transfer the host role", "warning"); d.clear(); return }
        const raw = (d as SlashDialogContext).input ?? ""
        const target = raw.replace(/^\/(qwack\s+host|qhost)\s*/i, "").trim()
        if (!target) { show("Usage: /qwack host <username>", "warning"); d.clear(); return }
        const participant = qwack.presence().find((p) => p.name === target || p.id === target)
        if (!participant) { show(`User '${target}' not found in session`, "warning"); d.clear(); return }
        qwack.requestHostChange(participant.id)
        show(`Host role transferred to ${participant.name}`)
        d.clear()
      },
    },
    {
      title: "Kick participant", value: "qwack.kick", category: "Qwack",
      enabled: connected() && isHost(),
      suggested: connected() && isHost(), slash: { name: "qwack kick", aliases: ["qkick"] },
      description: "Remove a participant from the session",
      onSelect: async (d) => {
        if (!connected()) { show("Not connected to a session", "warning"); d.clear(); return }
        if (qwack.currentUserRole() !== "host") { show("Only the host can kick", "warning"); d.clear(); return }
        const raw = (d as SlashDialogContext).input ?? ""
        const target = raw.replace(/^\/(qwack\s+kick|qkick)\s*/i, "").trim()
        if (!target) { show("Usage: /qwack kick <username>", "warning"); d.clear(); return }
        const participant = qwack.presence().find((p) => p.name === target || p.id === target)
        if (!participant) { show(`User '${target}' not found in session`, "warning"); d.clear(); return }
        if (participant.id === qwack.currentUserId()) { show("Cannot kick yourself", "warning"); d.clear(); return }
        try {
          const server = qwack.serverUrl()
          const token = qwack.authToken()
          if (!server || !token) { show("Not authenticated", "warning"); d.clear(); return }
          const res = await fetch(`${server}/api/sessions/${qwack.sessionId()}/kick/${participant.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            show(`Kicked ${participant.name}`)
          } else {
            const body = await res.json().catch(() => ({ error: "Unknown error" }))
            show((body as { error?: string }).error ?? "Kick failed", "warning")
          }
        } catch {
          show("Failed to kick participant", "warning")
        }
        d.clear()
      },
    },
  ] satisfies CommandOption[])

  return null
}
