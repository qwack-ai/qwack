import { describe, test, expect } from "bun:test";
import {
  CreateSessionInputSchema,
  SessionSettingsSchema,
  SessionSchema,
  SessionModeSchema,
  SessionStatusSchema,
  AgentAutonomyModeSchema,
  PermissionModelSchema,
  DisagreementThresholdSchema,
} from "./session";
import {
  SESSION_MODES,
  SESSION_STATUSES,
  AGENT_AUTONOMY_MODES,
  PERMISSION_MODELS,
  DISAGREEMENT_THRESHOLDS,
} from "../constants";

describe("Enum schemas match constants", () => {
  test("SessionModeSchema accepts all SESSION_MODES", () => {
    for (const mode of SESSION_MODES) {
      expect(SessionModeSchema.parse(mode)).toBe(mode);
    }
  });

  test("SessionStatusSchema accepts all SESSION_STATUSES", () => {
    for (const s of SESSION_STATUSES) {
      expect(SessionStatusSchema.parse(s)).toBe(s);
    }
  });

  test("AgentAutonomyModeSchema accepts all AGENT_AUTONOMY_MODES", () => {
    for (const m of AGENT_AUTONOMY_MODES) {
      expect(AgentAutonomyModeSchema.parse(m)).toBe(m);
    }
  });

  test("PermissionModelSchema accepts all PERMISSION_MODELS", () => {
    for (const m of PERMISSION_MODELS) {
      expect(PermissionModelSchema.parse(m)).toBe(m);
    }
  });

  test("DisagreementThresholdSchema accepts all DISAGREEMENT_THRESHOLDS", () => {
    for (const t of DISAGREEMENT_THRESHOLDS) {
      expect(DisagreementThresholdSchema.parse(t)).toBe(t);
    }
  });

  test("rejects invalid enum values", () => {
    expect(() => SessionModeSchema.parse("invalid")).toThrow();
    expect(() => SessionStatusSchema.parse("bogus")).toThrow();
    expect(() => AgentAutonomyModeSchema.parse("none")).toThrow();
  });
});

describe("CreateSessionInputSchema", () => {
  test("accepts valid input with all fields", () => {
    const input = {
      title: "My Session",
      mode: "freeform" as const,
      agentAutonomy: "hybrid" as const,
      permissionModel: "host_decides" as const,
      disagreementThreshold: "configurable" as const,
    };
    expect(CreateSessionInputSchema.parse(input)).toEqual(input);
  });

  test("accepts valid input with only required fields", () => {
    const input = { title: "Test", mode: "structured" as const };
    const result = CreateSessionInputSchema.parse(input);
    expect(result.title).toBe("Test");
    expect(result.mode).toBe("structured");
    expect(result.agentAutonomy).toBeUndefined();
  });

  test("rejects empty title", () => {
    expect(() => CreateSessionInputSchema.parse({ title: "", mode: "freeform" })).toThrow();
  });

  test("rejects title over 200 chars", () => {
    const longTitle = "a".repeat(201);
    expect(() => CreateSessionInputSchema.parse({ title: longTitle, mode: "freeform" })).toThrow();
  });

  test("rejects invalid mode", () => {
    expect(() => CreateSessionInputSchema.parse({ title: "Ok", mode: "chaos" })).toThrow();
  });
});

describe("SessionSettingsSchema", () => {
  test("accepts valid settings", () => {
    const settings = {
      mode: "freeform" as const,
      agentAutonomy: "full_peer" as const,
      permissionModel: "majority_vote" as const,
      disagreementThreshold: "pause_all" as const,
    };
    expect(SessionSettingsSchema.parse(settings)).toEqual(settings);
  });

  test("rejects missing required fields", () => {
    expect(() => SessionSettingsSchema.parse({ mode: "freeform" })).toThrow();
  });
});

describe("SessionSchema", () => {
  test("accepts valid session with date coercion", () => {
    const session = {
      id: "ses_abc",
      title: "Test",
      mode: "freeform" as const,
      status: "planning" as const,
      creatorId: "u1",
      opencodeSessionId: null,
      agentAutonomy: "hybrid" as const,
      permissionModel: "host_decides" as const,
      disagreementThreshold: "configurable" as const,
      canvasContent: null,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };
    const result = SessionSchema.parse(session);
    expect(result.createdAt).toBeInstanceOf(Date);
  });
});
