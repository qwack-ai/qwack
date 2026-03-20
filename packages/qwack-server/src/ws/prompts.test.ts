import { describe, test, expect, beforeEach } from "bun:test"
import { clearAllConnections, getSessionConnections, setUserMeta } from "./handler"
import {
  handlePromptSent,
  handlePromptRequest,
  getBufferedPromptCount,
  flushBufferedPrompts,
  clearPromptBuffer,
} from "./prompts"
import { createMockWs } from "./ws-test-utils"

describe("Prompt Relay", () => {
  beforeEach(() => {
    clearAllConnections()
    clearPromptBuffer("session-1")
  })

  test("handlePromptSent broadcasts to others, excludes sender", () => {
    const hostReceived: string[] = []
    const collabReceived: string[] = []
    const room = getSessionConnections("session-1")
    room.set("host", [createMockWs(hostReceived)])
    room.set("collab", [createMockWs(collabReceived)])
    setUserMeta("session-1", "host", { id: "host", name: "alice", role: "host" })
    setUserMeta("session-1", "collab", { id: "collab", name: "sarah", role: "collaborator" })

    handlePromptSent("session-1", "host", {
      authorId: "host",
      authorName: "alice",
      content: "add auth module",
    })

    expect(hostReceived).toHaveLength(0) // excluded
    expect(collabReceived).toHaveLength(1)
    const msg = JSON.parse(collabReceived[0])
    expect(msg.type).toBe("prompt:sent")
    expect(msg.payload.content).toBe("add auth module")
  })

  test("handlePromptRequest relays to host only", () => {
    const hostReceived: string[] = []
    const collabReceived: string[] = []
    const room = getSessionConnections("session-1")
    room.set("host", [createMockWs(hostReceived)])
    room.set("collab", [createMockWs(collabReceived)])
    setUserMeta("session-1", "host", { id: "host", name: "alice", role: "host" })
    setUserMeta("session-1", "collab", { id: "collab", name: "sarah", role: "collaborator" })

    handlePromptRequest("session-1", "collab", {
      authorId: "collab",
      authorName: "sarah",
      content: "add rate limiting",
    })

    // Host gets prompt:execute
    const hostMsgs = hostReceived.map((d) => JSON.parse(d))
    const executeMsg = hostMsgs.find((m: { type: string }) => m.type === "prompt:execute")
    expect(executeMsg).toBeDefined()
    expect(executeMsg.payload.content).toBe("add rate limiting")
    expect(executeMsg.payload.requestedBy).toBe("collab")

    // Collab does NOT get prompt:execute (but may get prompt:sent broadcast)
    const collabMsgs = collabReceived.map((d) => JSON.parse(d))
    const collabExecute = collabMsgs.find((m: { type: string }) => m.type === "prompt:execute")
    expect(collabExecute).toBeUndefined()
  })

  test("handlePromptRequest buffers when host not connected", () => {
    // No connections at all — host is offline
    expect(getBufferedPromptCount("session-1")).toBe(0)

    handlePromptRequest("session-1", "collab", {
      authorId: "collab",
      authorName: "sarah",
      content: "buffered prompt",
    })

    expect(getBufferedPromptCount("session-1")).toBe(1)
  })

  test("flushBufferedPrompts delivers to host", () => {
    // Buffer some prompts while host is offline
    handlePromptRequest("session-1", "collab", {
      authorId: "collab",
      authorName: "sarah",
      content: "first buffered",
    })
    handlePromptRequest("session-1", "collab", {
      authorId: "collab",
      authorName: "sarah",
      content: "second buffered",
    })
    expect(getBufferedPromptCount("session-1")).toBe(2)

    // Driver reconnects
    const hostReceived: string[] = []
    const room = getSessionConnections("session-1")
    room.set("host", [createMockWs(hostReceived)])
    setUserMeta("session-1", "host", { id: "host", name: "alice", role: "host" })

    flushBufferedPrompts("session-1", "host")

    expect(hostReceived).toHaveLength(2)
    const msgs = hostReceived.map((d) => JSON.parse(d))
    expect(msgs[0].payload.content).toBe("first buffered")
    expect(msgs[1].payload.content).toBe("second buffered")
    expect(getBufferedPromptCount("session-1")).toBe(0)
  })

  test("handlePromptRequest broadcasts prompt:sent to other collaborators", () => {
    const hostReceived: string[] = []
    const collab2Received: string[] = []
    const room = getSessionConnections("session-1")
    room.set("host", [createMockWs(hostReceived)])
    room.set("collab2", [createMockWs(collab2Received)])
    setUserMeta("session-1", "host", { id: "host", name: "alice", role: "host" })
    setUserMeta("session-1", "collab2", { id: "collab2", name: "mike", role: "collaborator" })

    handlePromptRequest("session-1", "collab1", {
      authorId: "collab1",
      authorName: "sarah",
      content: "shared prompt",
    })

    // collab2 should see prompt:sent (not prompt:execute)
    const collab2Msgs = collab2Received.map((d) => JSON.parse(d))
    const sentMsg = collab2Msgs.find((m: { type: string }) => m.type === "prompt:sent")
    expect(sentMsg).toBeDefined()
    expect(sentMsg.payload.content).toBe("shared prompt")
  })
})
