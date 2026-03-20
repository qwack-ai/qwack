import { describe, test, expect, beforeEach } from "bun:test"
import { bufferEvent, getReplayHistory, clearAllBuffers, setContextSnapshot, getContextSnapshot, clearContextSnapshot, aggregateEvents, type BufferedEvent } from "./event-buffer"

describe("EventBuffer", () => {
  beforeEach(() => clearAllBuffers())

  function makeEvent(type: string, payload: Record<string, unknown> = {}): BufferedEvent {
    return { type, senderId: "user1", timestamp: Date.now(), payload }
  }

  test("buffers and replays collab:message events", () => {
    bufferEvent("s1", makeEvent("collab:message", { authorName: "Alice", content: "hello" }))
    bufferEvent("s1", makeEvent("collab:message", { authorName: "Bob", content: "hi" }))
    const history = getReplayHistory("s1")
    expect(history).toHaveLength(2)
    expect(history[0].payload.authorName).toBe("Alice")
    expect(history[1].payload.authorName).toBe("Bob")
  })

  test("buffers and replays prompt:sent events", () => {
    bufferEvent("s1", makeEvent("prompt:sent", { content: "fix the bug", authorName: "Alice" }))
    const history = getReplayHistory("s1")
    expect(history).toHaveLength(1)
    expect(history[0].payload.content).toBe("fix the bug")
  })

  test("ignores non-buffered event types", () => {
    bufferEvent("s1", makeEvent("presence:join", {}))
    bufferEvent("s1", makeEvent("ping", {}))
    bufferEvent("s1", makeEvent("plan:sync", {}))
    expect(getReplayHistory("s1")).toHaveLength(0)
  })

  test("aggregates agent:output deltas into complete messages", () => {
    bufferEvent("s1", makeEvent("agent:output", { content: "Hello ", messageId: "m1" }))
    bufferEvent("s1", makeEvent("agent:output", { content: "world!", messageId: "m1" }))
    bufferEvent("s1", makeEvent("agent:complete", { messageId: "m1" }))

    const history = getReplayHistory("s1")
    // aggregated output + complete event
    expect(history).toHaveLength(2)
    expect(history[0].type).toBe("agent:output")
    expect(history[0].payload.content).toBe("Hello world!")
    expect(history[0].payload.complete).toBe(true)
    expect(history[1].type).toBe("agent:complete")
  })

  test("aggregates agent:thinking deltas separately from output", () => {
    bufferEvent("s1", makeEvent("agent:thinking", { content: "Let me ", messageId: "m1" }))
    bufferEvent("s1", makeEvent("agent:thinking", { content: "think...", messageId: "m1" }))
    bufferEvent("s1", makeEvent("agent:output", { content: "Here's the fix", messageId: "m1" }))
    bufferEvent("s1", makeEvent("agent:complete", { messageId: "m1" }))

    const history = getReplayHistory("s1")
    expect(history).toHaveLength(3) // thinking + output + complete
    expect(history[0].type).toBe("agent:thinking")
    expect(history[0].payload.content).toBe("Let me think...")
    expect(history[1].type).toBe("agent:output")
    expect(history[1].payload.content).toBe("Here's the fix")
    expect(history[2].type).toBe("agent:complete")
  })

  test("preserves ordering: collab messages interleaved with agent output", () => {
    bufferEvent("s1", makeEvent("prompt:sent", { content: "fix bug", authorName: "Alice" }))
    bufferEvent("s1", makeEvent("agent:output", { content: "On it", messageId: "m1" }))
    bufferEvent("s1", makeEvent("collab:message", { authorName: "Bob", content: "nice!" }))
    bufferEvent("s1", makeEvent("agent:complete", { messageId: "m1" }))

    const history = getReplayHistory("s1")
    expect(history).toHaveLength(4)
    expect(history[0].type).toBe("prompt:sent")
    // agent output flushed before collab message (preserves order)
    expect(history[1].type).toBe("agent:output")
    expect(history[1].payload.content).toBe("On it")
    expect(history[2].type).toBe("collab:message")
    expect(history[3].type).toBe("agent:complete")
  })

  test("returns empty for unknown session", () => {
    expect(getReplayHistory("nonexistent")).toHaveLength(0)
  })

  test("flushes still-streaming content at end of replay", () => {
    // Agent is still streaming when joiner connects
    bufferEvent("s1", makeEvent("agent:output", { content: "partial...", messageId: "m1" }))
    const history = getReplayHistory("s1")
    expect(history).toHaveLength(1)
    expect(history[0].payload.content).toBe("partial...")
    expect(history[0].payload.complete).toBe(true) // marked complete for replay
  })

  test("separates events by session", () => {
    bufferEvent("s1", makeEvent("collab:message", { authorName: "Alice", content: "in s1" }))
    bufferEvent("s2", makeEvent("collab:message", { authorName: "Bob", content: "in s2" }))
    expect(getReplayHistory("s1")).toHaveLength(1)
    expect(getReplayHistory("s2")).toHaveLength(1)
    expect(getReplayHistory("s1")[0].payload.content).toBe("in s1")
  })

  test("buffers and replays agent:tool_use events", () => {
    bufferEvent("s1", makeEvent("agent:tool_use", { tool: "bash", input: "ls -la" }))
    const history = getReplayHistory("s1")
    expect(history).toHaveLength(1)
    expect(history[0].type).toBe("agent:tool_use")
    expect(history[0].payload.tool).toBe("bash")
    expect(history[0].payload.input).toBe("ls -la")
  })

  test("buffers and replays agent:tool_result events", () => {
    bufferEvent("s1", makeEvent("agent:tool_result", { tool: "bash", output: "total 42\ndrwxr-xr-x" }))
    const history = getReplayHistory("s1")
    expect(history).toHaveLength(1)
    expect(history[0].type).toBe("agent:tool_result")
    expect(history[0].payload.tool).toBe("bash")
    expect(history[0].payload.output).toBe("total 42\ndrwxr-xr-x")
  })
})

