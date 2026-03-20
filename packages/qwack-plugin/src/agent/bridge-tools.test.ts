import { describe, it, expect, beforeEach } from "bun:test";
import { createBridgeTools, type SessionAccessor } from "./bridge-tools";
import { CollaboratorState } from "../state/collaborator-state";

function createMockAccessor(overrides?: Partial<SessionAccessor>): SessionAccessor & { sent: any[] } {
  const state = new CollaboratorState();
  const sent: any[] = [];
  return {
    isActive: true,
    getWsClient: () => ({ send: (msg: any) => sent.push(msg) }),
    getCollaboratorState: () => state,
    getSessionId: () => "session-1",
    sent,
    ...overrides,
  };
}

describe("createBridgeTools", () => {
  it("returns qwack_propose and qwack_disagree", () => {
    const tools = createBridgeTools(createMockAccessor());
    expect(tools.qwack_propose).toBeDefined();
    expect(tools.qwack_disagree).toBeDefined();
  });

  describe("qwack_propose", () => {
    it("returns no-session message when inactive", async () => {
      const accessor = createMockAccessor({ isActive: false });
      const tools = createBridgeTools(accessor);
      const result = await tools.qwack_propose.execute(
        { proposal: "test", rationale: "reason" },
        {} as any,
      );
      expect(result).toContain("No active Qwack session");
    });

    it("adds proposal to state", async () => {
      const accessor = createMockAccessor();
      const tools = createBridgeTools(accessor);
      await tools.qwack_propose.execute(
        { proposal: "Refactor auth", rationale: "Too complex" },
        {} as any,
      );
      const pending = accessor.getCollaboratorState()!.getPendingProposals();
      expect(pending).toHaveLength(1);
      expect(pending[0].content).toBe("Refactor auth");
    });

    it("sends WS event with correct type", async () => {
      const accessor = createMockAccessor();
      const tools = createBridgeTools(accessor);
      await tools.qwack_propose.execute(
        { proposal: "Add caching", rationale: "Performance" },
        {} as any,
      );
      expect(accessor.sent).toHaveLength(1);
      expect(accessor.sent[0].type).toBe("agent:plan_propose");
      expect(accessor.sent[0].sessionId).toBe("session-1");
      expect(accessor.sent[0].senderId).toBe("qwack-agent");
    });

    it("sends proposal content in payload", async () => {
      const accessor = createMockAccessor();
      const tools = createBridgeTools(accessor);
      await tools.qwack_propose.execute(
        { proposal: "Switch to Postgres", rationale: "Scale" },
        {} as any,
      );
      const payload = accessor.sent[0].payload;
      expect(payload.content).toBe("Switch to Postgres");
      expect(payload.reason).toBe("Scale");
      expect(payload.proposalId).toBeDefined();
    });

    it("returns confirmation with pending count", async () => {
      const accessor = createMockAccessor();
      const tools = createBridgeTools(accessor);
      const result = await tools.qwack_propose.execute(
        { proposal: "Test", rationale: "Test" },
        {} as any,
      );
      expect(result).toContain("✅ Proposal sent");
      expect(result).toContain("1 pending");
    });
  });

  describe("qwack_disagree", () => {
    it("returns no-session message when inactive", async () => {
      const accessor = createMockAccessor({ isActive: false });
      const tools = createBridgeTools(accessor);
      const result = await tools.qwack_disagree.execute(
        { concern: "Bad idea", severity: "minor" },
        {} as any,
      );
      expect(result).toContain("No active Qwack session");
    });

    it("sends WS event for minor disagreement", async () => {
      const accessor = createMockAccessor();
      const tools = createBridgeTools(accessor);
      await tools.qwack_disagree.execute(
        { concern: "Naming convention", severity: "minor" },
        {} as any,
      );
      expect(accessor.sent).toHaveLength(1);
      expect(accessor.sent[0].type).toBe("agent:disagreement");
      expect(accessor.sent[0].payload.severity).toBe("minor");
    });

    it("returns minor message for minor severity", async () => {
      const accessor = createMockAccessor();
      const tools = createBridgeTools(accessor);
      const result = await tools.qwack_disagree.execute(
        { concern: "Style issue", severity: "minor" },
        {} as any,
      );
      expect(result).toContain("📝 Minor concern");
    });

    it("returns major/pause message for major severity", async () => {
      const accessor = createMockAccessor();
      const tools = createBridgeTools(accessor);
      const result = await tools.qwack_disagree.execute(
        { concern: "Security flaw", severity: "major" },
        {} as any,
      );
      expect(result).toContain("⚠️ MAJOR disagreement");
      expect(result).toContain("Paused");
    });

    it("includes suggestion in payload when provided", async () => {
      const accessor = createMockAccessor();
      const tools = createBridgeTools(accessor);
      await tools.qwack_disagree.execute(
        { concern: "Bad approach", severity: "minor", suggestion: "Try X instead" },
        {} as any,
      );
      expect(accessor.sent[0].payload.suggestion).toBe("Try X instead");
    });
  });
});
