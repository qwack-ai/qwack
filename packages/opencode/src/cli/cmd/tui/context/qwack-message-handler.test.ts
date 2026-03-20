import { describe, test, expect, mock, beforeEach } from "bun:test"
import * as Y from "yjs"
import { createMessageHandler, type MessageHandlerDeps } from "./qwack-message-handler"
import type { QwackCollabMessage } from "./qwack-types"

function createMockDeps(): MessageHandlerDeps & { calls: Record<string, any[]> } {
  const calls: Record<string, any[]> = {}
  const track =
    (name: string) =>
    (...args: any[]) => {
      if (!calls[name]) calls[name] = []
      calls[name].push(args)
    }

  return {
    calls,
    setIsAuthenticated: track("setIsAuthenticated"),
    setUserName: track("setUserName"),
    setCurrentUserRole: track("setCurrentUserRole"),
    setStatus: track("setStatus"),
    setPresence: track("setPresence") as any,
    setMessages: track("setMessages") as any,
    updateRoleFromPresence: track("updateRoleFromPresence"),
    disconnect: track("disconnect"),
    getCurrentUserId: () => "my-user-id",
    setCurrentUserId: track("setCurrentUserId"),
    getPromptExecuteCallback: () => null,
    planDoc: new Y.Doc(),
    setCollabOnly: track("setCollabOnly"),
    setOfflineQueueSize: track("setOfflineQueueSize"),
    resolvePendingAuth: () => null,
    clearPendingAuth: track("clearPendingAuth"),
    getCurrentUserRole: () => "collaborator",
    getSessionId: () => "test-session",
    onBecomeHost: track("onBecomeHost"),
    onLoseHost: track("onLoseHost"),
    registerParticipant: track("registerParticipant"),
    onKeyDistribution: async (...args: any[]) => { track("onKeyDistribution")(...args) },
    syncSet: track("syncSet"),
    getLocalSessionId: () => "local-ses-123",
    onAuthError: track("onAuthError"),
  }
}

function makeEvent(type: string, payload: Record<string, unknown>): MessageEvent {
  return { data: JSON.stringify({ type, payload }) } as MessageEvent
}