describe("aggregateEvents (pure function)", () => {
  function makeEvent(type: string, payload: Record<string, unknown> = {}): BufferedEvent {
    return { type, senderId: "user1", timestamp: Date.now(), payload }
  }

  test("empty array returns empty array", () => {
    const result = aggregateEvents([])
    expect(result).toHaveLength(0)
  })

  test("array with only collab:message events passes through unchanged", () => {
    const events = [
      makeEvent("collab:message", { authorName: "Alice", content: "hello" }),
      makeEvent("collab:message", { authorName: "Bob", content: "hi" }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(2)
    expect(result[0].payload.authorName).toBe("Alice")
    expect(result[1].payload.authorName).toBe("Bob")
  })

  test("agent:output chunks with same messageId are merged, then flushed on agent:complete", () => {
    const events = [
      makeEvent("agent:output", { content: "Hello ", messageId: "m1" }),
      makeEvent("agent:output", { content: "world!", messageId: "m1" }),
      makeEvent("agent:complete", { messageId: "m1" }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe("agent:output")
    expect(result[0].payload.content).toBe("Hello world!")
    expect(result[0].payload.complete).toBe(true)
    expect(result[1].type).toBe("agent:complete")
  })

  test("interleaved collab and agent events preserves ordering", () => {
    const events = [
      makeEvent("collab:message", { authorName: "Alice", content: "start" }),
      makeEvent("agent:output", { content: "chunk1", messageId: "m1" }),
      makeEvent("agent:output", { content: "chunk2", messageId: "m1" }),
      makeEvent("collab:message", { authorName: "Bob", content: "nice!" }),
      makeEvent("agent:complete", { messageId: "m1" }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(4)
    expect(result[0].type).toBe("collab:message")
    expect(result[0].payload.content).toBe("start")
    // agent output flushed before collab message
    expect(result[1].type).toBe("agent:output")
    expect(result[1].payload.content).toBe("chunk1chunk2")
    expect(result[2].type).toBe("collab:message")
    expect(result[2].payload.content).toBe("nice!")
    expect(result[3].type).toBe("agent:complete")
  })
})

describe("context snapshots", () => {
  beforeEach(() => clearAllBuffers())

  test("setContextSnapshot stores snapshot for session", () => {
    setContextSnapshot("s1", "snapshot text")
    expect(getContextSnapshot("s1")).toBe("snapshot text")
  })

  test("getContextSnapshot returns null for unknown session", () => {
    expect(getContextSnapshot("unknown")).toBeNull()
  })

  test("setContextSnapshot overwrites previous snapshot", () => {
    setContextSnapshot("s1", "first")
    setContextSnapshot("s1", "second")
    expect(getContextSnapshot("s1")).toBe("second")
  })

  test("clearContextSnapshot removes snapshot", () => {
    setContextSnapshot("s1", "snapshot")
    clearContextSnapshot("s1")
    expect(getContextSnapshot("s1")).toBeNull()
  })

  test("clearAllBuffers also clears context snapshots", () => {
    setContextSnapshot("s1", "snapshot")
    clearAllBuffers()
    expect(getContextSnapshot("s1")).toBeNull()
  })
})

describe("replayed flag passthrough", () => {
  beforeEach(() => clearAllBuffers())

  function makeEvent(type: string, payload: Record<string, unknown> = {}): BufferedEvent {
    return { type, senderId: "user1", timestamp: Date.now(), payload }
  }

  test("buffers events with replayed:true at envelope level", () => {
    bufferEvent("s1", {
      type: "agent:output",
      senderId: "u1",
      timestamp: Date.now(),
      payload: { content: "hello" },
      replayed: true,
    })
    const history = getReplayHistory("s1")
    expect(history.length).toBe(1)
    expect(history[0].replayed).toBe(true)
  })

  test("replayed flag preserved in aggregated output", () => {
    const now = Date.now()
    bufferEvent("s2", {
      type: "agent:output",
      senderId: "u1",
      timestamp: now,
      payload: { content: "part1", messageId: "m1" },
      replayed: true,
    })
    bufferEvent("s2", {
      type: "agent:complete",
      senderId: "u1",
      timestamp: now + 1,
      payload: { messageId: "m1" },
      replayed: true,
    })
    const history = getReplayHistory("s2")
    expect(history.length).toBe(2)
    expect(history[0].replayed).toBe(true)
    expect(history[1].replayed).toBe(true)
  })
})

