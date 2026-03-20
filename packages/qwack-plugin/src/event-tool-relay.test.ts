import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { WsMessage, AgentToolUsePayload, AgentToolResultPayload } from "@qwack/shared"

const wsSent: WsMessage[] = []

const mockWsClient = {
  send: (msg: WsMessage) => wsSent.push(msg),
  on: () => {},
  off: () => {},
  connect: () => {},
  disconnect: () => {},
  isConnected: true,
}

mock.module("./bridge", () => ({
  QwackBridge: class {
    isActive = true
    getWsClient() { return mockWsClient }
    getSessionId() { return "ses-test-1" }
    getUserId() { return "user-test-1" }
    getCollaboratorState() { return null }
    getHooks() { return { tools: {}, promptCapture: null, outputCapture: null, permission: null, systemInject: null, messageInject: null, compactionInject: null } }
    getCommandContext() { return {} }
    start() {}
    stop() {}
    waitForReady() { return Promise.resolve() }
  },
}))

mock.module("./auth/store", () => ({
  readConfig: () => null,
}))

import QwackPlugin from "./plugin"

async function getEventHandler() {
  const plugin = await (QwackPlugin as any)({})
  return plugin.event as (input: { event: { type: string; properties: Record<string, unknown> } }) => Promise<void>
}

function toolPartEvent(id: string, tool: string, status: string, extra?: { input?: unknown; output?: string; error?: string; messageID?: string }) {
  return {
    event: {
      type: "message.part.updated",
      properties: {
        part: {
          id,
          type: "tool",
          tool,
          state: { status, ...extra },
          messageID: extra?.messageID,
        },
      },
    },
  }
}

function messageCompletedEvent(messageId: string) {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: { id: messageId, role: "assistant", time: { completed: new Date().toISOString() } },
      },
    },
  }
}

describe("event handler — tool state relay", () => {
  beforeEach(() => {
    wsSent.length = 0
  })

  test("emits agent:tool_use when tool transitions to running", async () => {
    const handler = await getEventHandler()

    await handler(toolPartEvent("part-1", "bash", "running", { input: { command: "ls" }, messageID: "msg-1" }))

    expect(wsSent.length).toBe(1)
    const msg = wsSent[0]
    expect(msg.type).toBe("agent:tool_use")
    expect(msg.sessionId).toBe("ses-test-1")
    expect(msg.senderId).toBe("user-test-1")
    const payload = msg.payload as AgentToolUsePayload
    expect(payload.tool).toBe("bash")
    expect(payload.input).toEqual({ command: "ls" })
    expect(payload.partId).toBe("part-1")
    expect(payload.messageId).toBe("msg-1")
  })

  test("emits agent:tool_result when tool transitions to completed", async () => {
    const handler = await getEventHandler()

    await handler(toolPartEvent("part-2", "read", "running", { input: { file: "a.ts" }, messageID: "msg-2" }))
    wsSent.length = 0

    await handler(toolPartEvent("part-2", "read", "completed", { output: "file contents here", messageID: "msg-2" }))

    expect(wsSent.length).toBe(1)
    const msg = wsSent[0]
    expect(msg.type).toBe("agent:tool_result")
    const payload = msg.payload as AgentToolResultPayload
    expect(payload.tool).toBe("read")
    expect(payload.output).toBe("file contents here")
    expect(payload.partId).toBe("part-2")
    expect(payload.messageId).toBe("msg-2")
    expect(payload.status).toBe("completed")
    expect(payload.error).toBeUndefined()
  })

  test("emits agent:tool_result with error when tool transitions to error", async () => {
    const handler = await getEventHandler()

    await handler(toolPartEvent("part-3", "bash", "running", { input: { command: "bad" }, messageID: "msg-3" }))
    wsSent.length = 0

    await handler(toolPartEvent("part-3", "bash", "error", { error: "command failed", messageID: "msg-3" }))

    expect(wsSent.length).toBe(1)
    const msg = wsSent[0]
    expect(msg.type).toBe("agent:tool_result")
    const payload = msg.payload as AgentToolResultPayload
    expect(payload.tool).toBe("bash")
    expect(payload.output).toBe("")
    expect(payload.status).toBe("error")
    expect(payload.error).toBe("command failed")
  })

  test("deduplicates — same status twice emits only once", async () => {
    const handler = await getEventHandler()

    await handler(toolPartEvent("part-4", "write", "running", { input: {} }))
    await handler(toolPartEvent("part-4", "write", "running", { input: {} }))

    const toolUseMessages = wsSent.filter(m => m.type === "agent:tool_use")
    expect(toolUseMessages.length).toBe(1)
  })

  test("full transition: pending → running → completed emits tool_use then tool_result", async () => {
    const handler = await getEventHandler()

    await handler(toolPartEvent("part-5", "edit", "pending", { messageID: "msg-5" }))
    expect(wsSent.length).toBe(0)

    await handler(toolPartEvent("part-5", "edit", "running", { input: { file: "x.ts" }, messageID: "msg-5" }))
    expect(wsSent.length).toBe(1)
    expect(wsSent[0].type).toBe("agent:tool_use")

    await handler(toolPartEvent("part-5", "edit", "completed", { output: "edited", messageID: "msg-5" }))
    expect(wsSent.length).toBe(2)
    expect(wsSent[1].type).toBe("agent:tool_result")
    expect((wsSent[1].payload as AgentToolResultPayload).status).toBe("completed")
  })

  test("agent:complete clears toolStates — allows re-emission on next message", async () => {
    const handler = await getEventHandler()

    await handler(toolPartEvent("part-6", "bash", "running", { input: {} }))
    expect(wsSent.filter(m => m.type === "agent:tool_use").length).toBe(1)

    await handler(messageCompletedEvent("msg-done"))
    wsSent.length = 0

    await handler(toolPartEvent("part-6", "bash", "running", { input: {} }))
    expect(wsSent.filter(m => m.type === "agent:tool_use").length).toBe(1)
  })

  test("does not emit for non-tool part types", async () => {
    const handler = await getEventHandler()

    await handler({
      event: {
        type: "message.part.updated",
        properties: {
          part: { id: "part-text", type: "text", text: "hello" },
        },
      },
    })

    const toolMessages = wsSent.filter(m => m.type === "agent:tool_use" || m.type === "agent:tool_result")
    expect(toolMessages.length).toBe(0)
  })

  test("error without explicit error message uses fallback", async () => {
    const handler = await getEventHandler()

    await handler(toolPartEvent("part-7", "bash", "running", { input: {} }))
    wsSent.length = 0

    await handler(toolPartEvent("part-7", "bash", "error", {}))

    expect(wsSent.length).toBe(1)
    const payload = wsSent[0].payload as AgentToolResultPayload
    expect(payload.error).toBe("Unknown error")
  })

  test("input defaults to empty object when not provided", async () => {
    const handler = await getEventHandler()

    await handler(toolPartEvent("part-8", "bash", "running", {}))

    expect(wsSent.length).toBe(1)
    const payload = wsSent[0].payload as AgentToolUsePayload
    expect(payload.input).toEqual({})
  })
})
