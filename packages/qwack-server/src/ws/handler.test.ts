import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionConnections,
  broadcastToSession,
  sendToUser,
  removeConnection,
  clearAllConnections,
  getConnectionCount,
  registerHandler,
  getHandlerForType,
  setUserMeta,
  setHostGracePeriod,
  clearHostGraceTimers,
  getHostUserId,
  autoPromoteHost,
  startGraceTimer,
  cancelGraceTimer,
  hasGraceTimer,
} from "./handler";
import { setContextSnapshot, clearAllBuffers } from "./event-buffer";
import { handlePromptRequest, getBufferedPromptCount, clearPromptBuffer } from "./prompts";

function createMockWs(): any {
  const sent: string[] = [];
  return {
    send: (data: string) => sent.push(data),
    close: () => {},
    _sent: sent,
  };
}

describe("WS Connection Registry", () => {
  beforeEach(() => clearAllConnections());

  test("getSessionConnections creates room if not exists", () => {
    const room = getSessionConnections("session-1");
    expect(room).toBeInstanceOf(Map);
    expect(room.size).toBe(0);
  });

  test("getSessionConnections returns same room on repeated calls", () => {
    const room1 = getSessionConnections("session-1");
    const room2 = getSessionConnections("session-1");
    expect(room1).toBe(room2);
  });

  test("adding connections to a room", () => {
    const room = getSessionConnections("session-1");
    room.set("user-1", [createMockWs()]);
    room.set("user-2", [createMockWs()]);
    expect(getConnectionCount("session-1")).toBe(2);
  });

  test("getConnectionCount returns 0 for unknown session", () => {
    expect(getConnectionCount("nonexistent")).toBe(0);
  });

  test("broadcastToSession sends to all except excluded", () => {
    const room = getSessionConnections("session-1");
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const ws3 = createMockWs();
    room.set("user-1", [ws1]);
    room.set("user-2", [ws2]);
    room.set("user-3", [ws3]);

    broadcastToSession("session-1", { type: "test" }, "user-1");

    expect(ws1._sent.length).toBe(0);
    expect(ws2._sent.length).toBe(1);
    expect(ws3._sent.length).toBe(1);
    expect(JSON.parse(ws2._sent[0])).toEqual({ type: "test" });
  });

  test("broadcastToSession sends to all when no exclusion", () => {
    const room = getSessionConnections("session-1");
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    room.set("user-1", [ws1]);
    room.set("user-2", [ws2]);

    broadcastToSession("session-1", { type: "hello" });

    expect(ws1._sent.length).toBe(1);
    expect(ws2._sent.length).toBe(1);
  });

  test("broadcastToSession is no-op for unknown session", () => {
    // Should not throw
    broadcastToSession("nonexistent", { type: "test" });
  });

  test("broadcastToSession handles send errors gracefully", () => {
    const room = getSessionConnections("session-1");
    const badWs = { send: () => { throw new Error("disconnected"); }, close: () => {} };
    const goodWs = createMockWs();
    room.set("user-1", [badWs]);
    room.set("user-2", [goodWs]);

    broadcastToSession("session-1", { type: "test" });
    expect(goodWs._sent.length).toBe(1);
  });

  test("sendToUser sends to specific user only", () => {
    const room = getSessionConnections("session-1");
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    room.set("user-1", [ws1]);
    room.set("user-2", [ws2]);

    sendToUser("session-1", "user-2", { type: "direct" });

    expect(ws1._sent.length).toBe(0);
    expect(ws2._sent.length).toBe(1);
    expect(JSON.parse(ws2._sent[0])).toEqual({ type: "direct" });
  });

  test("sendToUser is no-op for unknown user", () => {
    getSessionConnections("session-1").set("user-1", [createMockWs()]);
    sendToUser("session-1", "user-99", { type: "test" });
  });

  test("sendToUser is no-op for unknown session", () => {
    sendToUser("nonexistent", "user-1", { type: "test" });
  });

  test("removeConnection deletes user from room", () => {
    const room = getSessionConnections("session-1");
    room.set("user-1", [createMockWs()]);
    room.set("user-2", [createMockWs()]);

    removeConnection("session-1", "user-1");
    expect(getConnectionCount("session-1")).toBe(1);
  });

  test("removeConnection cleans up empty rooms", () => {
    const room = getSessionConnections("session-1");
    room.set("user-1", [createMockWs()]);

    removeConnection("session-1", "user-1");
    expect(getConnectionCount("session-1")).toBe(0);
  });

  test("removeConnection is no-op for unknown session", () => {
    removeConnection("nonexistent", "user-1");
  });

  test("clearAllConnections empties everything", () => {
    getSessionConnections("s1").set("u1", [createMockWs()]);
    getSessionConnections("s2").set("u2", [createMockWs()]);

    clearAllConnections();
    expect(getConnectionCount("s1")).toBe(0);
    expect(getConnectionCount("s2")).toBe(0);
  });
});