describe("qwack-message-handler", () => {
  describe("auth:ok", () => {
    test("calls registerParticipant on successful auth", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("auth:ok", {
          user: { id: "my-user-id", name: "Alice", role: "host" },
        }),
      )

      expect(deps.calls["registerParticipant"]).toBeDefined()
      expect(deps.calls["registerParticipant"].length).toBe(1)
    })

    test("sets authenticated state and user info", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("auth:ok", {
          user: { id: "u1", name: "Bob", role: "collaborator" },
        }),
      )

      expect(deps.calls["setIsAuthenticated"]?.[0]).toEqual([true])
      expect(deps.calls["setUserName"]?.[0]).toEqual(["Bob"])
      expect(deps.calls["setCurrentUserId"]?.[0]).toEqual(["u1"])
      expect(deps.calls["setCurrentUserRole"]?.[0]).toEqual(["collaborator"])
      expect(deps.calls["setStatus"]?.[0]).toEqual(["connected"])
    })

    test("sets collabOnly when role is not host", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("auth:ok", {
          user: { id: "u1", name: "Bob", role: "collaborator" },
        }),
      )

      expect(deps.calls["setCollabOnly"]?.[0]).toEqual([true])
    })

    test("does not set collabOnly when role is host", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("auth:ok", {
          user: { id: "u1", name: "Alice", role: "host" },
        }),
      )

      expect(deps.calls["setCollabOnly"]?.[0]).toEqual([false])
    })
  })

  describe("session:error", () => {
    test("handles session:error without crashing", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      // Should not throw
      handler(
        makeEvent("session:error", {
          code: "NOT_HOST",
          message: "Only the host can transfer the host role",
        }),
      )

      // No side effects — just silently handled
      expect(deps.calls["disconnect"]).toBeUndefined()
    })
  })

  describe("auth:error", () => {
    test("calls onAuthError on auth error", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(makeEvent("auth:error", { message: "Invalid token" }))

      expect(deps.calls["onAuthError"]).toBeDefined()
      expect(deps.calls["onAuthError"].length).toBe(1)
    })

    test("does not call disconnect directly (onAuthError handles it)", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(makeEvent("auth:error", { message: "Expired" }))

      expect(deps.calls["disconnect"]).toBeUndefined()
    })
  })

  describe("invalid messages", () => {
    test("ignores non-JSON messages", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      // Should not throw
      handler({ data: "not json" } as MessageEvent)
      expect(Object.keys(deps.calls).length).toBe(0)
    })
  })

  describe("agent:tool_use", () => {
    test("creates native ToolPart via syncSet", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:tool_use", {
          tool: "file_read",
          input: { path: "/src/index.ts" },
          partId: "part-123",
          messageId: "msg-1",
        }),
      )

      expect(deps.calls["syncSet"]).toBeDefined()
      expect(deps.calls["syncSet"].length).toBeGreaterThanOrEqual(2)

      const messageCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "message")
      const partCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "part")
      expect(messageCalls.length).toBe(1)
      expect(partCalls.length).toBe(1)

      const partDraft: Record<string, any[]> = {}
      partCalls[0][1](partDraft)
      expect(partDraft["msg-1"]).toBeDefined()
      expect(partDraft["msg-1"].length).toBe(1)
      expect(partDraft["msg-1"][0].type).toBe("tool")
      expect(partDraft["msg-1"][0].tool).toBe("file_read")
      expect(partDraft["msg-1"][0].state.status).toBe("running")
    })

    test("host skips agent:tool_use events", () => {
      const deps = createMockDeps()
      deps.getCurrentUserRole = () => "host"
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:tool_use", {
          tool: "file_read",
          input: "test",
          partId: "part-123",
        }),
      )

      expect(deps.calls["syncSet"]).toBeUndefined()
    })
  })

  describe("agent:tool_result", () => {
    test("updates existing ToolPart to completed via syncSet", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:tool_result", {
          tool: "file_read",
          output: "file contents here",
          partId: "part-123",
          status: "completed",
          messageId: "msg-1",
        }),
      )

      expect(deps.calls["syncSet"]).toBeDefined()
      const partCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "part")
      expect(partCalls.length).toBe(1)

      const partDraft: Record<string, any[]> = {
        "msg-1": [{
          id: "part-123", type: "tool", tool: "file_read",
          state: { status: "running", input: {}, title: "file_read", output: "", metadata: {}, time: { start: 1000 } },
        }],
      }
      partCalls[0][1](partDraft)

      expect(partDraft["msg-1"][0].state.status).toBe("completed")
      expect(partDraft["msg-1"][0].state.output).toBe("file contents here")
      expect(partDraft["msg-1"][0].state.time.end).toBeDefined()
    })

    test("sets error status and error message on tool failure", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:tool_result", {
          tool: "shell",
          output: null,
          partId: "part-789",
          status: "error",
          error: "Command failed with exit code 1",
          messageId: "msg-2",
        }),
      )

      const partCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "part")
      const partDraft: Record<string, any[]> = {
        "msg-2": [{
          id: "part-789", type: "tool", tool: "shell",
          state: { status: "running", input: {}, title: "shell", output: "", metadata: {}, time: { start: 1000 } },
        }],
      }
      partCalls[0][1](partDraft)

      expect(partDraft["msg-2"][0].state.status).toBe("error")
      expect(partDraft["msg-2"][0].state.error).toBe("Command failed with exit code 1")
    })

    test("skips when no messageId provided", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:tool_result", {
          tool: "shell",
          output: "done",
          partId: "part-456",
          status: "completed",
        }),
      )

      expect(deps.calls["syncSet"]).toBeUndefined()
    })

    test("host skips agent:tool_result events", () => {
      const deps = createMockDeps()
      deps.getCurrentUserRole = () => "host"
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:tool_result", {
          tool: "shell",
          output: "done",
          partId: "part-456",
          status: "completed",
          messageId: "msg-1",
        }),
      )

      expect(deps.calls["syncSet"]).toBeUndefined()
    })

    test("relays metadata.diff so collaborators see file edit view", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:tool_result", {
          tool: "edit",
          output: "Applied edit",
          metadata: { diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new" },
          partId: "part-edit",
          status: "completed",
          messageId: "msg-edit",
        }),
      )

      const partCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "part")
      const partDraft: Record<string, any[]> = {
        "msg-edit": [{
          id: "part-edit", type: "tool", tool: "edit",
          state: { status: "running", input: {}, title: "edit", output: "", metadata: {}, time: { start: 1000 } },
        }],
      }
      partCalls[0][1](partDraft)

      expect(partDraft["msg-edit"][0].state.metadata).toEqual({
        diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new",
      })
      expect(partDraft["msg-edit"][0].state.status).toBe("completed")
    })

    test("does not set metadata when payload has none", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:tool_result", {
          tool: "file_read",
          output: "contents",
          partId: "part-no-meta",
          status: "completed",
          messageId: "msg-no-meta",
        }),
      )

      const partCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "part")
      const partDraft: Record<string, any[]> = {
        "msg-no-meta": [{
          id: "part-no-meta", type: "tool", tool: "file_read",
          state: { status: "running", input: {}, title: "file_read", output: "", metadata: {}, time: { start: 1000 } },
        }],
      }
      partCalls[0][1](partDraft)

      expect(partDraft["msg-no-meta"][0].state.metadata).toEqual({})
    })
  })

  describe("agent:output", () => {
    test("creates native TextPart via syncSet", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("agent:output", {
          messageId: "msg-1",
          content: "Hello world",
        }),
      )

      expect(deps.calls["syncSet"]).toBeDefined()
      const messageCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "message")
      const partCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "part")
      expect(messageCalls.length).toBe(1)
      expect(partCalls.length).toBe(1)

      const msgDraft: Record<string, any[]> = {}
      messageCalls[0][1](msgDraft)
      expect(msgDraft["local-ses-123"]).toBeDefined()
      expect(msgDraft["local-ses-123"][0].role).toBe("assistant")

      const partDraft: Record<string, any[]> = {}
      partCalls[0][1](partDraft)
      expect(partDraft["msg-1"][0].type).toBe("text")
      expect(partDraft["msg-1"][0].text).toBe("Hello world")
    })

    test("appends to existing TextPart on subsequent chunks", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(makeEvent("agent:output", { messageId: "msg-1", content: "Hello " }))
      handler(makeEvent("agent:output", { messageId: "msg-1", content: "world" }))

      const partCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "part")
      expect(partCalls.length).toBe(2)

      const partDraft: Record<string, any[]> = { "msg-1": [{ id: "msg-1-text", type: "text", text: "Hello " }] }
      partCalls[1][1](partDraft)
      expect(partDraft["msg-1"][0].text).toBe("Hello world")
    })

    test("host skips agent:output events", () => {
      const deps = createMockDeps()
      deps.getCurrentUserRole = () => "host"
      const handler = createMessageHandler(deps)

      handler(makeEvent("agent:output", { messageId: "msg-1", content: "test" }))
      expect(deps.calls["syncSet"]).toBeUndefined()
    })
  })

  describe("agent:complete", () => {
    test("sets time.completed on native message via syncSet", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(makeEvent("agent:complete", { messageId: "msg-1" }))

      expect(deps.calls["syncSet"]).toBeDefined()
      const messageCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "message")
      expect(messageCalls.length).toBe(1)

      const msgDraft: Record<string, any[]> = {
        "local-ses-123": [{ id: "msg-1", time: { created: 1000 } }],
      }
      messageCalls[0][1](msgDraft)
      expect(msgDraft["local-ses-123"][0].time.completed).toBeDefined()
    })

    test("host skips agent:complete events", () => {
      const deps = createMockDeps()
      deps.getCurrentUserRole = () => "host"
      const handler = createMessageHandler(deps)

      handler(makeEvent("agent:complete", { messageId: "msg-1" }))
      expect(deps.calls["syncSet"]).toBeUndefined()
    })

    test("skips when no messageId provided", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(makeEvent("agent:complete", {}))
      expect(deps.calls["syncSet"]).toBeUndefined()
    })
  })

  describe("collab:message", () => {
    test("still creates QwackCollabMessage via setMessages", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(makeEvent("collab:message", { authorName: "Alice", content: "hey!" }))

      expect(deps.calls["setMessages"]).toBeDefined()
      expect(deps.calls["syncSet"]).toBeUndefined()
    })
  })

  describe("session:history metadata relay", () => {
    test("replays agent:tool_result with metadata.diff for file edit view", () => {
      const deps = createMockDeps()
      const handler = createMessageHandler(deps)

      handler(
        makeEvent("session:history", {
          events: [
            {
              type: "agent:tool_use",
              senderId: "host-1",
              timestamp: 1000,
              payload: { tool: "edit", input: { filePath: "src/app.ts" }, partId: "p-edit", messageId: "m-1" },
            },
            {
              type: "agent:tool_result",
              senderId: "host-1",
              timestamp: 2000,
              payload: {
                tool: "edit",
                output: "Applied edit",
                metadata: { diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new" },
                partId: "p-edit",
                status: "completed",
                messageId: "m-1",
              },
            },
          ],
        }),
      )

      const partCalls = deps.calls["syncSet"].filter((c: any[]) => c[0] === "part")
      expect(partCalls.length).toBeGreaterThanOrEqual(2)

      const partDraft: Record<string, any[]> = {
        "m-1": [{
          id: "p-edit", type: "tool", tool: "edit",
          state: { status: "running", input: { filePath: "src/app.ts" }, title: "edit", output: "", metadata: {}, time: { start: 1000 } },
        }],
      }
      const resultCall = partCalls[partCalls.length - 1]
      resultCall[1](partDraft)

      expect(partDraft["m-1"][0].state.metadata).toEqual({
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
      })
    })
  })
})
