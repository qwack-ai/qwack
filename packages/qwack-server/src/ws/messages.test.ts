import { describe, test, expect, beforeEach } from "bun:test";
import { clearAllConnections, getSessionConnections } from "./handler";
import { handleCollabMessage } from "./messages";
import { createMockWs } from "./ws-test-utils";

describe("Collaborator Messages", () => {
  beforeEach(() => clearAllConnections());

  test("handleCollabMessage does not throw with no connections", () => {
    expect(() =>
      handleCollabMessage("session-1", "user-1", {
        authorName: "Alice",
        content: "hello",
      }),
    ).not.toThrow();
  });

  test("handleCollabMessage ignores invalid payload", () => {
    const received: string[] = [];
    const room = getSessionConnections("session-1");
    room.set("user-2", [createMockWs(received)]);

    // Missing content
    handleCollabMessage("session-1", "user-1", { authorName: "Alice" });
    expect(received).toHaveLength(0);

    // Missing authorName
    handleCollabMessage("session-1", "user-1", { content: "hello" });
    expect(received).toHaveLength(0);
  });

  test("handleCollabMessage broadcasts to other participants (excludes sender)", () => {
    const received1: string[] = [];
    const received2: string[] = [];
    const room = getSessionConnections("session-1");
    room.set("user-1", [createMockWs(received1)]);
    room.set("user-2", [createMockWs(received2)]);

    handleCollabMessage("session-1", "user-1", {
      authorName: "Alice",
      content: "should we add rate limiting?",
    });

    // Sender (user-1) should NOT receive their own message
    expect(received1).toHaveLength(0);
    // Other participant (user-2) SHOULD receive it
    expect(received2).toHaveLength(1);
    const msg = JSON.parse(received2[0]);
    expect(msg.type).toBe("collab:message");
    expect(msg.payload.authorName).toBe("Alice");
    expect(msg.payload.content).toBe("should we add rate limiting?");
  });
});
