import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { CollaboratorState } from "../state/collaborator-state";
import { createQwackTools } from "./tools";
import type { QwackWsClient } from "../ws-client";

function createMockWsClient() {
  const sent: any[] = [];
  return {
    send(msg: any) {
      sent.push(msg);
    },
    sent,
  };
}

function setup() {
  const wsClient = createMockWsClient();
  const state = new CollaboratorState();
  const sessionId = "test-session-123";
  const tools = createQwackTools(
    wsClient as unknown as QwackWsClient,
    state,
    sessionId,
  );
  return { wsClient, state, sessionId, tools };
}

describe("createQwackTools", () => {
  it("returns qwack_propose and qwack_disagree tools", () => {
    const { tools } = setup();
    expect(tools).toHaveProperty("qwack_propose");
    expect(tools).toHaveProperty("qwack_disagree");
    expect(Object.keys(tools)).toHaveLength(2);
  });
});

describe("qwack_propose", () => {
  it("has a description mentioning proposals", () => {
    const { tools } = setup();
    expect(tools.qwack_propose.description).toContain("Propose");
  });

  it("has proposal and rationale args as z.string()", () => {
    const { tools } = setup();
    const { args } = tools.qwack_propose;
    expect(args.proposal).toBeDefined();
    expect(args.rationale).toBeDefined();
    expect(args.proposal instanceof z.ZodString).toBe(true);
    expect(args.rationale instanceof z.ZodString).toBe(true);
  });

  it("execute adds proposal to state", async () => {
    const { tools, state } = setup();
    await tools.qwack_propose.execute(
      { proposal: "Refactor auth", rationale: "Too complex" },
      undefined as any,
    );
    const pending = state.getPendingProposals();
    expect(pending).toHaveLength(1);
    expect(pending[0].content).toBe("Refactor auth");
    expect(pending[0].reason).toBe("Too complex");
  });

  it("execute sends WS event with correct type", async () => {
    const { tools, wsClient } = setup();
    await tools.qwack_propose.execute(
      { proposal: "Add caching", rationale: "Performance" },
      undefined as any,
    );
    expect(wsClient.sent).toHaveLength(1);
    expect(wsClient.sent[0].type).toBe("agent:plan_propose");
  });

  it("execute sends WS event with correct payload shape", async () => {
    const { tools, wsClient, sessionId } = setup();
    await tools.qwack_propose.execute(
      { proposal: "Add caching", rationale: "Performance" },
      undefined as any,
    );
    const msg = wsClient.sent[0];
    expect(msg.sessionId).toBe(sessionId);
    expect(msg.senderId).toBe("qwack-agent");
    expect(typeof msg.timestamp).toBe("number");
    expect(msg.payload.content).toBe("Add caching");
    expect(msg.payload.reason).toBe("Performance");
    expect(typeof msg.payload.proposalId).toBe("string");
  });

  it("execute returns confirmation string with proposal ID", async () => {
    const { tools } = setup();
    const result = await tools.qwack_propose.execute(
      { proposal: "Add tests", rationale: "Coverage" },
      undefined as any,
    );
    expect(result).toContain("✅ Proposal sent to team");
    expect(result).toContain("ID:");
    expect(result).toContain("pending");
  });
});

describe("qwack_disagree", () => {
  it("has a description mentioning disagreement", () => {
    const { tools } = setup();
    expect(tools.qwack_disagree.description).toContain("disagreement");
  });

  it("has concern and severity args", () => {
    const { tools } = setup();
    const { args } = tools.qwack_disagree;
    expect(args.concern).toBeDefined();
    expect(args.severity).toBeDefined();
  });

  it("execute sends WS event for minor disagreement", async () => {
    const { tools, wsClient } = setup();
    await tools.qwack_disagree.execute(
      { concern: "Naming convention", severity: "minor" },
      undefined as any,
    );
    expect(wsClient.sent).toHaveLength(1);
    expect(wsClient.sent[0].type).toBe("agent:disagreement");
    expect(wsClient.sent[0].payload.severity).toBe("minor");
  });

  it("execute returns minor message for severity minor", async () => {
    const { tools } = setup();
    const result = await tools.qwack_disagree.execute(
      { concern: "Naming convention", severity: "minor" },
      undefined as any,
    );
    expect(result).toContain("📝 Minor concern noted");
    expect(result).toContain("Naming convention");
  });

  it("execute returns major/pause message for severity major", async () => {
    const { tools } = setup();
    const result = await tools.qwack_disagree.execute(
      { concern: "SQL injection risk", severity: "major" },
      undefined as any,
    );
    expect(result).toContain("⚠️ MAJOR disagreement flagged");
    expect(result).toContain("paused");
    expect(result).toContain("SQL injection risk");
  });

  it("execute includes suggestion in payload when provided", async () => {
    const { tools, wsClient } = setup();
    await tools.qwack_disagree.execute(
      {
        concern: "Bad pattern",
        severity: "minor",
        suggestion: "Use strategy pattern instead",
      },
      undefined as any,
    );
    expect(wsClient.sent[0].payload.suggestion).toBe(
      "Use strategy pattern instead",
    );
  });
});
