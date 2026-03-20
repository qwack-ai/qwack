import { eq, and, asc } from "drizzle-orm"
import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import { ulid } from "ulid"
import type { AppDatabase } from "../db/index"
import { schema } from "../db/index"
import type {
  IRepository,
  UserRecord,
  SessionRecord,
  ParticipantRecord,
  EventRecord,
  SessionListItem,
  ShortCodeResult,
  CreateUserInput,
  CreateSessionInput,
  UpdateUserInput,
  UpdateSessionInput,
} from "./types"

type UserRow = InferSelectModel<typeof schema.users>
type SessionRow = InferSelectModel<typeof schema.sessions>
type ParticipantRow = InferSelectModel<typeof schema.sessionParticipants>
type EventRow = InferSelectModel<typeof schema.sessionEvents>

export class SqliteRepository implements IRepository {
  constructor(private db: AppDatabase) {}

  // ── Row Mappers ──────────────────────────────────────────────────────────────

  private toUserRecord(row: UserRow): UserRecord {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatarUrl ?? null,
      githubId: row.githubId ?? null,
      passwordHash: row.passwordHash ?? null,
      createdAt: row.createdAt instanceof Date ? Math.floor(row.createdAt.getTime() / 1000) : Number(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? Math.floor(row.updatedAt.getTime() / 1000) : Number(row.updatedAt),
    }
  }

  private toSessionRecord(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      creatorId: row.creatorId ?? null,
      agentAutonomy: row.agentAutonomy,
      permissionModel: row.permissionModel,
      disagreementThreshold: row.disagreementThreshold,
      planYjsState: row.planYjsState ?? null,
      shortCode: row.shortCode ?? null,
      contextSnapshot: row.contextSnapshot ?? null,
      createdAt: row.createdAt instanceof Date ? Math.floor(row.createdAt.getTime() / 1000) : Number(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? Math.floor(row.updatedAt.getTime() / 1000) : Number(row.updatedAt),
    }
  }

