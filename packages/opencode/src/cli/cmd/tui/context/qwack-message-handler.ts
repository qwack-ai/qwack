import { batch } from "solid-js"
import { produce, type SetStoreFunction } from "solid-js/store"
import * as Y from "yjs"
import {
  MAX_MESSAGES,
  type QwackPresenceEntry,
  type QwackCollabMessage,
  type PromptExecuteCallback,
  readAuthConfig,
  writeAuthConfig,
} from "./qwack-types"

export interface MessageHandlerDeps {
  setIsAuthenticated: (v: boolean) => void
  setUserName: (v: string | null) => void
  setCurrentUserRole: (v: string) => void
  setStatus: (v: "disconnected" | "connecting" | "connected") => void
  setPresence: SetStoreFunction<QwackPresenceEntry[]>
  setMessages: SetStoreFunction<QwackCollabMessage[]>
  updateRoleFromPresence: () => void
  disconnect: () => void
  getCurrentUserId: () => string | null
  setCurrentUserId: (id: string) => void
  getPromptExecuteCallback: () => PromptExecuteCallback | null
  planDoc: Y.Doc
  setCollabOnly: (v: boolean) => void
  setOfflineQueueSize: (v: number) => void
  resolvePendingAuth: () => ((role: string) => void) | null
  clearPendingAuth: () => void
  /** Read the current user's role (before mutation) */
  getCurrentUserRole: () => string
  /** Read the Qwack session ID */
  getSessionId: () => string | null
  /** Called when the current user transitions from collaborator to host */
  onBecomeHost: (qwackSessionId: string) => void
  /** Called when the current user transitions from host to collaborator */
  onLoseHost: (qwackSessionId: string) => void
  /** Persist this user as a session participant on the server (POST /sessions/:id/join) */
  registerParticipant: () => void
  syncSet: (...args: any[]) => void
  getLocalSessionId: () => string | null
  onAuthError: () => void
  setConnectionMessage: (v: string) => void
}

