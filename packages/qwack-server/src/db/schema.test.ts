import { describe, test, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { createTestDatabase } from "./test-helpers";
import {
  users,
  sessions,
  sessionParticipants,
  sessionEvents,
} from "./schema";

let db: ReturnType<typeof createTestDatabase>["db"];
let sqlite: ReturnType<typeof createTestDatabase>["sqlite"];

beforeEach(() => {
  const result = createTestDatabase();
  db = result.db;
  sqlite = result.sqlite;
});

describe("users table", () => {
  test("insert and select a user", () => {
    const id = ulid();
    db.insert(users).values({ id, email: "test@example.com", name: "Test User" }).run();

    const result = db.select().from(users).where(eq(users.id, id)).all();
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("test@example.com");
    expect(result[0].name).toBe("Test User");
    expect(result[0].avatarUrl).toBeNull();
    expect(result[0].createdAt).toBeInstanceOf(Date);
  });

  test("enforces unique email", () => {
    db.insert(users).values({ id: ulid(), email: "dup@example.com", name: "A" }).run();
    expect(() => {
      db.insert(users).values({ id: ulid(), email: "dup@example.com", name: "B" }).run();
    }).toThrow();
  });
});

describe("sessions table", () => {
  test("insert with defaults", () => {
    const userId = ulid();
    const sessionId = ulid();
    db.insert(users).values({ id: userId, email: "c@e.com", name: "Creator" }).run();
    db.insert(sessions).values({ id: sessionId, title: "Refactor auth", creatorId: userId }).run();

    const result = db.select().from(sessions).where(eq(sessions.id, sessionId)).all();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("active");
    expect(result[0].agentAutonomy).toBe("hybrid");
    expect(result[0].permissionModel).toBe("host_decides");
    expect(result[0].disagreementThreshold).toBe("configurable");
    expect(result[0].planYjsState).toBeNull();
    expect(result[0].contextSnapshot).toBeNull();
  });

  test("insert with contextSnapshot value", () => {
    const userId = ulid();
    const sessionId = ulid();
    const snapshotValue = "Agent completed task: refactored auth module";
    db.insert(users).values({ id: userId, email: "snap@e.com", name: "Snapshot" }).run();
    db.insert(sessions).values({
      id: sessionId,
      title: "With snapshot",
      creatorId: userId,
      contextSnapshot: snapshotValue,
    }).run();

    const result = db.select().from(sessions).where(eq(sessions.id, sessionId)).all();
    expect(result).toHaveLength(1);
    expect(result[0].contextSnapshot).toBe(snapshotValue);
  });

  test("contextSnapshot can be null", () => {
    const userId = ulid();
    const sessionId = ulid();
    db.insert(users).values({ id: userId, email: "null@e.com", name: "Null" }).run();
    db.insert(sessions).values({
      id: sessionId,
      title: "Null snapshot",
      creatorId: userId,
      contextSnapshot: null,
    }).run();

    const result = db.select().from(sessions).where(eq(sessions.id, sessionId)).all();
    expect(result).toHaveLength(1);
    expect(result[0].contextSnapshot).toBeNull();
  });
});

describe("sessionParticipants table", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = ulid();
    sessionId = ulid();
    db.insert(users).values({ id: userId, email: "p@e.com", name: "Participant" }).run();
    db.insert(sessions).values({ id: sessionId, title: "Test", creatorId: userId }).run();
  });

  test("insert and select participant", () => {
    const partId = ulid();
    db.insert(sessionParticipants)
      .values({ id: partId, sessionId, userId, role: "host" })
      .run();

    const result = db.select().from(sessionParticipants)
      .where(eq(sessionParticipants.id, partId)).all();
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("host");
    expect(result[0].isConnected).toBe(false);
  });

  test("enforces unique (sessionId, userId)", () => {
    db.insert(sessionParticipants).values({ id: ulid(), sessionId, userId }).run();
    expect(() => {
      db.insert(sessionParticipants).values({ id: ulid(), sessionId, userId }).run();
    }).toThrow();
  });
});

describe("sessionEvents table", () => {
  test("insert and select event", () => {
    const userId = ulid();
    const sessionId = ulid();
    const eventId = ulid();
    db.insert(users).values({ id: userId, email: "ev@e.com", name: "Eventer" }).run();
    db.insert(sessions).values({ id: sessionId, title: "Events", creatorId: userId }).run();
    db.insert(sessionEvents).values({
      id: eventId, sessionId, type: "prompt:sent",
      actorType: "user", actorId: userId,
      payload: JSON.stringify({ content: "hello" }),
    }).run();

    const result = db.select().from(sessionEvents)
      .where(eq(sessionEvents.id, eventId)).all();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("prompt:sent");
    expect(result[0].actorType).toBe("user");
    expect(JSON.parse(result[0].payload)).toEqual({ content: "hello" });
  });
});

describe("cascade delete", () => {
  test("deleting session removes participants and events", () => {
    const userId = ulid();
    const sessionId = ulid();
    db.insert(users).values({ id: userId, email: "cas@e.com", name: "Cascade" }).run();
    db.insert(sessions).values({ id: sessionId, title: "Cascade", creatorId: userId }).run();
    db.insert(sessionParticipants).values({ id: ulid(), sessionId, userId }).run();
    db.insert(sessionEvents).values({
      id: ulid(), sessionId, type: "session:created", actorType: "system", payload: "{}",
    }).run();

    // Verify data exists
    const partsBefore = db.select().from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, sessionId)).all();
    const eventsBefore = db.select().from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId)).all();
    expect(partsBefore).toHaveLength(1);
    expect(eventsBefore).toHaveLength(1);

    // Delete session
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();

    // Verify cascade
    const partsAfter = db.select().from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, sessionId)).all();
    const eventsAfter = db.select().from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId)).all();
    expect(partsAfter).toHaveLength(0);
    expect(eventsAfter).toHaveLength(0);
  });
});
