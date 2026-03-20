import {
  registerHandler,
  registerConnectionHandler,
  clearHandlerRegistrations,
  getHostUserId,
  broadcastToSession,
  sendToUser,
  setUserRole,
  setWsRepo,
} from "./handler"
import { handlePresenceTyping } from "./presence"
import { handleCollabMessage } from "./messages"
import { handlePromptSent, handlePromptRequest, flushBufferedPrompts } from "./prompts"
import { handleAgentEvent, ALL_AGENT_EVENT_TYPES } from "./agent-relay"
import { handlePlanSync, handlePlanAwareness, getOrCreateDoc } from "./plan-sync"
import { bufferEvent, getReplayHistory, setContextSnapshot, getContextSnapshot, initEventStore } from "./event-store"
import type { IRepository } from "../repo/types"
import * as Y from "yjs"

export function registerWsHandlers(repo?: IRepository): void {
  if (repo) {
    initEventStore(repo)
    setWsRepo(repo)
  }
  clearHandlerRegistrations()
  // Presence
  registerHandler("presence:typing", (sid, uid, payload) => {
    handlePresenceTyping(sid, uid, payload)
  })

  // Collaborator messages (buffer + relay)
  registerHandler("collab:message", (sid, uid, payload) => {
    bufferEvent(sid, {
      type: "collab:message",
      senderId: uid,
      timestamp: Date.now(),
      payload: payload as Record<string, unknown>,
    })
    handleCollabMessage(sid, uid, payload)
  })

  // Prompts (buffer + relay)
  registerHandler("prompt:sent", (sid, uid, payload) => {
    bufferEvent(sid, {
      type: "prompt:sent",
      senderId: uid,
      timestamp: Date.now(),
      payload: payload as Record<string, unknown>,
    })
    handlePromptSent(sid, uid, payload)
  })
  registerHandler("prompt:request", (sid, uid, payload) => {
    handlePromptRequest(sid, uid, payload)
  })

  // Agent events (buffer + relay)
  for (const eventType of ALL_AGENT_EVENT_TYPES) {
    registerHandler(eventType, (sid, uid, payload) => {
      bufferEvent(sid, {
        type: eventType,
        senderId: uid,
        timestamp: Date.now(),
        payload: payload as Record<string, unknown>,
      })
      handleAgentEvent(sid, uid, eventType, payload)
    })
  }

  // Host handoff
  registerHandler("session:host_change", (sid, uid, payload) => {
    const { newHostId } = payload as { newHostId: string }
    // Only current host can hand off
    const currentHost = getHostUserId(sid)
    if (currentHost !== uid) {
      sendToUser(sid, uid, {
        type: "session:error",
        sessionId: sid,
        senderId: "system",
        timestamp: Date.now(),
        payload: { code: "NOT_HOST", message: "Only the host can transfer the host role" },
      })
      return
    }
    // Update roles in session metadata
    setUserRole(sid, uid, "collaborator")
    setUserRole(sid, newHostId, "host")
    // Broadcast to all clients
    broadcastToSession(sid, {
      type: "session:host_change",
      sessionId: sid,
      senderId: uid,
      timestamp: Date.now(),
      payload: { newHostId },
    })
    // Flush any buffered prompts to the new host
    flushBufferedPrompts(sid, newHostId)
  })

  // Context snapshot (plugin sends after agent:complete)
  registerHandler("session:context_snapshot", (sid, _uid, payload) => {
    const { snapshot } = payload as { snapshot: string }
    if (snapshot) setContextSnapshot(sid, snapshot)
  })

  registerHandler("plan:sync", (sid, uid, payload) => {
    handlePlanSync(sid, uid, payload)
  })
  registerHandler("plan:awareness", (sid, uid, payload) => {
    handlePlanAwareness(sid, uid, payload)
  })

  // On connect: send event history + plan state, flush buffered prompts if host
  registerConnectionHandler(async (sessionId, userId, ws) => {
    // Replay buffered events (prompts, collab messages, agent output)
    const history = await getReplayHistory(sessionId)
    if (history.length > 0) {
      try {
        ws.send(
          JSON.stringify({
            type: "session:history",
            sessionId,
            senderId: "system",
            timestamp: Date.now(),
            payload: { events: history },
          }),
        )
      } catch {
        /* client may have disconnected */
      }
    }

    // Flush buffered prompts if this is the host reconnecting
    const hostUserId = getHostUserId(sessionId)
    if (hostUserId === userId) {
      // Send context snapshot FIRST (agent needs context before processing queued prompts)
      const snapshot = await getContextSnapshot(sessionId)
      if (snapshot) {
        try {
          ws.send(
            JSON.stringify({
              type: "session:context_snapshot",
              sessionId,
              senderId: "system",
              timestamp: Date.now(),
              payload: { snapshot, timestamp: Date.now() },
            }),
          )
        } catch {
          /* client may have disconnected */
        }
      }
      // THEN flush buffered prompts
      flushBufferedPrompts(sessionId, userId)
    }

    // Send full plan state
    const doc = getOrCreateDoc(sessionId)
    const state = Y.encodeStateAsUpdate(doc)
    if (state.length <= 2) return // empty doc, skip

    const base64 = btoa(String.fromCharCode(...state))
    try {
      ws.send(
        JSON.stringify({
          type: "plan:sync",
          sessionId,
          senderId: "system",
          timestamp: Date.now(),
          payload: { update: base64 },
        }),
      )
    } catch {
      /* client may have disconnected */
    }
  })
}