export function createMessageHandler(deps: MessageHandlerDeps) {
  const recentEvents = new Set<string>()
  function isDuplicate(data: { type: string; timestamp?: number; payload?: any }): boolean {
    const key = `${data.type}:${data.timestamp ?? 0}:${JSON.stringify(data.payload).slice(0, 100)}`
    if (recentEvents.has(key)) return true
    recentEvents.add(key)
    if (recentEvents.size > 500) {
      const first = recentEvents.values().next().value
      if (first) recentEvents.delete(first)
    }
    return false
  }

  function ensureAssistantMessage(localSid: string, messageId: string) {
    deps.syncSet("message", produce((draft: Record<string, any[]>) => {
      if (!draft[localSid]) draft[localSid] = []
      if (!draft[localSid].find((m: any) => m.id === messageId)) {
        draft[localSid].push({
          id: messageId, sessionID: localSid, role: "assistant",
          time: { created: Date.now() },
          parentID: "relay", modelID: "qwack-relay", providerID: "qwack",
          agent: "default", path: { cwd: "/", root: "/" },
          cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          system: false, mode: "chat",
        })
      }
    }))
  }

  return function handleMessage(event: MessageEvent) {
    let data: { type: string; payload: Record<string, unknown> }
    try {
      data = JSON.parse(event.data as string)
    } catch {
      return
    }

    if (data.type.startsWith("agent:") && isDuplicate(data)) return

    switch (data.type) {
      case "auth:ok":
        batch(() => {
          deps.setIsAuthenticated(true)
          deps.setConnectionMessage("")
          if (data.payload.user && typeof data.payload.user === "object") {
            const user = data.payload.user as { id?: string; name?: string; role?: string }
            if (user.name) deps.setUserName(user.name)
            if (user.id) deps.setCurrentUserId(user.id)
            if (user.role) {
              deps.setCurrentUserRole(user.role)
              deps.setCollabOnly(user.role !== "host")
            }
          }
          deps.setStatus("connected")
        })
        // Persist name to config.json so it's available on next startup
        if (data.payload.user && typeof data.payload.user === "object") {
          const u = data.payload.user as { name?: string }
          if (u.name) {
            const existing = readAuthConfig()
            if (existing && existing.name !== u.name) {
              writeAuthConfig({ ...existing, name: u.name })
            }
          }
        }
        // Persist participant record in DB so session shows on splash screen after restart
        deps.registerParticipant()
        {
          const resolve = deps.resolvePendingAuth()
          if (resolve) {
            const user = data.payload.user as { role?: string } | undefined
            resolve(user?.role ?? "collaborator")
            deps.clearPendingAuth()
          }
        }
        break
      case "auth:error":
        deps.onAuthError()
        break
      case "presence:join": {
        const pj = data.payload as { user?: { id: string; name: string }; role?: string }
        const joinId = pj.user?.id
        const joinName = pj.user?.name ?? "unknown"
        const joinRole = pj.role ?? "collaborator"
        if (joinId) {
          deps.setPresence(
            produce((draft) => {
              if (!draft.find((e) => e.id === joinId)) draft.push({ id: joinId, name: joinName, role: joinRole })
            }),
          )
          deps.updateRoleFromPresence()
        }
        break
      }
      case "presence:leave": {
        const leaveId = data.payload.userId as string
        if (leaveId) {
          deps.setPresence(
            produce((draft) => {
              const idx = draft.findIndex((e) => e.id === leaveId)
              if (idx !== -1) draft.splice(idx, 1)
            }),
          )
        }
        break
      }
      case "presence:list": {
        const list = data.payload.participants as QwackPresenceEntry[] | undefined
        deps.setPresence(list ?? [])
        deps.updateRoleFromPresence()
        break
      }
      case "collab:message": {
        const msg: QwackCollabMessage = {
          id: crypto.randomUUID(),
          authorName: (data.payload.authorName as string) ?? "unknown",
          content: (data.payload.content as string) ?? "",
          timestamp: Date.now(),
        }
        deps.setMessages(
          produce((draft) => {
            draft.push(msg)
            while (draft.length > MAX_MESSAGES) draft.shift()
          }),
        )
        break
      }
      case "prompt:sent": {
        if (deps.getCurrentUserRole() === "host") break
        const localSid = deps.getLocalSessionId()
        if (!localSid) break
        const userMsgId = crypto.randomUUID()
        const content = (data.payload.content as string) ?? ""
        const authorName = (data.payload.authorName as string) ?? "unknown"
        batch(() => {
          deps.syncSet("message", produce((draft: Record<string, any[]>) => {
            if (!draft[localSid]) draft[localSid] = []
            draft[localSid].push({
              id: userMsgId, sessionID: localSid, role: "user",
              time: { created: Date.now() }, system: false, mode: "chat",
            })
          }))
          deps.syncSet("part", produce((draft: Record<string, any[]>) => {
            draft[userMsgId] = [{
              id: `${userMsgId}-text`, sessionID: localSid, messageID: userMsgId,
              type: "text", text: `\u{1F464} ${authorName}: ${content}`,
            }]
          }))
        })
        break
      }
      case "prompt:execute": {
        const content = (data.payload.content as string) ?? ""
        const requestedBy = (data.payload.requestedByName as string) ?? (data.payload.requestedBy as string) ?? "unknown"
        const cb = deps.getPromptExecuteCallback()
        if (cb && content) cb(content, requestedBy)
        break
      }
      case "session:host_change": {
        const newHostId = data.payload.newHostId as string
        if (!newHostId) break
        const myId = deps.getCurrentUserId()
        const wasHost = deps.getCurrentUserRole() === "host"
        const willBeHost = myId === newHostId
        deps.setPresence(
          produce((draft) => {
            for (const p of draft) {
              p.role = p.id === newHostId ? "host" : "collaborator"
            }
          }),
        )
        deps.updateRoleFromPresence()
        // Trigger mode transition callbacks
        const qwackSid = deps.getSessionId()
        if (myId && qwackSid) {
          if (wasHost && !willBeHost) {
            deps.onLoseHost(qwackSid)
          } else if (!wasHost && willBeHost) {
            deps.onBecomeHost(qwackSid)
          }
        }
        break
      }
      case "agent:output": {
        if (deps.getCurrentUserRole() === "host") break
        const localSid = deps.getLocalSessionId()
        if (!localSid) break
        const messageId = (data.payload.messageId as string) ?? crypto.randomUUID()
        const content = (data.payload.content as string) ?? ""
        batch(() => {
          ensureAssistantMessage(localSid, messageId)
          deps.syncSet("part", produce((draft: Record<string, any[]>) => {
            if (!draft[messageId]) draft[messageId] = []
            const textPart = draft[messageId].find((p: any) => p.type === "text" && !p.synthetic)
            if (textPart) { textPart.text += content }
            else { draft[messageId].push({ id: `${messageId}-text`, sessionID: localSid, messageID: messageId, type: "text", text: content }) }
          }))
        })
        break
      }
      case "agent:thinking": {
        if (deps.getCurrentUserRole() === "host") break
        const localSid = deps.getLocalSessionId()
        if (!localSid) break
        const messageId = (data.payload.messageId as string) ?? crypto.randomUUID()
        const content = (data.payload.content as string) ?? ""
        const partId = `${messageId}-reasoning`
        batch(() => {
          ensureAssistantMessage(localSid, messageId)
          deps.syncSet("part", produce((draft: Record<string, any[]>) => {
            if (!draft[messageId]) draft[messageId] = []
            const part = draft[messageId].find((p: any) => p.id === partId)
            if (part) { part.text += content }
            else { draft[messageId].push({ id: partId, sessionID: localSid, messageID: messageId, type: "reasoning", text: content, time: { start: Date.now() } }) }
          }))
        })
        break
      }
      case "agent:complete": {
        if (deps.getCurrentUserRole() === "host") break
        const localSid = deps.getLocalSessionId()
        if (!localSid) break
        const completedMessageId = (data.payload.messageId as string) ?? ""
        if (!completedMessageId) break
        deps.syncSet("message", produce((draft: Record<string, any[]>) => {
          const messages = draft[localSid]
          if (!messages) return
          const msg = messages.find((m: any) => m.id === completedMessageId)
          if (msg?.time) msg.time.completed = Date.now()
        }))
        break
      }
      case "agent:tool_use": {
        if (deps.getCurrentUserRole() === "host") break
        const localSid = deps.getLocalSessionId()
        if (!localSid) break
        const p = data.payload as { tool: string; input: unknown; partId: string; messageId?: string }
        const messageId = p.messageId ?? crypto.randomUUID()
        batch(() => {
          ensureAssistantMessage(localSid, messageId)
          deps.syncSet("part", produce((draft: Record<string, any[]>) => {
            if (!draft[messageId]) draft[messageId] = []
            draft[messageId].push({
              id: p.partId, sessionID: localSid, messageID: messageId,
              type: "tool", tool: p.tool, callID: p.partId,
              state: { status: "running", input: p.input, title: p.tool, output: "", metadata: {}, time: { start: Date.now() } },
            })
          }))
        })
        break
      }
      case "agent:tool_result": {
        if (deps.getCurrentUserRole() === "host") break
        const p = data.payload as { tool: string; output: unknown; metadata?: Record<string, unknown>; partId: string; status: "completed" | "error"; error?: string; messageId?: string }
        const messageId = p.messageId
        if (!messageId) break
        deps.syncSet("part", produce((draft: Record<string, any[]>) => {
          const parts = draft[messageId]
          if (!parts) return
          const toolPart = parts.find((tp: any) => tp.id === p.partId)
          if (toolPart?.state) {
            toolPart.state.status = p.status === "completed" ? "completed" : "error"
            toolPart.state.output = typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? "")
            toolPart.state.title = p.tool
            if (p.metadata) toolPart.state.metadata = p.metadata
            if (p.error) toolPart.state.error = p.error
            toolPart.state.time = { ...toolPart.state.time, end: Date.now() }
          }
        }))
        break
      }
      case "session:history": {
        const localSid = deps.getLocalSessionId()
        const events = data.payload.events as
          | Array<{ type: string; senderId: string; timestamp: number; payload: Record<string, unknown> }>
          | undefined
        if (!events || events.length === 0) break

        const collabMessages: QwackCollabMessage[] = []

        batch(() => {
          for (const evt of events) {

            if (evt.type === "collab:message") {
              collabMessages.push({
                id: crypto.randomUUID(),
                authorName: (evt.payload.authorName as string) ?? "unknown",
                content: (evt.payload.content as string) ?? "",
                timestamp: evt.timestamp,
              })
            } else if (evt.type === "prompt:sent") {
              if (!localSid) continue
              const userMsgId = crypto.randomUUID()
              const content = (evt.payload.content as string) ?? ""
              const authorName = (evt.payload.authorName as string) ?? "unknown"
              deps.syncSet("message", produce((draft: Record<string, any[]>) => {
                if (!draft[localSid]) draft[localSid] = []
                draft[localSid].push({
                  id: userMsgId, sessionID: localSid, role: "user",
                  time: { created: evt.timestamp }, system: false, mode: "chat",
                })
              }))
              deps.syncSet("part", produce((draft: Record<string, any[]>) => {
                draft[userMsgId] = [{
                  id: `${userMsgId}-text`, sessionID: localSid, messageID: userMsgId,
                  type: "text", text: `\u{1F464} ${authorName}: ${content}`,
                }]
              }))
            } else if (evt.type === "agent:output" || evt.type === "agent:thinking") {
              if (!localSid) continue
              const evtMessageId = (evt.payload.messageId as string) ?? crypto.randomUUID()
              const content = (evt.payload.content as string) ?? ""
              const isThinking = evt.type === "agent:thinking"
              ensureAssistantMessage(localSid, evtMessageId)
              if (isThinking) {
                const partId = `${evtMessageId}-reasoning`
                deps.syncSet("part", produce((draft: Record<string, any[]>) => {
                  if (!draft[evtMessageId]) draft[evtMessageId] = []
                  const part = draft[evtMessageId].find((p: any) => p.id === partId)
                  if (part) { part.text += content }
                  else { draft[evtMessageId].push({ id: partId, sessionID: localSid, messageID: evtMessageId, type: "reasoning", text: content, time: { start: evt.timestamp } }) }
                }))
              } else {
                deps.syncSet("part", produce((draft: Record<string, any[]>) => {
                  if (!draft[evtMessageId]) draft[evtMessageId] = []
                  const textPart = draft[evtMessageId].find((p: any) => p.type === "text" && !p.synthetic)
                  if (textPart) { textPart.text += content }
                  else { draft[evtMessageId].push({ id: `${evtMessageId}-text`, sessionID: localSid, messageID: evtMessageId, type: "text", text: content }) }
                }))
              }
            } else if (evt.type === "agent:tool_use") {
              if (!localSid) continue
              const tp = evt.payload as { tool: string; input: unknown; partId: string; messageId?: string }
              const messageId = tp.messageId ?? crypto.randomUUID()
              ensureAssistantMessage(localSid, messageId)
              deps.syncSet("part", produce((draft: Record<string, any[]>) => {
                if (!draft[messageId]) draft[messageId] = []
                draft[messageId].push({
                  id: tp.partId, sessionID: localSid, messageID: messageId,
                  type: "tool", tool: tp.tool, callID: tp.partId,
                  state: { status: "running", input: tp.input, title: tp.tool, output: "", metadata: {}, time: { start: evt.timestamp } },
                })
              }))
            } else if (evt.type === "agent:tool_result") {
              const tp = evt.payload as { tool: string; output: unknown; metadata?: Record<string, unknown>; partId: string; status: "completed" | "error"; error?: string; messageId?: string }
              const messageId = tp.messageId
              if (!messageId) continue
              deps.syncSet("part", produce((draft: Record<string, any[]>) => {
                const parts = draft[messageId]
                if (!parts) return
                const toolPart = parts.find((p: any) => p.id === tp.partId)
                if (toolPart?.state) {
                  toolPart.state.status = tp.status === "completed" ? "completed" : "error"
                  toolPart.state.output = typeof tp.output === "string" ? tp.output : JSON.stringify(tp.output ?? "")
                  toolPart.state.title = tp.tool
                  if (tp.metadata) toolPart.state.metadata = tp.metadata
                  if (tp.error) toolPart.state.error = tp.error
                  toolPart.state.time = { ...toolPart.state.time, end: evt.timestamp }
                }
              }))
            } else if (evt.type === "agent:complete") {
              if (!localSid) continue
              const completedMsgId = (evt.payload.messageId as string) ?? ""
              if (!completedMsgId) continue
              deps.syncSet("message", produce((draft: Record<string, any[]>) => {
                const messages = draft[localSid]
                if (!messages) return
                const msg = messages.find((m: any) => m.id === completedMsgId)
                if (msg?.time) msg.time.completed = evt.timestamp
              }))
            }
          }

          if (collabMessages.length > 0) {
            deps.setMessages(produce((draft) => {
              draft.push(...collabMessages)
              while (draft.length > MAX_MESSAGES) draft.shift()
            }))
          }
        })
        break
      }
      case "session:error": {
        // Server rejected an action (e.g. non-host tried /qhost)
        // Logged silently — TUI command already shows client-side warnings
        break
      }
      case "session:kicked": {
        deps.setConnectionMessage("You were removed from this session")
        deps.setStatus("disconnected")
        break
      }
       case "plan:sync": {
         const update = data.payload.update as string
         if (update) {
           const binary = Uint8Array.from(atob(update), (c) => c.charCodeAt(0))
           Y.applyUpdate(deps.planDoc, binary)
         }
         break
       }
       case "queue:size": {
         const size = (data.payload.size as number) ?? 0
         deps.setOfflineQueueSize(size)
         break
       }
     }
   }
}
