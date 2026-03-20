import { describe, test, expect } from "bun:test"
import { convertSessionToEvents, type SessionMessage } from "./session-converter"

const SID = "ses-share-1"
const UID = "user-1"
const UNAME = "alice"

function makeUserMsg(text: string, id = "umsg-1", created = 1000): SessionMessage {
  return {
    info: { id, role: "user", time: { created } },
    parts: [{ id: `p-${id}`, type: "text", text }],
  }
}

function makeAssistantMsg(
  parts: SessionMessage["parts"],
  id = "amsg-1",
  created = 2000,
  completed?: number,
): SessionMessage {
  return {
    info: { id, role: "assistant", time: { created, completed } },
    parts,
  }
}

describe("convertSessionToEvents", () => {
  test("empty messages returns empty array", () => {
    const result = convertSessionToEvents([], SID, UID, UNAME)
    expect(result).toEqual([])
  })

  test("user message with text produces prompt:sent", () => {
    const result = convertSessionToEvents([makeUserMsg("hello world")], SID, UID, UNAME)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("prompt:sent")
    expect(result[0].sessionId).toBe(SID)
    expect(result[0].senderId).toBe(UID)
    expect(result[0].timestamp).toBe(1000)
    expect(result[0].payload).toEqual({
      authorId: UID,
      authorName: UNAME,
      content: "hello world",
    })
    expect(result[0].replayed).toBe(true)
  })

  test("user message with no text parts produces no events", () => {
    const msg: SessionMessage = {
      info: { id: "umsg-empty", role: "user", time: { created: 1000 } },
      parts: [{ id: "p-img", type: "image" }],
    }
    const result = convertSessionToEvents([msg], SID, UID, UNAME)
    expect(result).toHaveLength(0)
  })

  test("user message with multiple text parts joins with newline", () => {
    const msg: SessionMessage = {
      info: { id: "umsg-multi", role: "user", time: { created: 1000 } },
      parts: [
        { id: "p1", type: "text", text: "line one" },
        { id: "p2", type: "text", text: "line two" },
      ],
    }
    const result = convertSessionToEvents([msg], SID, UID, UNAME)
    expect(result).toHaveLength(1)
    expect((result[0].payload as any).content).toBe("line one\nline two")
  })

  test("assistant message with text produces agent:output + agent:complete", () => {
    const parts: SessionMessage["parts"] = [{ id: "p-text", type: "text", text: "Here is the answer" }]
    const result = convertSessionToEvents([makeAssistantMsg(parts)], SID, UID, UNAME)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe("agent:output")
    expect(result[0].payload).toEqual({ content: "Here is the answer", partId: "p-text" })
    expect(result[0].replayed).toBe(true)

    expect(result[1].type).toBe("agent:complete")
    expect((result[1].payload as any).messageId).toBe("amsg-1")
  })

  test("assistant message with reasoning produces agent:thinking", () => {
    const parts: SessionMessage["parts"] = [{ id: "p-reason", type: "reasoning", text: "Let me think..." }]
    const result = convertSessionToEvents([makeAssistantMsg(parts)], SID, UID, UNAME)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe("agent:thinking")
    expect(result[0].payload).toEqual({ content: "Let me think...", partId: "p-reason" })
    expect(result[0].replayed).toBe(true)
    expect(result[1].type).toBe("agent:complete")
  })

  test("assistant message with completed tool produces tool_use + tool_result + complete", () => {
    const parts: SessionMessage["parts"] = [
      {
        id: "p-tool",
        type: "tool",
        tool: "bash",
        state: { status: "completed", input: { cmd: "ls" }, output: "file.ts" },
      },
    ]
    const result = convertSessionToEvents([makeAssistantMsg(parts)], SID, UID, UNAME)

    expect(result).toHaveLength(3)

    expect(result[0].type).toBe("agent:tool_use")
    expect(result[0].payload).toEqual({
      tool: "bash",
      input: { cmd: "ls" },
      partId: "p-tool",
      messageId: "amsg-1",
    })
    expect(result[0].replayed).toBe(true)

    expect(result[1].type).toBe("agent:tool_result")
    expect(result[1].payload).toEqual({
      tool: "bash",
      output: "file.ts",
      partId: "p-tool",
      messageId: "amsg-1",
      status: "completed",
      error: undefined,
    })
    expect(result[1].replayed).toBe(true)

    expect(result[2].type).toBe("agent:complete")
  })

  test("assistant message with error tool produces tool_result with error", () => {
    const parts: SessionMessage["parts"] = [
      {
        id: "p-err",
        type: "tool",
        tool: "file_write",
        state: { status: "error", input: {}, error: "Permission denied" },
      },
    ]
    const result = convertSessionToEvents([makeAssistantMsg(parts)], SID, UID, UNAME)

    const toolResult = result.find((e) => e.type === "agent:tool_result")!
    expect(toolResult).toBeDefined()
    expect((toolResult.payload as any).status).toBe("error")
    expect((toolResult.payload as any).error).toBe("Permission denied")
  })

  test("error tool with no error message defaults to 'Unknown error'", () => {
    const parts: SessionMessage["parts"] = [
      { id: "p-err2", type: "tool", tool: "bash", state: { status: "error", input: {} } },
    ]
    const result = convertSessionToEvents([makeAssistantMsg(parts)], SID, UID, UNAME)

    const toolResult = result.find((e) => e.type === "agent:tool_result")!
    expect((toolResult.payload as any).error).toBe("Unknown error")
  })

  test("pending tool emits tool_use but no tool_result", () => {
    const parts: SessionMessage["parts"] = [
      { id: "p-pend", type: "tool", tool: "bash", state: { status: "pending", input: { cmd: "sleep 10" } } },
    ]
    const result = convertSessionToEvents([makeAssistantMsg(parts)], SID, UID, UNAME)

    expect(result.filter((e) => e.type === "agent:tool_use")).toHaveLength(1)
    expect(result.filter((e) => e.type === "agent:tool_result")).toHaveLength(0)
  })

  test("agent:complete uses completed timestamp when available", () => {
    const parts: SessionMessage["parts"] = [{ id: "p-t", type: "text", text: "done" }]
    const result = convertSessionToEvents([makeAssistantMsg(parts, "amsg-ts", 2000, 3000)], SID, UID, UNAME)

    const complete = result.find((e) => e.type === "agent:complete")!
    expect(complete.timestamp).toBe(3000)
  })

  test("agent:complete falls back to created timestamp", () => {
    const parts: SessionMessage["parts"] = [{ id: "p-t", type: "text", text: "done" }]
    const result = convertSessionToEvents([makeAssistantMsg(parts, "amsg-ts", 2000)], SID, UID, UNAME)

    const complete = result.find((e) => e.type === "agent:complete")!
    expect(complete.timestamp).toBe(2000)
  })

  test("multiple messages produce events in order", () => {
    const messages: SessionMessage[] = [
      makeUserMsg("do something", "u1", 1000),
      makeAssistantMsg([{ id: "p1", type: "text", text: "ok" }], "a1", 2000, 2500),
      makeUserMsg("do more", "u2", 3000),
      makeAssistantMsg([{ id: "p2", type: "text", text: "done" }], "a2", 4000, 4500),
    ]
    const result = convertSessionToEvents(messages, SID, UID, UNAME)

    const types = result.map((e) => e.type)
    expect(types).toEqual([
      "prompt:sent",
      "agent:output",
      "agent:complete",
      "prompt:sent",
      "agent:output",
      "agent:complete",
    ])

    const timestamps = result.map((e) => e.timestamp)
    expect(timestamps).toEqual([1000, 2000, 2500, 3000, 4000, 4500])
  })

  test("all events have replayed: true at envelope level", () => {
    const messages: SessionMessage[] = [
      makeUserMsg("prompt"),
      makeAssistantMsg([
        { id: "p-r", type: "reasoning", text: "thinking" },
        { id: "p-t", type: "text", text: "output" },
        { id: "p-tool", type: "tool", tool: "bash", state: { status: "completed", input: {}, output: "ok" } },
      ]),
    ]
    const result = convertSessionToEvents(messages, SID, UID, UNAME)

    for (const event of result) {
      expect(event.replayed).toBe(true)
      expect((event.payload as any).replayed).toBeUndefined()
    }
  })

  test("complex message with text + tool + reasoning produces correct sequence", () => {
    const parts: SessionMessage["parts"] = [
      { id: "p-reason", type: "reasoning", text: "Let me analyze..." },
      { id: "p-text", type: "text", text: "I'll check the file" },
      { id: "p-tool", type: "tool", tool: "read", state: { status: "completed", input: { path: "x.ts" }, output: "content" } },
    ]
    const result = convertSessionToEvents([makeAssistantMsg(parts, "complex-1")], SID, UID, UNAME)

    const types = result.map((e) => e.type)
    expect(types).toEqual([
      "agent:thinking",
      "agent:output",
      "agent:tool_use",
      "agent:tool_result",
      "agent:complete",
    ])
    expect(result.every((e) => e.sessionId === SID)).toBe(true)
    expect(result.every((e) => e.senderId === UID)).toBe(true)
  })

  test("tool_result includes metadata.diff for file edit view parity", () => {
    const diff = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new"
    const parts: SessionMessage["parts"] = [
      {
        id: "p-edit",
        type: "tool",
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: "src/app.ts" },
          output: "Applied edit",
          metadata: { diff },
        },
      },
    ]
    const result = convertSessionToEvents([makeAssistantMsg(parts, "edit-msg")], SID, UID, UNAME)

    const toolResult = result.find((e) => e.type === "agent:tool_result")
    expect(toolResult).toBeDefined()
    expect((toolResult!.payload as any).metadata).toEqual({ diff })
  })

  test("tool_result without metadata omits the field", () => {
    const parts: SessionMessage["parts"] = [
      {
        id: "p-read",
        type: "tool",
        tool: "read",
        state: { status: "completed", input: { path: "x.ts" }, output: "content" },
      },
    ]
    const result = convertSessionToEvents([makeAssistantMsg(parts, "read-msg")], SID, UID, UNAME)

    const toolResult = result.find((e) => e.type === "agent:tool_result")
    expect(toolResult).toBeDefined()
    expect((toolResult!.payload as any).metadata).toBeUndefined()
  })
})
