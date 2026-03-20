import { describe, test, expect, beforeEach } from "bun:test";
import { clearAllConnections, getSessionConnections } from "./handler";
import { handlePresenceTyping } from "./presence";
import { createMockWs } from "./ws-test-utils";

describe("Presence", () => {
  beforeEach(() => clearAllConnections());

  test("handlePresenceTyping does not throw with no connections", () => {
    expect(() =>
      handlePresenceTyping("session-1", "user-1", {}),
    ).not.toThrow();
  });

  test("handlePresenceTyping broadcasts to other users", () => {
    const received1: string[] = [];
    const received2: string[] = [];

    const room = getSessionConnections("session-1");
    room.set("user-1", [createMockWs(received1)]);
    room.set("user-2", [createMockWs(received2)]);

    handlePresenceTyping("session-1", "user-1", {});

    // user-1 excluded (sender), only user-2 should receive
    expect(received1).toHaveLength(0);
    expect(received2).toHaveLength(1);
    const msg = JSON.parse(received2[0]);
    expect(msg.type).toBe("presence:typing");
    expect(msg.senderId).toBe("user-1");
    expect(msg.payload.userId).toBe("user-1");
  });
});
