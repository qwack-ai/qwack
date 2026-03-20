import { describe, test, expect, beforeEach } from "bun:test";
import { clearAllConnections, getSessionConnections } from "./handler";
import { handleAgentEvent, AGENT_EVENT_TYPES } from "./agent-relay";
import { createMockWs } from "./ws-test-utils";

describe("Agent Relay", () => {
  beforeEach(() => clearAllConnections());

  test("AGENT_EVENT_TYPES contains all expected types", () => {
    expect(AGENT_EVENT_TYPES).toContain("agent:output");
    expect(AGENT_EVENT_TYPES).toContain("agent:thinking");
    expect(AGENT_EVENT_TYPES).toContain("agent:tool_use");
    expect(AGENT_EVENT_TYPES).toContain("agent:tool_result");
    expect(AGENT_EVENT_TYPES).toContain("agent:permission");
    expect(AGENT_EVENT_TYPES).toContain("agent:permission_response");
    expect(AGENT_EVENT_TYPES).toContain("agent:complete");
    expect(AGENT_EVENT_TYPES).toHaveLength(7);
  });

  test("handleAgentEvent broadcasts to others, excludes sender", () => {
    const hostReceived: string[] = [];
    const viewerReceived: string[] = [];
    const room = getSessionConnections("session-1");
    room.set("host", [createMockWs(hostReceived)]);
    room.set("viewer", [createMockWs(viewerReceived)]);

    handleAgentEvent("session-1", "host", "agent:output", {
      content: "Creating file...",
      partId: "part-1",
    });

    expect(hostReceived).toHaveLength(0);
    expect(viewerReceived).toHaveLength(1);
    const msg = JSON.parse(viewerReceived[0]);
    expect(msg.type).toBe("agent:output");
    expect(msg.payload.content).toBe("Creating file...");
  });

  test("handleAgentEvent works for all event types", () => {
    const hostReceived: string[] = [];
    const room = getSessionConnections("session-1");
    room.set("host", [createMockWs()]);
    room.set("viewer", [createMockWs(hostReceived)]);

    for (const type of AGENT_EVENT_TYPES) {
      handleAgentEvent("session-1", "host", type, { test: true });
    }

    expect(hostReceived).toHaveLength(AGENT_EVENT_TYPES.length);
    const types = hostReceived.map((r) => JSON.parse(r).type);
    for (const t of AGENT_EVENT_TYPES) {
      expect(types).toContain(t);
    }
  });
});
