import { createSignal, batch, onCleanup, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { createPlanDoc } from "@qwack/shared"
import { qwackSessionName } from "@tui/component/qwack-session-name"
import type { QwackSessionListItem } from "@qwack/shared"
import * as Y from "yjs"
import {
  type QwackPresenceEntry,
  type QwackCollabMessage,
  type PromptExecuteCallback,
  MAX_MESSAGES,
  HEARTBEAT_MS,
  MAX_RECONNECT_DELAY,
  SESSION_FILE,
  readAuthConfig,
  writeAuthConfig,
  clearAuthConfig,
  getLocalSessionForQwack,
  setLocalSessionForQwack,
} from "./qwack-types"
import { createMessageHandler } from "./qwack-message-handler"
import { useRoute } from "./route"
import { useSDK } from "./sdk"
import { useSync } from "./sync"

// Re-export types so existing imports from "@tui/context/qwack" keep working
export type { QwackPresenceEntry, QwackCollabMessage, PromptExecuteCallback } from "./qwack-types"

export const { use: useQwack, provider: QwackProvider } = createSimpleContext({
  name: "Qwack",
  init: () => {
    let authConfig = readAuthConfig()
    const routeCtx = useRoute()
    const sdk = useSDK()
    const sync = useSync()
    const [status, setStatus] = createSignal<"disconnected" | "connecting" | "connected">("disconnected")
    const [sessionId, setSessionId] = createSignal<string | null>(null)
    const [shortCode, setShortCode] = createSignal<string | null>(null)
    const [isAuthenticated, setIsAuthenticated] = createSignal(false)
    const [userName, setUserName] = createSignal<string | null>(authConfig?.name ?? null)
    const [serverUrl, setServerUrl] = createSignal<string | null>(authConfig?.server ?? null)
    const [tokenPresent, setTokenPresent] = createSignal(Boolean(authConfig?.token))
    const [presence, setPresence] = createStore<QwackPresenceEntry[]>([])
    const [messages, setMessages] = createStore<QwackCollabMessage[]>([])
    const [currentUserRole, setCurrentUserRole] = createSignal<string>("collaborator")
    const [collabOnly, setCollabOnly] = createSignal(false)
    const [collabRouteId, setCollabRouteId] = createSignal<string | null>(null)
    const [offlineQueueSize, setOfflineQueueSize] = createSignal(0)
    const planDoc = createPlanDoc()

    const [connectionMessage, setConnectionMessage] = createSignal<string | null>(null)
    let promptExecuteCallback: PromptExecuteCallback | null = null
    let ws: WebSocket | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0
    let shouldReconnect = false
    let currentUserId: string | null = null
    let pendingAuthResolve: ((role: string) => void) | null = null

    function send(type: string, payload: Record<string, unknown> = {}) {
      if (ws?.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type, sessionId: sessionId(), timestamp: Date.now(), payload }))
    }

    function sendPlanUpdate(update: Uint8Array) {
      const b64 = btoa(String.fromCharCode(...update))
      send("plan:sync", { update: b64 })
    }


    function startHeartbeat() {
      heartbeatTimer = setInterval(() => send("ping"), HEARTBEAT_MS)
    }

    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }

    function updateRoleFromPresence() {
      if (!currentUserId) return
      const entry = presence.find((p) => p.id === currentUserId)
      if (entry) setCurrentUserRole(entry.role)
    }

    const handleMessage = createMessageHandler({
      setIsAuthenticated,
      setUserName,
      setCurrentUserRole,
      setStatus,
      setPresence,
      setMessages,
      updateRoleFromPresence,
      disconnect: () => disconnect(),
      getCurrentUserId: () => currentUserId,
      setCurrentUserId: (id: string) => {
        currentUserId = id
      },
      getPromptExecuteCallback: () => promptExecuteCallback,
      planDoc,
      setCollabOnly,
      setOfflineQueueSize,
      resolvePendingAuth: () => pendingAuthResolve,
      clearPendingAuth: () => { pendingAuthResolve = null },
      syncSet: sync.set,
      getLocalSessionId: () => {
        const route = routeCtx.data
        return route.type === "session" ? route.sessionID : null
      },
      registerParticipant: async () => {
        const server = serverUrl()
        const sid = sessionId()
        if (!server || !authConfig?.token || !sid) return
        const headers = { Authorization: `Bearer ${authConfig.token}`, "Content-Type": "application/json" }

        // Ensure session + participant exist in DB (fire-and-forget)
        fetch(`${server}/api/sessions`, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: qwackSessionName(sid), id: sid }),
        })
          .then((res) => res.json().then((data: any) => { if (data?.shortCode) setShortCode(data.shortCode) }).catch(() => {}))
          .catch(() => {})
          .finally(() => {
            fetch(`${server}/api/sessions/${encodeURIComponent(sid)}/join`, {
              method: "POST",
              headers,
            }).catch(() => {})
          })

      },
      setConnectionMessage,
      getCurrentUserRole: () => currentUserRole(),
      getSessionId: () => sessionId(),
      onBecomeHost: async (qwackSessionId: string) => {
        try {
          // Reuse existing local session if we've been in this Qwack session before
          const existing = getLocalSessionForQwack(qwackSessionId)
          if (existing) {
            batch(() => {
              setCollabOnly(false)
              setCollabRouteId(null)
              routeCtx.navigate({ type: "session", sessionID: existing })
            })
            return
          }
          // First time as host — create a local OpenCode session
          const res = await sdk.client.session.create({})
          if (res.error) {
            console.error("Failed to create local session for host transfer:", res.error)
            return
          }
          sdk.client.session.update({ sessionID: res.data.id, title: `🦆 ${qwackSessionName(qwackSessionId)}` }).catch(() => {})
          setLocalSessionForQwack(qwackSessionId, res.data.id)
          batch(() => {
            setCollabOnly(false)
            setCollabRouteId(null)
            routeCtx.navigate({ type: "session", sessionID: res.data.id })
          })
        } catch (err) {
          console.error("onBecomeHost error:", err)
        }
      },
      onLoseHost: (_qwackSessionId: string) => {
        // Stay on existing session — keep conversation history visible.
        // collabOnly intercepts prompt routing (sends via server, not local agent).
        // New agent output from the new host arrives via WS relay as collab messages.
        setCollabOnly(true)
      },
      onAuthError: async () => {
        const refreshed = await tryRefreshToken()
        if (refreshed) {
          setConnectionMessage("Token refreshed \u2014 reconnecting...")
          setTimeout(() => { const sid = sessionId(); if (sid) connect(sid) }, 500)
          return
        }
        disconnect()
      },
    })

    function scheduleReconnect() {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY)
      reconnectAttempts++
      reconnectTimer = setTimeout(() => {
        const sid = sessionId()
        if (sid && shouldReconnect) connect(sid)
      }, delay)
    }

    function connect(sid: string) {
      const server = serverUrl()
      if (!server || !authConfig?.token) return

      disconnect()
      shouldReconnect = true
      setSessionId(sid)
      setStatus("connecting")
      try {
        mkdirSync(dirname(SESSION_FILE), { recursive: true })
        writeFileSync(
          SESSION_FILE,
          JSON.stringify({ sessionId: sid, serverUrl: server, token: authConfig.token, connectedAt: Date.now() }),
        )
      } catch {}

      const wsUrl = server.replace(/^http/, "ws")
      const nameParam = userName() ? `&name=${encodeURIComponent(userName()!)}` : ""
      const url = `${wsUrl}/ws?token=${encodeURIComponent(authConfig.token)}&sessionId=${encodeURIComponent(sid)}${nameParam}`
      ws = new WebSocket(url)

      ws.onopen = () => {
        const wasReconnect = reconnectAttempts > 0
        reconnectAttempts = 0
        startHeartbeat()
        planDoc.on("update", sendPlanUpdate)
        if (wasReconnect) {
          setConnectionMessage("Reconnected")
          setTimeout(() => setConnectionMessage(null), 3000)
        }
      }
      ws.onmessage = (event) => {
        handleMessage(event as MessageEvent)
      }
      ws.onclose = () => {
        stopHeartbeat()
        if (status() !== "disconnected") {
          setStatus("disconnected")
          if (shouldReconnect) {
            setConnectionMessage("Reconnecting...")
          }
        }
        if (shouldReconnect) scheduleReconnect()
      }
      ws.onerror = () => {
        // Suppress native WS errors — onclose handles reconnection
      }
    }

    function disconnect() {
      shouldReconnect = false
      stopHeartbeat()
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (ws) {
        ws.close()
        ws = null
      }
      planDoc.off("update", sendPlanUpdate)
      try {
        unlinkSync(SESSION_FILE)
      } catch {}
      batch(() => {
        setStatus("disconnected")
        setIsAuthenticated(false)
        setSessionId(null)
        setPresence([])
        setCurrentUserRole("collaborator")
        setCollabOnly(false)
        setCollabRouteId(null)
        currentUserId = null
      })
    }

    function sendMessage(content: string) {
      const name = userName() ?? "anonymous"
      setMessages(
        produce((draft) => {
          draft.push({ id: crypto.randomUUID(), authorName: name, content, timestamp: Date.now() })
          while (draft.length > MAX_MESSAGES) draft.shift()
        }),
      )
      send("collab:message", { content, authorName: name })
    }

    function sendPrompt(content: string) {
      send("prompt:sent", { content, authorName: userName() ?? "anonymous" })
    }

    function sendPromptRequest(content: string) {
      const name = userName() ?? "anonymous"
      setMessages(
        produce((draft) => {
          draft.push({ id: crypto.randomUUID(), authorName: name, content, timestamp: Date.now() })
          while (draft.length > MAX_MESSAGES) draft.shift()
        }),
      )
      send("prompt:request", { content, authorName: name, authorId: currentUserId ?? "unknown" })
    }

    function onPromptExecute(callback: PromptExecuteCallback | null) {
      promptExecuteCallback = callback
    }

    async function fetchSessions(): Promise<QwackSessionListItem[]> {
      const server = serverUrl()
      if (!server || !authConfig?.token) return []
      try {
        const res = await fetch(`${server}/api/sessions`, {
          headers: { Authorization: `Bearer ${authConfig.token}` },
        })
        if (res.status === 401) {
          // Token expired — try refresh before giving up
          const refreshed = await tryRefreshToken()
          if (!refreshed) return []
          const retry = await fetch(`${server}/api/sessions`, {
            headers: { Authorization: `Bearer ${authConfig.token}` },
          })
          if (!retry.ok) return []
          return (await retry.json()) as QwackSessionListItem[]
        }
        if (!res.ok) return []
        return (await res.json()) as QwackSessionListItem[]
      } catch {
        return []
      }
    }

    async function tryRefreshToken(): Promise<boolean> {
      if (!authConfig?.refreshToken || !authConfig?.server) {
        clearAuthAndNotify()
        return false
      }
      try {
        const res = await fetch(`${authConfig.server}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: authConfig.refreshToken }),
        })
        if (!res.ok) {
          clearAuthAndNotify()
          return false
        }
        const tokens = await res.json() as { access?: string; refresh?: string }
        if (!tokens.access) {
          clearAuthAndNotify()
          return false
        }
        authConfig = { ...authConfig, token: tokens.access, refreshToken: tokens.refresh ?? authConfig.refreshToken }
        writeAuthConfig(authConfig)
        return true
      } catch {
        clearAuthAndNotify()
        return false
      }
    }

    function clearAuthAndNotify(): void {
      clearAuthConfig()
      authConfig = null
      setTokenPresent(false)
      setIsAuthenticated(false)
      setConnectionMessage("Session expired \u2014 run /qwack login")
    }

    async function resolveShortCode(codeOrId: string): Promise<string | null> {
      const server = serverUrl()
      if (!server || !authConfig?.token) return null
      if (codeOrId.length > 20) return codeOrId
      try {
        const res = await fetch(`${server}/api/sessions/code/${encodeURIComponent(codeOrId)}`, {
          headers: { Authorization: `Bearer ${authConfig.token}` },
        })
        if (!res.ok) return null
        const data = (await res.json()) as { id: string }
        return data.id
      } catch {
        return null
      }
    }

    async function connectAndJoin(sid: string): Promise<string> {
      // Pre-register as participant so the server's isSessionParticipant check passes
      const server = serverUrl()
      if (server && authConfig?.token) {
        const headers = { Authorization: `Bearer ${authConfig.token}`, "Content-Type": "application/json" }
        await fetch(`${server}/api/sessions/${encodeURIComponent(sid)}/join`, {
          method: "POST", headers,
        }).catch(() => {})
      }
      return new Promise((resolve) => {
        pendingAuthResolve = resolve
        connect(sid)
      })
    }

    function requestHostChange(newHostId: string) {
      send("session:host_change", { newHostId })
    }

    async function joinSession(qwackSessionId: string): Promise<boolean> {
      const existing = getLocalSessionForQwack(qwackSessionId)
      if (existing) {
        setCollabOnly(true)
        setCollabRouteId(qwackSessionId)
        routeCtx.navigate({ type: "session", sessionID: existing })
        return true
      }
      const res = await sdk.client.session.create({})
      if (res.error) return false
      sdk.client.session.update({ sessionID: res.data.id, title: `🦆 ${qwackSessionName(qwackSessionId)}` }).catch(() => {})
      setLocalSessionForQwack(qwackSessionId, res.data.id)
      setCollabOnly(true)
      setCollabRouteId(qwackSessionId)
      routeCtx.navigate({ type: "session", sessionID: res.data.id })
      return true
    }

    async function shareCurrentSession(): Promise<boolean> {
      const route = routeCtx.data
      if (route.type !== "session") return false
      const currentSessionId = route.sessionID

      const messagesRes = await sdk.client.session.messages({ sessionID: currentSessionId })
      if (messagesRes.error || !messagesRes.data) return false
      const msgs = messagesRes.data
      if (msgs.length === 0) return false

      const qwackSessionId = crypto.randomUUID()
      const role = await connectAndJoin(qwackSessionId)
      if (!role || !ws || ws.readyState !== WebSocket.OPEN) return false

      const senderId = authConfig?.token ?? "unknown"
      const senderName = authConfig?.name ?? "User"

      for (const msg of msgs) {
        const ts = new Date(msg.info.time.created).getTime()

        if (msg.info.role === "user") {
          const textParts: string[] = []
          for (const p of msg.parts) {
            if (p.type === "text" && !p.synthetic && p.text) {
              textParts.push(p.text)
            }
          }
          const content = textParts.join("\n")
          if (content) {
            ws.send(JSON.stringify({
              type: "prompt:sent",
              sessionId: qwackSessionId,
              senderId,
              timestamp: ts,
              payload: { authorId: senderId, authorName: senderName, content },
              replayed: true,
            }))
          }
        } else if (msg.info.role === "assistant") {
          for (const part of msg.parts) {
            if (part.type === "text" && part.text) {
              ws.send(JSON.stringify({
                type: "agent:output",
                sessionId: qwackSessionId,
                senderId,
                timestamp: ts,
                payload: { content: part.text, messageId: msg.info.id },
                replayed: true,
              }))
            }
          }
          const completedTs = msg.info.time.completed
            ? new Date(msg.info.time.completed).getTime()
            : ts
          ws.send(JSON.stringify({
            type: "agent:complete",
            sessionId: qwackSessionId,
            senderId,
            timestamp: completedTs,
            payload: { messageId: msg.info.id },
            replayed: true,
          }))
        }

        // Throttle to avoid overwhelming the server with replayed events
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      return true
    }

    onCleanup(() => {
      try {
        unlinkSync(SESSION_FILE)
      } catch {}
      disconnect()
    })

    return {
      status,
sessionId,
      shortCode,
      resolveShortCode,
      presence: (() => presence) as Accessor<QwackPresenceEntry[]>,
      onlineCount: (() => presence.length) as Accessor<number>,
      messages: (() => messages) as Accessor<QwackCollabMessage[]>,
      connect,
      disconnect,
      fetchSessions,
      connectAndJoin,
      sendMessage,
      sendPrompt,
      sendPromptRequest,
      onPromptExecute,
      requestHostChange,
      joinSession,
      shareCurrentSession,
      deleteSession: async (sid: string): Promise<boolean> => {
        const server = serverUrl()
        if (!server || !authConfig?.token) return false
        try {
          const res = await fetch(`${server}/api/sessions/${encodeURIComponent(sid)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${authConfig.token}` },
          })
          return res.ok
        } catch {
          return false
        }
      },
      isAuthenticated,
      userName,
      serverUrl,
      authToken: () => authConfig?.token ?? null,
      currentUserId: () => currentUserId,
      hasToken: () => tokenPresent(),
      onLogin: (config: { server: string; token: string; refreshToken?: string; name: string }) => {
        authConfig = config
        setServerUrl(config.server)
        setTokenPresent(true)
        setUserName(config.name)
      },
      onLogout: () => {
        const server = authConfig?.server ?? null
        authConfig = server ? { server, token: "" } : null
        setTokenPresent(false)
        setUserName(null)
        setIsAuthenticated(false)
        // Keep serverUrl so /qwack login doesn't fall back to qwack.ai
      },
      currentUserRole,
      isRelayMode: (() => currentUserRole() !== "host") as Accessor<boolean>,
      planDoc: (() => planDoc) as Accessor<Y.Doc>,
      collabOnly,
      setCollabOnly,
      collabRouteId,
      setCollabRouteId,
      isCollabOnly: (() => collabOnly()) as Accessor<boolean>,
offlineQueueSize,
      connectionMessage,
    }
  },
})