describe("Message Handler Registry", () => {
  test("registerHandler stores handler", () => {
    const handler = () => {};
    registerHandler("test:", handler);
    expect(getHandlerForType("test:foo")).toBe(handler);
  });

  test("getHandlerForType exact match takes priority", () => {
    const prefixHandler = () => {};
    const exactHandler = () => {};
    registerHandler("collab:", prefixHandler);
    registerHandler("collab:message", exactHandler);

    expect(getHandlerForType("collab:message")).toBe(exactHandler);
  });

  test("getHandlerForType prefix match", () => {
    const handler = () => {};
    registerHandler("presence:", handler);
    expect(getHandlerForType("presence:join")).toBe(handler);
    expect(getHandlerForType("presence:leave")).toBe(handler);
  });

  test("getHandlerForType returns undefined for unregistered type", () => {
    expect(getHandlerForType("unknown:event")).toBeUndefined();
  });
});

describe("Host Auto-Failover", () => {
  beforeEach(() => {
    clearAllConnections();
    clearAllBuffers();
    clearPromptBuffer("s1");
    setHostGracePeriod(50);
  });

  afterEach(() => {
    clearHostGraceTimers();
    setHostGracePeriod(5000);
  });

  test("autoPromoteHost picks first connected collaborator", async () => {
    const room = getSessionConnections("s1");
    const ws = createMockWs();
    room.set("user-2", [ws]);
    setUserMeta("s1", "user-2", { id: "user-2", name: "Alice", role: "collaborator" });

    await autoPromoteHost("s1");

    expect(getHostUserId("s1")).toBe("user-2");
  });

  test("autoPromoteHost does nothing when no collaborators remain", async () => {
    // Empty session — should not throw
    await autoPromoteHost("s1");
    expect(getHostUserId("s1")).toBeNull();
  });

  test("autoPromoteHost does nothing for nonexistent session", async () => {
    await autoPromoteHost("nonexistent");
    expect(getHostUserId("nonexistent")).toBeNull();
  });

  test("autoPromoteHost broadcasts session:host_change to all clients", async () => {
    const room = getSessionConnections("s1");
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    room.set("user-2", [ws1]);
    room.set("user-3", [ws2]);
    setUserMeta("s1", "user-2", { id: "user-2", name: "Alice", role: "collaborator" });
    setUserMeta("s1", "user-3", { id: "user-3", name: "Bob", role: "collaborator" });

    await autoPromoteHost("s1");

    // Both clients should receive session:host_change
    const msg1 = JSON.parse(ws1._sent[0]);
    expect(msg1.type).toBe("session:host_change");
    expect(msg1.payload.newHostId).toBe("user-2");

    const msg2 = JSON.parse(ws2._sent[0]);
    expect(msg2.type).toBe("session:host_change");
    expect(msg2.payload.newHostId).toBe("user-2");
  });

  test("autoPromoteHost sends context snapshot to new host", async () => {
    const room = getSessionConnections("s1");
    const ws = createMockWs();
    room.set("user-2", [ws]);
    setUserMeta("s1", "user-2", { id: "user-2", name: "Alice", role: "collaborator" });
    setContextSnapshot("s1", "## Context\n- working on auth");

    await autoPromoteHost("s1");

    // Should receive: session:host_change + session:context_snapshot
    expect(ws._sent.length).toBe(2);
    const snapshotMsg = JSON.parse(ws._sent[1]);
    expect(snapshotMsg.type).toBe("session:context_snapshot");
    expect(snapshotMsg.payload.snapshot).toBe("## Context\n- working on auth");
  });

  test("autoPromoteHost skips snapshot when none exists", async () => {
    const room = getSessionConnections("s1");
    const ws = createMockWs();
    room.set("user-2", [ws]);
    setUserMeta("s1", "user-2", { id: "user-2", name: "Alice", role: "collaborator" });

    await autoPromoteHost("s1");

    // Should receive only session:host_change (no snapshot)
    expect(ws._sent.length).toBe(1);
    expect(JSON.parse(ws._sent[0]).type).toBe("session:host_change");
  });

  test("autoPromoteHost flushes buffered prompts to new host", async () => {
    const room = getSessionConnections("s1");
    const ws2 = createMockWs();
    const ws3 = createMockWs();
    room.set("user-2", [ws2]);
    room.set("user-3", [ws3]);
    setUserMeta("s1", "user-2", { id: "user-2", name: "Alice", role: "collaborator" });
    setUserMeta("s1", "user-3", { id: "user-3", name: "Bob", role: "collaborator" });

    // user-3 sends prompt while host is disconnected → gets buffered
    handlePromptRequest("s1", "user-3", { content: "fix the bug", authorName: "Bob" });
    expect(getBufferedPromptCount("s1")).toBe(1);

    // Clear messages from the prompt:sent broadcast
    ws2._sent.length = 0;
    ws3._sent.length = 0;

    await autoPromoteHost("s1");

    // user-2 (new host) should receive: session:host_change + prompt:execute
    const messages = ws2._sent.map((s: string) => JSON.parse(s));
    const types = messages.map((m: any) => m.type);
    expect(types).toContain("session:host_change");
    expect(types).toContain("prompt:execute");

    const execMsg = messages.find((m: any) => m.type === "prompt:execute");
    expect(execMsg.payload.content).toBe("fix the bug");

    // Buffer should be drained
    expect(getBufferedPromptCount("s1")).toBe(0);
  });

  test("grace timer fires and promotes after timeout", async () => {
    const room = getSessionConnections("s1");
    const ws = createMockWs();
    room.set("user-2", [ws]);
    setUserMeta("s1", "user-2", { id: "user-2", name: "Alice", role: "collaborator" });

    // Start grace timer (simulates what onClose does)
    startGraceTimer("s1");
    expect(hasGraceTimer("s1")).toBe(true);

    // Not promoted yet
    expect(getHostUserId("s1")).toBeNull();

    // Wait for timer to fire
    await new Promise((r) => setTimeout(r, 100));

    // Now promoted
    expect(getHostUserId("s1")).toBe("user-2");
    expect(hasGraceTimer("s1")).toBe(false);
  });

  test("host reconnect within grace period cancels timer", async () => {
    const room = getSessionConnections("s1");
    const ws2 = createMockWs();
    room.set("user-2", [ws2]);
    setUserMeta("s1", "user-2", { id: "user-2", name: "Alice", role: "collaborator" });

    // Start grace timer (host disconnected)
    startGraceTimer("s1");
    expect(hasGraceTimer("s1")).toBe(true);

    // Host reconnects within grace period
    const cancelled = cancelGraceTimer("s1");
    expect(cancelled).toBe(true);
    expect(hasGraceTimer("s1")).toBe(false);

    // Re-add host to session
    const wsHost = createMockWs();
    room.set("user-1", [wsHost]);
    setUserMeta("s1", "user-1", { id: "user-1", name: "Host", role: "host" });

    // Wait past the original grace period
    await new Promise((r) => setTimeout(r, 100));

    // Host should still be user-1 (no auto-promotion happened)
    expect(getHostUserId("s1")).toBe("user-1");
  });

  test("cancelGraceTimer returns false when no timer exists", () => {
    expect(cancelGraceTimer("s1")).toBe(false);
  });

  test("clearAllConnections clears grace timers", () => {
    startGraceTimer("s1");
    startGraceTimer("s2");
    expect(hasGraceTimer("s1")).toBe(true);
    expect(hasGraceTimer("s2")).toBe(true);

    clearAllConnections();

    expect(hasGraceTimer("s1")).toBe(false);
    expect(hasGraceTimer("s2")).toBe(false);
  });

  test("snapshot + prompts delivered in correct order to new host", async () => {
    const room = getSessionConnections("s1");
    const ws = createMockWs();
    room.set("user-2", [ws]);
    setUserMeta("s1", "user-2", { id: "user-2", name: "Alice", role: "collaborator" });
    setContextSnapshot("s1", "session context here");

    // Buffer a prompt
    handlePromptRequest("s1", "user-2", { content: "deploy it", authorName: "Alice" });
    ws._sent.length = 0;

    await autoPromoteHost("s1");

    // Order: session:host_change, session:context_snapshot, prompt:execute
    const messages = ws._sent.map((s: string) => JSON.parse(s));
    const types = messages.map((m: any) => m.type);
    expect(types[0]).toBe("session:host_change");
    expect(types[1]).toBe("session:context_snapshot");
    expect(types[2]).toBe("prompt:execute");
  });
});
