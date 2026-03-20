import { describe, test, expect, beforeEach } from "bun:test";
import { registerWsHandlers } from "./register-handlers";
import {
  getHandlerForType,
  getSessionConnections,
  setUserMeta,
  clearAllConnections,
  sendToUser,
} from "./handler";

describe("registerWsHandlers", () => {
  test("registers all expected handlers", () => {
    registerWsHandlers();

    expect(getHandlerForType("presence:typing")).toBeDefined();
    expect(getHandlerForType("collab:message")).toBeDefined();
    expect(getHandlerForType("prompt:sent")).toBeDefined();
    expect(getHandlerForType("prompt:request")).toBeDefined();
    expect(getHandlerForType("agent:output")).toBeDefined();
    expect(getHandlerForType("agent:tool_use")).toBeDefined();
    expect(getHandlerForType("agent:tool_result")).toBeDefined();
    expect(getHandlerForType("agent:permission")).toBeDefined();
    expect(getHandlerForType("agent:permission_response")).toBeDefined();
    expect(getHandlerForType("agent:complete")).toBeDefined();
    expect(getHandlerForType("plan:sync")).toBeDefined();
    expect(getHandlerForType("plan:awareness")).toBeDefined();
  });

  test("session:context_snapshot handler is registered", () => {
    registerWsHandlers();
    const handler = getHandlerForType("session:context_snapshot");
    expect(handler).toBeDefined();
  });
});

describe("session:host_change authorization", () => {
  function createMockWs(): any {
    const sent: string[] = [];
    return { send: (data: string) => sent.push(data), close: () => {}, _sent: sent };
  }

  beforeEach(() => {
    clearAllConnections();
    registerWsHandlers();
  });

  test("rejects host transfer from non-host with session:error", () => {
    const sid = "auth-test-session";
    const hostWs = createMockWs();
    const collabWs = createMockWs();
    const room = getSessionConnections(sid);
    room.set("alice", [hostWs]);
    room.set("bob", [collabWs]);
    setUserMeta(sid, "alice", { id: "alice", name: "Alice", role: "host" });
    setUserMeta(sid, "bob", { id: "bob", name: "Bob", role: "collaborator" });

    const handler = getHandlerForType("session:host_change")!;
    // Bob (collaborator) tries to transfer host to himself
    handler(sid, "bob", { newHostId: "bob" }, collabWs);

    // Bob should receive session:error
    expect(collabWs._sent.length).toBe(1);
    const errMsg = JSON.parse(collabWs._sent[0]);
    expect(errMsg.type).toBe("session:error");
    expect(errMsg.payload.code).toBe("NOT_HOST");
    // Host should NOT receive anything (no broadcast)
    expect(hostWs._sent.length).toBe(0);
  });

  test("allows host transfer from actual host", () => {
    const sid = "auth-test-session-2";
    const hostWs = createMockWs();
    const collabWs = createMockWs();
    const room = getSessionConnections(sid);
    room.set("alice", [hostWs]);
    room.set("bob", [collabWs]);
    setUserMeta(sid, "alice", { id: "alice", name: "Alice", role: "host" });
    setUserMeta(sid, "bob", { id: "bob", name: "Bob", role: "collaborator" });

    const handler = getHandlerForType("session:host_change")!;
    // Alice (host) transfers to Bob
    handler(sid, "alice", { newHostId: "bob" }, hostWs);

    // Both should receive session:host_change broadcast
    expect(hostWs._sent.length).toBe(1);
    expect(collabWs._sent.length).toBe(1);
    const msg = JSON.parse(collabWs._sent[0]);
    expect(msg.type).toBe("session:host_change");
    expect(msg.payload.newHostId).toBe("bob");
  });

  test("rejects when no host exists in session", () => {
    const sid = "auth-test-session-3";
    const ws = createMockWs();
    const room = getSessionConnections(sid);
    room.set("bob", [ws]);
    setUserMeta(sid, "bob", { id: "bob", name: "Bob", role: "collaborator" });

    const handler = getHandlerForType("session:host_change")!;
    handler(sid, "bob", { newHostId: "bob" }, ws);

    // Should receive session:error (no host = bob is not host)
    expect(ws._sent.length).toBe(1);
    const errMsg = JSON.parse(ws._sent[0]);
    expect(errMsg.type).toBe("session:error");
    expect(errMsg.payload.code).toBe("NOT_HOST");
  });
});
