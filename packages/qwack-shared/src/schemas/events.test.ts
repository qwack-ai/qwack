import { describe, test, expect } from "bun:test";
import {
  WsMessageSchema,
  AuthTokenPayloadSchema,
  AuthOkPayloadSchema,
  AuthErrorPayloadSchema,
  PresenceJoinPayloadSchema,
  PresenceLeavePayloadSchema,
  PresenceTypingPayloadSchema,
  PresenceListPayloadSchema,
  CollabMessagePayloadSchema,
  PromptSentPayloadSchema,
  PromptRequestPayloadSchema,
  PromptExecutePayloadSchema,
  AgentOutputPayloadSchema,
  AgentToolUsePayloadSchema,
  AgentToolResultPayloadSchema,
  AgentPermissionPayloadSchema,
  AgentPermissionResponsePayloadSchema,
  AgentCompletePayloadSchema,
  PlanSyncPayloadSchema,
  PlanAwarenessPayloadSchema,
  SessionStatusChangePayloadSchema,
  SessionHostChangePayloadSchema,
  SessionSettingsChangePayloadSchema,
} from "./events";

const validEnvelope = {
  type: "auth:token",
  sessionId: "ses_123",
  senderId: "usr_456",
  timestamp: Date.now(),
  payload: { token: "abc" },
};

describe("WsMessageSchema", () => {
  test("accepts valid envelope", () => {
    expect(WsMessageSchema.parse(validEnvelope)).toEqual(validEnvelope);
  });

  test("rejects missing type", () => {
    const { type, ...rest } = validEnvelope;
    expect(() => WsMessageSchema.parse(rest)).toThrow();
  });

  test("rejects missing sessionId", () => {
    const { sessionId, ...rest } = validEnvelope;
    expect(() => WsMessageSchema.parse(rest)).toThrow();
  });

  test("rejects non-number timestamp", () => {
    expect(() => WsMessageSchema.parse({ ...validEnvelope, timestamp: "now" })).toThrow();
  });
});

