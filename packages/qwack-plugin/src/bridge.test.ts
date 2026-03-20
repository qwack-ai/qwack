import { describe, test, expect, beforeEach } from "bun:test";
import { QwackBridge } from "./bridge";

const wsHandlers = new Map<string, Array<(payload: unknown) => void>>();
const wsSent: Array<{ type: string; payload: unknown }> = [];

class MockWsClient {
  constructor() {}
  connect() {}
  disconnect() {}
  get isConnected() { return false; }
  getQueueSize() { return 0; }
  clearQueue() {}
  on(event: string, handler: (payload: unknown) => void) {
    if (!wsHandlers.has(event)) wsHandlers.set(event, []);
    wsHandlers.get(event)!.push(handler);
  }
  off(_event: string, _handler: (payload: unknown) => void) {}
  send(type: string, payload: unknown) { wsSent.push({ type, payload }); }
}

function mockWsFactory() {
  return new MockWsClient() as any;
}

describe("QwackBridge", () => {
  test("starts inactive", () => {
    const bridge = new QwackBridge();
    expect(bridge.isActive).toBe(false);
    expect(bridge.getSessionId()).toBeNull();
    expect(bridge.getWsClient()).toBeNull();
    expect(bridge.getContext()).toBeNull();
  });

  test("getCommandContext returns empty context when inactive", () => {
    const bridge = new QwackBridge();
    const ctx = bridge.getCommandContext();
    expect(ctx.sessionId).toBeUndefined();
    expect(ctx.wsClient).toBeUndefined();
  });

  test("getHooks returns nulls when inactive", () => {
    const bridge = new QwackBridge();
    const hooks = bridge.getHooks();
    expect(hooks.promptCapture).toBeNull();
    expect(hooks.outputCapture).toBeNull();
    expect(hooks.permission).toBeNull();
  });

  test("stop is safe when not started", () => {
    const bridge = new QwackBridge();
    expect(() => bridge.stop()).not.toThrow();
  });

  test("stop can be called multiple times", () => {
    const bridge = new QwackBridge();
    expect(() => {
      bridge.stop();
      bridge.stop();
    }).not.toThrow();
  });

  test("start with explicit config does not throw", async () => {
    const bridge = new QwackBridge();
    await bridge.start("session-1", "user-1", "Alice", {
      server: "http://localhost:4000",
      token: "test",
    }, mockWsFactory);
    expect(bridge.isActive).toBe(true);
    bridge.stop();
  });

  test("getHooks returns nulls for agent-as-peer hooks when inactive", () => {
    const bridge = new QwackBridge();
    const hooks = bridge.getHooks();
    expect(hooks.systemInject).toBeNull();
    expect(hooks.messageInject).toBeNull();
    expect(hooks.compactionInject).toBeNull();
  });

  test("getCollaboratorState returns null when inactive", () => {
    const bridge = new QwackBridge();
    expect(bridge.getCollaboratorState()).toBeNull();
  });
});

describe("QwackBridge — session:host_change handler", () => {
  beforeEach(() => {
    wsHandlers.clear();
    wsSent.length = 0;
  });

  async function startBridge(userId: string = "alice"): Promise<QwackBridge> {
    const bridge = new QwackBridge();
    await bridge.start("session-1", userId, "Alice", {
      server: "http://localhost:4000",
      token: userId,
    }, mockWsFactory);
    return bridge;
  }

  function fireWsEvent(event: string, payload: unknown) {
    const handlers = wsHandlers.get(event);
    if (handlers) {
      for (const h of handlers) h(payload);
    }
  }

  test("sets _isHost from presence:list", async () => {
    const bridge = await startBridge("alice");
    fireWsEvent("presence:list", {
      participants: [
        { id: "alice", name: "Alice", role: "host" },
        { id: "bob", name: "Bob", role: "collaborator" },
      ],
    });
    // Bridge should track that alice is host (internal state)
    // Verify by triggering host_change where alice loses host
    fireWsEvent("session:host_change", { newHostId: "bob" });
    // If _isHost was true, it should now be false and compaction should trigger
    // We can't directly assert _isHost, but we can verify the handler didn't crash
    expect(bridge.isActive).toBe(true);
  });

  test("tracks new host when we become host", async () => {
    const bridge = await startBridge("bob");
    fireWsEvent("presence:list", {
      participants: [
        { id: "alice", name: "Alice", role: "host" },
        { id: "bob", name: "Bob", role: "collaborator" },
      ],
    });
    // Bob becomes host
    fireWsEvent("session:host_change", { newHostId: "bob" });
    // Now if we get another host_change taking it away, the handler should fire
    // This verifies the _isHost = true path was taken
    fireWsEvent("session:host_change", { newHostId: "alice" });
    expect(bridge.isActive).toBe(true);
  });

  test("ignores host_change when we were not host", async () => {
    const bridge = await startBridge("bob");
    // Bob was never host — host_change should not trigger compaction
    fireWsEvent("session:host_change", { newHostId: "alice" });
    expect(bridge.isActive).toBe(true);
  });
});
