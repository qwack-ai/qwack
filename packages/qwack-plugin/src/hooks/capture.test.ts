import { describe, test, expect } from "bun:test"
import { createPromptCaptureHook, createOutputCaptureHook, createPermissionHook } from "./capture"
import { createMockWsClient, mockContext } from "./test-helpers"
import type { WsMessage, PromptSentPayload, AgentOutputPayload, AgentPermissionPayload } from "@qwack/shared"

describe("createPromptCaptureHook", () => {
  test("sends prompt:sent event with correct payload", () => {
    const ws = createMockWsClient()
    const hook = createPromptCaptureHook(ws as any)
    const ctx = mockContext({ userName: "alice" })

    hook({ content: "add rate limiting", messageId: "msg-1" }, ctx)

    expect(ws._sent.length).toBe(1)
    const msg = ws._sent[0] as WsMessage<PromptSentPayload>
    expect(msg.type).toBe("prompt:sent")
    expect(msg.sessionId).toBe("ses-test-1")
    expect(msg.senderId).toBe("user-test-1")
    expect(msg.payload.content).toBe("add rate limiting")
    expect(msg.payload.authorName).toBe("alice")
    expect(msg.payload.authorId).toBe("user-test-1")
    expect(typeof msg.timestamp).toBe("number")
  })

  test("sends different prompts independently", () => {
    const ws = createMockWsClient()
    const hook = createPromptCaptureHook(ws as any)
    const ctx = mockContext()

    hook({ content: "first prompt", messageId: "msg-1" }, ctx)
    hook({ content: "second prompt", messageId: "msg-2" }, ctx)

    expect(ws._sent.length).toBe(2)
    expect((ws._sent[0].payload as PromptSentPayload).content).toBe("first prompt")
    expect((ws._sent[1].payload as PromptSentPayload).content).toBe("second prompt")
  })
})

describe("createOutputCaptureHook", () => {
  test("sends agent:output event with correct payload", () => {
    const ws = createMockWsClient()
    const hook = createOutputCaptureHook(ws as any)
    const ctx = mockContext()

    hook({ content: "Created file src/auth.ts", partId: "part-1", messageId: "msg-1" }, ctx)

    expect(ws._sent.length).toBe(1)
    const msg = ws._sent[0] as WsMessage<AgentOutputPayload>
    expect(msg.type).toBe("agent:output")
    expect(msg.sessionId).toBe("ses-test-1")
    expect(msg.payload.content).toBe("Created file src/auth.ts")
    expect(msg.payload.partId).toBe("part-1")
  })

  test("sends multiple output chunks", () => {
    const ws = createMockWsClient()
    const hook = createOutputCaptureHook(ws as any)
    const ctx = mockContext()

    hook({ content: "chunk 1", partId: "p1", messageId: "m1" }, ctx)
    hook({ content: "chunk 2", partId: "p2", messageId: "m1" }, ctx)
    hook({ content: "chunk 3", partId: "p3", messageId: "m1" }, ctx)

    expect(ws._sent.length).toBe(3)
    expect((ws._sent[2].payload as AgentOutputPayload).partId).toBe("p3")
  })
})

describe("createPermissionHook", () => {
  test("sends agent:permission event with correct payload", () => {
    const ws = createMockWsClient()
    const hook = createPermissionHook(ws as any)
    const ctx = mockContext()

    hook({ tool: "bash", command: "rm -rf /tmp/test", requestId: "req-1" }, ctx)

    expect(ws._sent.length).toBe(1)
    const msg = ws._sent[0] as WsMessage<AgentPermissionPayload>
    expect(msg.type).toBe("agent:permission")
    expect(msg.sessionId).toBe("ses-test-1")
    expect(msg.payload.tool).toBe("bash")
    expect(msg.payload.command).toBe("rm -rf /tmp/test")
    expect(msg.payload.requestId).toBe("req-1")
  })

  test("sends permissions with different tools", () => {
    const ws = createMockWsClient()
    const hook = createPermissionHook(ws as any)
    const ctx = mockContext()

    hook({ tool: "bash", command: "ls", requestId: "r1" }, ctx)
    hook({ tool: "write", command: "src/index.ts", requestId: "r2" }, ctx)

    expect(ws._sent.length).toBe(2)
    expect((ws._sent[0].payload as AgentPermissionPayload).tool).toBe("bash")
    expect((ws._sent[1].payload as AgentPermissionPayload).tool).toBe("write")
  })
})