describe("Auth payload schemas", () => {
  test("AuthTokenPayloadSchema", () => {
    expect(AuthTokenPayloadSchema.parse({ token: "tok_abc" })).toEqual({ token: "tok_abc" });
    expect(() => AuthTokenPayloadSchema.parse({})).toThrow();
  });

  test("AuthOkPayloadSchema", () => {
    const user = {
      id: "u1", email: "a@b.com", name: "Alice",
      avatarUrl: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const result = AuthOkPayloadSchema.parse({ user });
    expect(result.user.id).toBe("u1");
  });

  test("AuthErrorPayloadSchema", () => {
    expect(AuthErrorPayloadSchema.parse({ message: "bad" })).toEqual({ message: "bad" });
    expect(() => AuthErrorPayloadSchema.parse({ message: 123 })).toThrow();
  });
});

describe("Presence payload schemas", () => {
  test("PresenceJoinPayloadSchema", () => {
    const user = {
      id: "u1", email: "a@b.com", name: "Alice",
      avatarUrl: null, createdAt: new Date(), updatedAt: new Date(),
    };
    expect(PresenceJoinPayloadSchema.parse({ user, role: "host" }).role).toBe("host");
    expect(() => PresenceJoinPayloadSchema.parse({ user, role: "admin" })).toThrow();
  });

  test("PresenceLeavePayloadSchema", () => {
    expect(PresenceLeavePayloadSchema.parse({ userId: "u1" })).toEqual({ userId: "u1" });
  });

  test("PresenceTypingPayloadSchema", () => {
    expect(PresenceTypingPayloadSchema.parse({ userId: "u1" })).toEqual({ userId: "u1" });
  });

  test("PresenceListPayloadSchema accepts array", () => {
    const result = PresenceListPayloadSchema.parse({ participants: [] });
    expect(result.participants).toEqual([]);
  });
});

describe("Collab payload schemas", () => {
  test("CollabMessagePayloadSchema", () => {
    const data = { authorName: "bob", content: "hello" };
    expect(CollabMessagePayloadSchema.parse(data)).toEqual(data);
    expect(() => CollabMessagePayloadSchema.parse({ authorName: "bob" })).toThrow();
  });
});

describe("Prompt payload schemas", () => {
  test("PromptSentPayloadSchema", () => {
    const data = { authorId: "u1", authorName: "bob", content: "do X" };
    expect(PromptSentPayloadSchema.parse(data)).toEqual(data);
  });

  test("PromptRequestPayloadSchema", () => {
    const data = { authorId: "u2", authorName: "sue", content: "try Y" };
    expect(PromptRequestPayloadSchema.parse(data)).toEqual(data);
  });

  test("PromptExecutePayloadSchema", () => {
    const data = { content: "run Z", requestedBy: "u2" };
    expect(PromptExecutePayloadSchema.parse(data)).toEqual(data);
    expect(() => PromptExecutePayloadSchema.parse({ content: "run Z" })).toThrow();
  });
});

describe("Agent payload schemas", () => {
  test("AgentOutputPayloadSchema", () => {
    expect(AgentOutputPayloadSchema.parse({ content: "hi", partId: "p1" })).toBeTruthy();
  });

  test("AgentToolUsePayloadSchema with partId and messageId", () => {
    const data = { tool: "read", input: { path: "/a" }, partId: "p1", messageId: "m1" };
    expect(AgentToolUsePayloadSchema.parse(data)).toEqual(data);
  });

  test("AgentToolUsePayloadSchema with partId only", () => {
    const data = { tool: "read", input: { path: "/a" }, partId: "p1" };
    expect(AgentToolUsePayloadSchema.parse(data)).toEqual(data);
  });

  test("AgentToolUsePayloadSchema rejects missing partId", () => {
    expect(() => AgentToolUsePayloadSchema.parse({ tool: "read", input: { path: "/a" } })).toThrow();
  });

  test("AgentToolUsePayloadSchema accepts unknown input", () => {
    expect(AgentToolUsePayloadSchema.parse({ tool: "read", input: { path: "/a" }, partId: "p1" })).toBeTruthy();
  });

  test("AgentToolResultPayloadSchema with status completed and output", () => {
    const data = { tool: "read", output: "file content", partId: "p1", status: "completed" };
    expect(AgentToolResultPayloadSchema.parse(data)).toEqual(data);
  });

  test("AgentToolResultPayloadSchema with status error and error message", () => {
    const data = { tool: "read", output: null, partId: "p1", error: "File not found", status: "error" };
    expect(AgentToolResultPayloadSchema.parse(data)).toEqual(data);
  });

  test("AgentToolResultPayloadSchema with messageId", () => {
    const data = { tool: "read", output: "content", partId: "p1", messageId: "m1", status: "completed" };
    expect(AgentToolResultPayloadSchema.parse(data)).toEqual(data);
  });

  test("AgentToolResultPayloadSchema rejects missing partId", () => {
    expect(() => AgentToolResultPayloadSchema.parse({ tool: "read", output: "content", status: "completed" })).toThrow();
  });

  test("AgentToolResultPayloadSchema rejects missing status", () => {
    expect(() => AgentToolResultPayloadSchema.parse({ tool: "read", output: "content", partId: "p1" })).toThrow();
  });

  test("AgentToolResultPayloadSchema rejects invalid status", () => {
    expect(() => AgentToolResultPayloadSchema.parse({ tool: "read", output: "content", partId: "p1", status: "pending" })).toThrow();
  });

  test("AgentToolResultPayloadSchema accepts unknown output", () => {
    expect(AgentToolResultPayloadSchema.parse({ tool: "read", output: "file content", partId: "p1", status: "completed" })).toBeTruthy();
  });

  test("AgentPermissionPayloadSchema", () => {
    const data = { tool: "bash", command: "rm -rf", requestId: "r1" };
    expect(AgentPermissionPayloadSchema.parse(data)).toEqual(data);
  });

  test("AgentPermissionResponsePayloadSchema", () => {
    expect(AgentPermissionResponsePayloadSchema.parse({ requestId: "r1", allowed: true })).toBeTruthy();
    expect(() => AgentPermissionResponsePayloadSchema.parse({ requestId: "r1", allowed: "yes" })).toThrow();
  });

  test("AgentCompletePayloadSchema", () => {
    expect(AgentCompletePayloadSchema.parse({ messageId: "m1" })).toEqual({ messageId: "m1" });
  });
});

describe("Plan payload schemas", () => {
  test("PlanSyncPayloadSchema", () => {
    expect(PlanSyncPayloadSchema.parse({ update: "base64data" })).toEqual({ update: "base64data" });
  });

  test("PlanAwarenessPayloadSchema", () => {
    expect(PlanAwarenessPayloadSchema.parse({ update: "awaredata" })).toEqual({ update: "awaredata" });
  });
});

describe("Session payload schemas", () => {
  test("SessionStatusChangePayloadSchema", () => {
    expect(SessionStatusChangePayloadSchema.parse({ status: "active" })).toBeTruthy();
  });

  test("SessionHostChangePayloadSchema", () => {
    expect(SessionHostChangePayloadSchema.parse({ newHostId: "u3" })).toBeTruthy();
  });

  test("SessionSettingsChangePayloadSchema accepts record", () => {
    const data = { settings: { mode: "freeform", custom: 42 } };
    expect(SessionSettingsChangePayloadSchema.parse(data)).toEqual(data);
  });

  test("SessionSettingsChangePayloadSchema rejects non-object settings", () => {
    expect(() => SessionSettingsChangePayloadSchema.parse({ settings: "bad" })).toThrow();
  });
});
