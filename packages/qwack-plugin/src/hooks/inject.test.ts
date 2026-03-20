import { describe, it, test, expect, beforeEach } from "bun:test"
import { createSystemInjectHook, createMessageInjectHook, createCompactionInjectHook } from "./inject"
import { CollaboratorState } from "../state/collaborator-state"

type MessagePart = { id: string; messageID: string; sessionID: string; type: string; synthetic?: boolean; text?: string; [key: string]: unknown }

// ── System inject ──────────────────────────────

describe("createSystemInjectHook", () => {
  let state: CollaboratorState

  beforeEach(() => {
    state = new CollaboratorState()
  })

  it("returns a function", () => {
    const hook = createSystemInjectHook(state)
    expect(typeof hook).toBe("function")
  })

  it("pushes formatted context to output.system when collaborators are present", async () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const hook = createSystemInjectHook(state)

    const input = { sessionID: "test-session", model: { providerID: "test", modelID: "test" } }
    const output = { system: ["existing system prompt"] }

    await hook(input, output)

    expect(output.system.length).toBe(2)
    expect(output.system[0]).toBe("existing system prompt")
    expect(output.system[1]).toContain("Collaborative Session")
    expect(output.system[1]).toContain("alice (host)")
  })

  it("does NOT push to output.system when no collaborators", async () => {
    const hook = createSystemInjectHook(state)

    const input = { sessionID: "test-session", model: { providerID: "test", modelID: "test" } }
    const output = { system: ["existing system prompt"] }

    await hook(input, output)

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toBe("existing system prompt")
  })

  it("preserves existing system array entries (push, not replace)", async () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const hook = createSystemInjectHook(state)

    const input = { sessionID: "test-session", model: { providerID: "test", modelID: "test" } }
    const output = { system: ["prompt1", "prompt2", "prompt3"] }

    await hook(input, output)

    expect(output.system.length).toBe(4)
    expect(output.system[0]).toBe("prompt1")
    expect(output.system[1]).toBe("prompt2")
    expect(output.system[2]).toBe("prompt3")
    expect(output.system[3]).toContain("Collaborative Session")
  })

  it("works with multiple LLM calls (hook can be called multiple times)", async () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const hook = createSystemInjectHook(state)

    // First call
    const input1 = { sessionID: "test-session", model: { providerID: "test", modelID: "test" } }
    const output1 = { system: ["system1"] }
    await hook(input1, output1)

    // Second call
    const input2 = { sessionID: "test-session", model: { providerID: "test", modelID: "test" } }
    const output2 = { system: ["system2"] }
    await hook(input2, output2)

    expect(output1.system.length).toBe(2)
    expect(output2.system.length).toBe(2)
    expect(output1.system[1]).toContain("Collaborative Session")
    expect(output2.system[1]).toContain("Collaborative Session")
  })

  it("includes messages in the system prompt when present", async () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addPresence({ id: "u2", name: "bob", role: "collaborator" })
    state.addMessage("alice", "should we add rate limiting?")
    state.addMessage("bob", "yes, 100 req/min")

    const hook = createSystemInjectHook(state)

    const input = { sessionID: "test-session", model: { providerID: "test", modelID: "test" } }
    const output = { system: [] }

    await hook(input, output)

    expect(output.system.length).toBe(1)
    const context = output.system[0]
    expect(context).toContain("Collaborative Session")
    expect(context).toContain("alice (host)")
    expect(context).toContain("bob (collaborator)")
    expect(context).toContain("Recent Team Discussion")
    expect(context).toContain('alice: "should we add rate limiting?"')
    expect(context).toContain('bob: "yes, 100 req/min"')
  })
})

// ── Message inject ─────────────────────────────

