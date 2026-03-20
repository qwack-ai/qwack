import { getSessionConnections } from "./handler";

// Infer WsConn type from handler's Map return type
type SessionConnMap = ReturnType<typeof getSessionConnections>;
type WsConn = SessionConnMap extends Map<string, infer V> ? V : never;

/** Create a mock WS connection for testing. Optionally collects sent data. */
export function createMockWs(received?: string[]): WsConn {
  return {
    send(data: string | ArrayBuffer | Uint8Array) {
      if (received) received.push(typeof data === "string" ? data : "");
    },
    close(_code?: number, _reason?: string) {},
  } as WsConn;
}
