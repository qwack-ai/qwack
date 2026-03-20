import { describe, test, expect } from "bun:test";
import type { WsMessage } from "@qwack/shared";

import { QwackWsClient } from "./ws-client";

function makeMsg(type: string, payload: Record<string, unknown> = {}): WsMessage {
  return { type, sessionId: "s1", senderId: "u1", timestamp: Date.now(), payload };
}

function makeMockWs(): { ws: { readyState: number; send: (data: string) => void }; sent: string[] } {
  const sent: string[] = [];
  return {
    ws: { readyState: 1, send: (data: string) => sent.push(data) },
    sent,
  };
}

function injectWs(client: QwackWsClient, ws: unknown): void {
  (client as unknown as Record<string, unknown>)["ws"] = ws;
}

describe("QwackWsClient", () => {
  test("constructor creates a valid client", () => {
    const client = new QwackWsClient("https://qwack.ai", "test-token", "session-123");
    expect(client).toBeDefined();
    expect(client.isConnected).toBe(false);
  });

  test("isConnected returns false when not connected", () => {
    const client = new QwackWsClient("https://qwack.ai", "test-token", "session-123");
    expect(client.isConnected).toBe(false);
  });

  test("on/off registers and removes handlers", () => {
    const client = new QwackWsClient("https://qwack.ai", "test-token", "session-123");
    let called = false;
    const handler = () => { called = true; };

    client.on("test:event", handler);
    expect(called).toBe(false);

    client.off("test:event", handler);
  });

  test("send returns false when disconnected", async () => {
    const client = new QwackWsClient("https://qwack.ai", "test-token", "session-123");
    const result = await client.send(makeMsg("ping"));
    expect(result).toBe(false);
  });

  test("send returns true when connected", async () => {
    const client = new QwackWsClient("https://qwack.ai", "test-token", "session-123");
    const { ws, sent } = makeMockWs();
    injectWs(client, ws);

    const result = await client.send(makeMsg("prompt:sent", { content: "hello" }));
    expect(result).toBe(true);
    expect(sent.length).toBe(1);
  });
});

describe("offline queue", () => {
  test("queues queuable events when disconnected", async () => {
    const client = new QwackWsClient("https://qwack.ai", "t", "s");
    await client.send(makeMsg("prompt:sent", { content: "hello" }));
    await client.send(makeMsg("agent:output", { content: "world" }));
    expect(client.getQueueSize()).toBe(2);
  });

  test("does NOT queue non-queuable events", async () => {
    const client = new QwackWsClient("https://qwack.ai", "t", "s");
    await client.send(makeMsg("ping"));
    await client.send(makeMsg("presence:join"));
    await client.send(makeMsg("plan:sync"));
    await client.send(makeMsg("auth:token"));
    expect(client.getQueueSize()).toBe(0);
  });

  test("flushes queue on reconnect with replayed flag", async () => {
    const client = new QwackWsClient("https://qwack.ai", "t", "s");
    await client.send(makeMsg("prompt:sent", { content: "a" }));
    await client.send(makeMsg("agent:output", { content: "b" }));
    await client.send(makeMsg("collab:message", { content: "c" }));
    expect(client.getQueueSize()).toBe(3);

    const { ws, sent } = makeMockWs();
    injectWs(client, ws);

    (client as unknown as { flushOfflineQueue: () => void }).flushOfflineQueue();

    expect(sent.length).toBe(3);
    expect(client.getQueueSize()).toBe(0);

    for (const raw of sent) {
      const parsed = JSON.parse(raw);
      expect(parsed.replayed).toBe(true);
    }
  });

  test("preserves FIFO order on flush", async () => {
    const client = new QwackWsClient("https://qwack.ai", "t", "s");
    await client.send(makeMsg("agent:output", { order: 1 }));
    await client.send(makeMsg("agent:output", { order: 2 }));
    await client.send(makeMsg("agent:output", { order: 3 }));

    const { ws, sent } = makeMockWs();
    injectWs(client, ws);
    (client as unknown as { flushOfflineQueue: () => void }).flushOfflineQueue();

    const orders = sent.map((s) => JSON.parse(s).payload.order);
    expect(orders).toEqual([1, 2, 3]);
  });

  test("clearQueue empties the queue", async () => {
    const client = new QwackWsClient("https://qwack.ai", "t", "s");
    for (let i = 0; i < 5; i++) {
      await client.send(makeMsg("agent:output", { i }));
    }
    expect(client.getQueueSize()).toBe(5);
    client.clearQueue();
    expect(client.getQueueSize()).toBe(0);
  });
});
