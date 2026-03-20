import { describe, it, expect, mock } from "bun:test";

// Mock readConfig — hoisted by bun before imports
let mockConfigReturn: any = null;
mock.module("../auth/store", () => ({
  readConfig: () => mockConfigReturn,
}));

import { createCollabTools, type CollabAccessor } from "./collab-tools";
import { CollaboratorState } from "../state/collaborator-state";

function createMockAccessor(
  overrides?: Partial<CollabAccessor>,
): CollabAccessor & { sent: any[] } {
  const sent: any[] = [];
  return {
    isActive: false,
    getSessionId: () => null,
    getWsClient: () => null,
    getCollaboratorState: () => null,
    sent,
    ...overrides,
  };
}

function activeAccessor() {
  const sent: any[] = [];
  const state = new CollaboratorState();
  return createMockAccessor({
    isActive: true,
    getSessionId: () => "sess-123",
    getWsClient: () => ({ send: (msg: any) => { sent.push(msg); return true; }, isConnected: true }),
    getCollaboratorState: () => state,
  });
}

describe("createCollabTools", () => {

  it("returns qwack_status, qwack_who, qwack_msg", () => {
    const tools = createCollabTools(createMockAccessor());
    expect(tools.qwack_status).toBeDefined();
    expect(tools.qwack_who).toBeDefined();
    expect(tools.qwack_msg).toBeDefined();
  });

  describe("qwack_status", () => {
    it("shows not configured and disconnected when no config or session", async () => {
      const tools = createCollabTools(createMockAccessor());
      const result = await tools.qwack_status.execute({}, {} as any);
      expect(result).toContain("not configured");
      expect(result).toContain("disconnected");
      expect(result).toContain("none");
    });
  });

  describe("qwack_who", () => {
    it("returns no-session when inactive", async () => {
      const tools = createCollabTools(createMockAccessor());
      const result = await tools.qwack_who.execute({}, {} as any);
      expect(result).toBe("No active Qwack session.");
    });

    it("returns no-state when active but no collaborator state", async () => {
      const tools = createCollabTools(
        createMockAccessor({ isActive: true, getCollaboratorState: () => null }),
      );
      const result = await tools.qwack_who.execute({}, {} as any);
      expect(result).toBe("No collaboration state available.");
    });

    it("returns no-participants when state is empty", async () => {
      const state = new CollaboratorState();
      const tools = createCollabTools(
        createMockAccessor({ isActive: true, getCollaboratorState: () => state }),
      );
      const result = await tools.qwack_who.execute({}, {} as any);
      expect(result).toBe("No participants online.");
    });

    it("lists participants from live presence", async () => {
      const state = new CollaboratorState();
      state.addPresence({ id: "alice", name: "Alice", role: "host" });
      state.addPresence({ id: "bob", name: "Bob", role: "collaborator" });
      const tools = createCollabTools(
        createMockAccessor({ isActive: true, getCollaboratorState: () => state }),
      );
      const result = await tools.qwack_who.execute({}, {} as any);
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
      expect(result).toContain("host");
      expect(result).toContain("collaborator");
      expect(result).toContain("Online (2)");
    });
  });

  describe("qwack_msg", () => {
    it("returns no-session when inactive", async () => {
      const tools = createCollabTools(createMockAccessor());
      const result = await tools.qwack_msg.execute(
        { message: "hello" },
        {} as any,
      );
      expect(result).toBe("No active Qwack session.");
    });

    it("returns not-connected when ws is null", async () => {
      const tools = createCollabTools(
        createMockAccessor({ isActive: true, getWsClient: () => null }),
      );
      const result = await tools.qwack_msg.execute(
        { message: "hello" },
        {} as any,
      );
      expect(result).toBe("Not connected to Qwack server.");
    });

    it("sends collab:message and returns confirmation", async () => {
      const sent: any[] = [];
      const acc = createMockAccessor({
        isActive: true,
        getSessionId: () => "sess-42",
        getWsClient: () => ({ send: (msg: any) => { sent.push(msg); return true; }, isConnected: true }),
      });
      const tools = createCollabTools(acc);
      const result = await tools.qwack_msg.execute(
        { message: "Let's go!" },
        {} as any,
      );
      expect(result).toBe("👤 Qwack: Let's go!");
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe("collab:message");
      expect(sent[0].sessionId).toBe("sess-42");
      expect(sent[0].payload.content).toBe("Let's go!");
      expect(sent[0].payload.authorName).toBe("Qwack");
    });
  });
});
