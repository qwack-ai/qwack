import type { QwackWsClient } from "../ws-client";
import type { WsMessage } from "@qwack/shared";

type EventHandler = (payload: unknown) => void;

export interface MockWsClient {
  send: (msg: WsMessage) => void;
  on: (type: string, handler: EventHandler) => void;
  off: (type: string, handler: EventHandler) => void;
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
  _sent: WsMessage[];
  _handlers: Map<string, Set<EventHandler>>;
  _emit: (type: string, payload: unknown) => void;
  _connectCalled: boolean;
  _disconnectCalled: boolean;
}

export function createMockWsClient(): MockWsClient {
  const sent: WsMessage[] = [];
  const handlers = new Map<string, Set<EventHandler>>();
  let connectCalled = false;
  let disconnectCalled = false;

  return {
    send: (msg: WsMessage) => sent.push(msg),
    on: (type: string, handler: EventHandler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    },
    off: (type: string, handler: EventHandler) => {
      handlers.get(type)?.delete(handler);
    },
    connect: () => {
      connectCalled = true;
    },
    disconnect: () => {
      disconnectCalled = true;
    },
    isConnected: false,
    _sent: sent,
    _handlers: handlers,
    _emit: (type: string, payload: unknown) => {
      const set = handlers.get(type);
      if (set) {
        for (const h of set) h(payload);
      }
    },
    get _connectCalled() {
      return connectCalled;
    },
    get _disconnectCalled() {
      return disconnectCalled;
    },
  };
}

export function mockContext(overrides?: Partial<{
  sessionId: string;
  userId: string;
  userName: string;
}>) {
  return {
    sessionId: "ses-test-1",
    userId: "user-test-1",
    userName: "testuser",
    ...overrides,
  };
}