  private toParticipantRecord(row: ParticipantRow): ParticipantRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      userId: row.userId,
      role: row.role,
      isConnected: row.isConnected ?? false,
      joinedAt: row.joinedAt instanceof Date ? Math.floor(row.joinedAt.getTime() / 1000) : Number(row.joinedAt),
    }
  }

  private toEventRecord(row: EventRow): EventRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      timestamp: row.timestamp instanceof Date ? Math.floor(row.timestamp.getTime() / 1000) : Number(row.timestamp),
      type: row.type,
      actorType: row.actorType,
      actorId: row.actorId ?? null,
      payload: row.payload,
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const now = Math.floor(Date.now() / 1000)
    this.db
      .insert(schema.users)
      .values({
        id: input.id,
        email: input.email,
        name: input.name,
        avatarUrl: input.avatarUrl ?? null,
        githubId: input.githubId ?? null,
        passwordHash: input.passwordHash ?? null,
        createdAt: new Date(now * 1000),
        updatedAt: new Date(now * 1000),
      })
      .run()
    const row = this.db.select().from(schema.users).where(eq(schema.users.id, input.id)).get()!
    return this.toUserRecord(row)
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const row = this.db.select().from(schema.users).where(eq(schema.users.id, id)).get()
    return row ? this.toUserRecord(row) : null
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const row = this.db.select().from(schema.users).where(eq(schema.users.email, email)).get()
    return row ? this.toUserRecord(row) : null
  }

  async getUserByGithubId(githubId: string): Promise<UserRecord | null> {
    const row = this.db.select().from(schema.users).where(eq(schema.users.githubId, githubId)).get()
    return row ? this.toUserRecord(row) : null
  }

  async updateUser(id: string, updates: UpdateUserInput): Promise<UserRecord | null> {
    const existing = this.db.select().from(schema.users).where(eq(schema.users.id, id)).get()
    if (!existing) return null
    this.db
      .update(schema.users)
      .set({ ...updates })
      .where(eq(schema.users.id, id))
      .run()
    const row = this.db.select().from(schema.users).where(eq(schema.users.id, id)).get()
    return row ? this.toUserRecord(row) : null
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const now = Math.floor(Date.now() / 1000)
    this.db
      .insert(schema.sessions)
      .values({
        id: input.id,
        title: input.title,
        status: input.status ?? "active",
        creatorId: input.creatorId,
        shortCode: input.shortCode,
        agentAutonomy: input.agentAutonomy ?? "hybrid",
        permissionModel: input.permissionModel ?? "host_decides",
        disagreementThreshold: input.disagreementThreshold ?? "configurable",
        createdAt: new Date(now * 1000),
        updatedAt: new Date(now * 1000),
      })
      .run()
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, input.id)).get()!
    return this.toSessionRecord(row)
  }

  async getSessionById(id: string): Promise<SessionRecord | null> {
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    return row ? this.toSessionRecord(row) : null
  }

  async getSessionsByUser(userId: string): Promise<SessionListItem[]> {
    const participations = this.db
      .select()
      .from(schema.sessionParticipants)
      .where(eq(schema.sessionParticipants.userId, userId))
      .all()

    const results: SessionListItem[] = []
    for (const p of participations) {
      const session = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, p.sessionId)).get()
      if (!session) continue

      const participantCount = this.db
        .select()
        .from(schema.sessionParticipants)
        .where(eq(schema.sessionParticipants.sessionId, p.sessionId))
        .all().length

      results.push({
        id: session.id,
        title: session.title,
        status: session.status,
        shortCode: session.shortCode ?? null,
        creatorId: session.creatorId ?? null,
        createdAt:
          session.createdAt instanceof Date
            ? Math.floor(session.createdAt.getTime() / 1000)
            : Number(session.createdAt),
        participantCount,
      })
    }
    return results
  }

  async getSessionByShortCode(code: string): Promise<ShortCodeResult | null> {
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.shortCode, code.toUpperCase())).get()
    if (!row || !row.shortCode) return null
    return {
      id: row.id,
      title: row.title,
      shortCode: row.shortCode,
    }
  }

  async updateSession(id: string, updates: UpdateSessionInput): Promise<void> {
    const defined = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    )
    if (Object.keys(defined).length === 0) return
    this.db.update(schema.sessions)
      .set(defined as Partial<InferInsertModel<typeof schema.sessions>>)
      .where(eq(schema.sessions.id, id))
      .run()
  }

  async deleteSession(id: string): Promise<void> {
    this.db.delete(schema.sessionParticipants).where(eq(schema.sessionParticipants.sessionId, id)).run()
    this.db.delete(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, id)).run()
    this.db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run()
  }

  async isShortCodeTaken(code: string): Promise<boolean> {
    const existing = this.db.select().from(schema.sessions).where(eq(schema.sessions.shortCode, code)).get()
    return !!existing
  }

  // ── Participants ──────────────────────────────────────────────────────────

  async addParticipant(sessionId: string, userId: string, role: string): Promise<void> {
    this.db
      .insert(schema.sessionParticipants)
      .values({
        id: ulid(),
        sessionId,
        userId,
        role,
      })
      .run()
  }

  async getParticipants(sessionId: string): Promise<ParticipantRecord[]> {
    const rows = this.db
      .select()
      .from(schema.sessionParticipants)
      .where(eq(schema.sessionParticipants.sessionId, sessionId))
      .all()
    return rows.map((row) => this.toParticipantRecord(row))
  }

  async isParticipant(sessionId: string, userId: string): Promise<boolean> {
    const row = this.db
      .select()
      .from(schema.sessionParticipants)
      .where(and(eq(schema.sessionParticipants.sessionId, sessionId), eq(schema.sessionParticipants.userId, userId)))
      .get()
    return !!row
  }

  async getParticipantCount(sessionId: string): Promise<number> {
    const rows = this.db
      .select()
      .from(schema.sessionParticipants)
      .where(eq(schema.sessionParticipants.sessionId, sessionId))
      .all()
    return rows.length
  }

  // ── Events ────────────────────────────────────────────────────────────────

  async putEvent(event: EventRecord): Promise<void> {
    this.db
      .insert(schema.sessionEvents)
      .values({
        id: event.id,
        sessionId: event.sessionId,
        timestamp: new Date(event.timestamp * 1000),
        type: event.type,
        actorType: event.actorType,
        actorId: event.actorId,
        payload: event.payload,
      })
      .run()
  }

  async putEventsBatch(events: EventRecord[]): Promise<void> {
    for (const event of events) {
      await this.putEvent(event)
    }
  }

  async getEvents(sessionId: string, limit?: number): Promise<EventRecord[]> {
    const rows = this.db
      .select()
      .from(schema.sessionEvents)
      .where(eq(schema.sessionEvents.sessionId, sessionId))
      .orderBy(asc(schema.sessionEvents.timestamp))
      .limit(limit ?? 500)
      .all()
    return rows.map((row) => this.toEventRecord(row))
  }

  async deleteEventsBySession(sessionId: string): Promise<void> {
    this.db.delete(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, sessionId)).run()
  }

  // ── Context ───────────────────────────────────────────────────────────────

  async setContextSnapshot(sessionId: string, snapshot: string): Promise<void> {
    this.db.update(schema.sessions).set({ contextSnapshot: snapshot }).where(eq(schema.sessions.id, sessionId)).run()
  }

  async getContextSnapshot(sessionId: string): Promise<string | null> {
    const row = this.db
      .select({ contextSnapshot: schema.sessions.contextSnapshot })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get()
    return row?.contextSnapshot ?? null
  }

  async getSessionPlanState(sessionId: string): Promise<Buffer | null> {
    const row = this.db
      .select({ planYjsState: schema.sessions.planYjsState })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get()
    return row?.planYjsState ?? null
  }
}