describe("createMessageInjectHook", () => {
  let state: CollaboratorState

  beforeEach(() => {
    state = new CollaboratorState()
  })

  test("returns a function", () => {
    const hook = createMessageInjectHook(state)
    expect(typeof hook).toBe("function")
  })

  test("injects a synthetic text part when unprocessed messages exist", async () => {
    state.addPresence({ id: "user-1", name: "sarah", role: "collaborator" })
    state.addMessage("sarah", "should we add rate limiting?")

    const hook = createMessageInjectHook(state)
    const input = {
      sessionID: "test-session",
      agent: "default",
      model: { providerID: "test", modelID: "test" },
      messageID: "msg-123",
    }
    const output = {
      message: { id: "msg-123", role: "user" as const, sessionID: "test-session" },
      parts: [] as MessagePart[],
    }

    await hook(input, output)

    expect(output.parts.length).toBe(1)
  })

  test("injected part has type 'text' and synthetic true", async () => {
    state.addPresence({ id: "user-1", name: "alice", role: "host" })
    state.addMessage("alice", "test message")

    const hook = createMessageInjectHook(state)
    const input = {
      sessionID: "test-session",
      agent: "default",
      model: { providerID: "test", modelID: "test" },
      messageID: "msg-456",
    }
    const output = {
      message: { id: "msg-456", role: "user" as const, sessionID: "test-session" },
      parts: [] as MessagePart[],
    }

    await hook(input, output)

    const part = output.parts[0]
    expect(part.type).toBe("text")
    expect(part.synthetic).toBe(true)
  })

  test("injected part has correct messageID and sessionID", async () => {
    state.addPresence({ id: "user-1", name: "bob", role: "collaborator" })
    state.addMessage("bob", "hello team")

    const hook = createMessageInjectHook(state)
    const input = {
      sessionID: "my-session-789",
      agent: "default",
      model: { providerID: "test", modelID: "test" },
      messageID: "msg-xyz",
    }
    const output = {
      message: { id: "msg-xyz", role: "user" as const, sessionID: "my-session-789" },
      parts: [] as MessagePart[],
    }

    await hook(input, output)

    const part = output.parts[0]
    expect(part.messageID).toBe("msg-xyz")
    expect(part.sessionID).toBe("my-session-789")
  })

  test("injected part id is a valid ULID (26 chars, uppercase alphanumeric)", async () => {
    state.addPresence({ id: "user-1", name: "charlie", role: "collaborator" })
    state.addMessage("charlie", "test")

    const hook = createMessageInjectHook(state)
    const input = {
      sessionID: "test-session",
      agent: "default",
      model: { providerID: "test", modelID: "test" },
      messageID: "msg-001",
    }
    const output = {
      message: { id: "msg-001", role: "user" as const, sessionID: "test-session" },
      parts: [] as MessagePart[],
    }

    await hook(input, output)

    const part = output.parts[0]
    expect(typeof part.id).toBe("string")
    expect(part.id.length).toBe(26)
    expect(/^[0-9A-Z]+$/.test(part.id)).toBe(true)
  })

  test("does not inject when no unprocessed messages", async () => {
    state.addPresence({ id: "user-1", name: "dave", role: "collaborator" })
    state.addMessage("dave", "first message")
    state.markMessagesProcessed()

    const hook = createMessageInjectHook(state)
    const input = {
      sessionID: "test-session",
      agent: "default",
      model: { providerID: "test", modelID: "test" },
      messageID: "msg-002",
    }
    const output = {
      message: { id: "msg-002", role: "user" as const, sessionID: "test-session" },
      parts: [] as MessagePart[],
    }

    await hook(input, output)

    expect(output.parts.length).toBe(0)
  })

  test("marks messages as processed after injection (second call produces nothing)", async () => {
    state.addPresence({ id: "user-1", name: "eve", role: "collaborator" })
    state.addMessage("eve", "message 1")

    const hook = createMessageInjectHook(state)
    const input = {
      sessionID: "test-session",
      agent: "default",
      model: { providerID: "test", modelID: "test" },
      messageID: "msg-003",
    }
    const output1 = {
      message: { id: "msg-003", role: "user" as const, sessionID: "test-session" },
      parts: [] as MessagePart[],
    }

    await hook(input, output1)
    expect(output1.parts.length).toBe(1)

    const output2 = {
      message: { id: "msg-004", role: "user" as const, sessionID: "test-session" },
      parts: [] as MessagePart[],
    }

    await hook(input, output2)
    expect(output2.parts.length).toBe(0)
  })
})

// ── Compaction inject ──────────────────────────

describe("createCompactionInjectHook", () => {
  let state: CollaboratorState

  beforeEach(() => {
    state = new CollaboratorState()
  })

  it("returns a function", () => {
    const hook = createCompactionInjectHook(state)
    expect(typeof hook).toBe("function")
  })

  it("pushes formatted compaction context to output.context when state has data", async () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const hook = createCompactionInjectHook(state)

    const input = { sessionID: "test-session" }
    const output = { context: ["existing context"] }

    await hook(input, output)

    expect(output.context.length).toBe(2)
    expect(output.context[0]).toBe("existing context")
    expect(output.context[1]).toContain("Qwack session with")
  })

  it("includes session title in compaction context", async () => {
    state.setSessionTitle("Refactor auth module")
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const hook = createCompactionInjectHook(state)

    const input = { sessionID: "test-session" }
    const output = { context: [] }

    await hook(input, output)

    expect(output.context[0]).toContain('Session: "Refactor auth module"')
  })

  it("includes collaborator list in compaction context", async () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addPresence({ id: "u2", name: "bob", role: "collaborator" })
    const hook = createCompactionInjectHook(state)

    const input = { sessionID: "test-session" }
    const output = { context: [] }

    await hook(input, output)

    expect(output.context[0]).toContain("alice (host)")
    expect(output.context[0]).toContain("bob (collaborator)")
  })

  it("includes recent messages in compaction context", async () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addMessage("alice", "should we add rate limiting?")
    state.addMessage("bob", "yes, 100 req/min per user")
    const hook = createCompactionInjectHook(state)

    const input = { sessionID: "test-session" }
    const output = { context: [] }

    await hook(input, output)

    expect(output.context[0]).toContain("Recent team discussion")
    expect(output.context[0]).toContain("should we add rate limiting?")
    expect(output.context[0]).toContain("100 req/min per user")
  })

  it("always pushes context even with empty state (shows 'none' for collaborators)", async () => {
    const hook = createCompactionInjectHook(state)

    const input = { sessionID: "test-session" }
    const output = { context: ["existing"] }

    await hook(input, output)

    expect(output.context.length).toBe(2)
    expect(output.context[1]).toContain("Qwack session with none")
  })

  it("preserves existing context entries (push, not replace)", async () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const hook = createCompactionInjectHook(state)

    const input = { sessionID: "test-session" }
    const output = { context: ["context1", "context2", "context3"] }

    await hook(input, output)

    expect(output.context.length).toBe(4)
    expect(output.context[0]).toBe("context1")
    expect(output.context[1]).toBe("context2")
    expect(output.context[2]).toBe("context3")
    expect(output.context[3]).toContain("Qwack session with")
  })
})
