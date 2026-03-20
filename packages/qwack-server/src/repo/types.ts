// Buffer is globally available at runtime in Bun/Node.js.
// This declaration satisfies the type checker when @types/node is absent.
declare const Buffer: {
  from(data: Uint8Array | ArrayBuffer | string, encoding?: string): Buffer
}
interface Buffer extends Uint8Array {}

// ─── Record Types (what the repository returns) ─────────────────────────────

export interface UserRecord {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  githubId: string | null
  passwordHash: string | null
  createdAt: number
  updatedAt: number
}

export interface SessionRecord {
  id: string
  title: string
  status: "active" | "inactive"
  creatorId: string | null
  agentAutonomy: string
  permissionModel: string
  disagreementThreshold: string
  planYjsState: Buffer | null
  shortCode: string | null
  contextSnapshot: string | null
  createdAt: number
  updatedAt: number
}

export interface ParticipantRecord {
  id: string
  sessionId: string
  userId: string
  role: string
  isConnected: boolean
  joinedAt: number
}

export interface EventRecord {
  id: string
  sessionId: string
  timestamp: number
  type: string
  actorType: "user" | "agent" | "system"
  actorId: string | null
  payload: string
}

export interface SessionListItem {
  id: string
  title: string
  status: "active" | "inactive"
  shortCode: string | null
  creatorId: string | null
  createdAt: number
  participantCount: number
}

export interface ShortCodeResult {
  id: string
  title: string
  shortCode: string
}

// ─── Input Types (what callers pass in) ──────────────────────────────────────

export interface CreateUserInput {
  id: string
  email: string
  name: string
  avatarUrl?: string | null
  githubId?: string | null
  passwordHash?: string | null
}

export interface CreateSessionInput {
  id: string
  title: string
  creatorId: string
  shortCode: string
  status?: "active" | "inactive"
  agentAutonomy?: string
  permissionModel?: string
  disagreementThreshold?: string
}

export interface UpdateUserInput {
  name?: string
  avatarUrl?: string | null
  githubId?: string | null
  passwordHash?: string | null
}

export interface UpdateSessionInput {
  title?: string
  status?: "active" | "inactive"
  contextSnapshot?: string | null
  planYjsState?: Buffer | null
}

// ─── Repository Interface ────────────────────────────────────────────────────

/**
 * Abstract repository interface for all Qwack data access.
 *
 * Implementations: SQLiteRepository (dev), DynamoRepository (production).
 * All methods are async to support both sync (SQLite) and async (DynamoDB) backends.
 */
export interface IRepository {
  // ── Users ───────────────────────────────────────────────────────────────────

  /** Create a new user record. */
  createUser(input: CreateUserInput): Promise<UserRecord>

  /** Look up a user by their ULID. Returns null if not found. */
  getUserById(id: string): Promise<UserRecord | null>

  /** Look up a user by email address. Returns null if not found. */
  getUserByEmail(email: string): Promise<UserRecord | null>

  /** Look up a user by GitHub OAuth ID. Returns null if not found. */
  getUserByGithubId(githubId: string): Promise<UserRecord | null>

  /** Update mutable user fields. Returns the updated record or null if user not found. */
  updateUser(id: string, updates: UpdateUserInput): Promise<UserRecord | null>

  // ── Sessions ────────────────────────────────────────────────────────────────

  /** Create a new collaboration session. */
  createSession(input: CreateSessionInput): Promise<SessionRecord>

  /** Get a session by its ULID. Returns null if not found. */
  getSessionById(id: string): Promise<SessionRecord | null>

  /** List sessions where the given user is a participant, with participant counts. */
  getSessionsByUser(userId: string): Promise<SessionListItem[]>

  /** Resolve a short join code (e.g. GENTLE-WADDLE-26) to a session. Case-insensitive. */
  getSessionByShortCode(code: string): Promise<ShortCodeResult | null>

  /** Update mutable session fields (title, status, snapshot, plan state). */
  updateSession(id: string, updates: UpdateSessionInput): Promise<void>

  /** Delete a session and all associated data (participants, events). */
  deleteSession(id: string): Promise<void>

  /** Check whether a short code is already in use. */
  isShortCodeTaken(code: string): Promise<boolean>

  // ── Participants ────────────────────────────────────────────────────────────

  /** Add a user as a participant in a session with the given role. */
  addParticipant(sessionId: string, userId: string, role: string): Promise<void>

  /** List all participants in a session. */
  getParticipants(sessionId: string): Promise<ParticipantRecord[]>

  /** Check whether a user is already a participant in a session. */
  isParticipant(sessionId: string, userId: string): Promise<boolean>

  /** Count the number of participants in a session. */
  getParticipantCount(sessionId: string): Promise<number>
  removeParticipant(sessionId: string, userId: string): Promise<void>

  // ── Events ──────────────────────────────────────────────────────────────────

  /** Persist a single session event. */
  putEvent(event: EventRecord): Promise<void>

  /** Persist multiple session events in a single batch write. */
  putEventsBatch(events: EventRecord[]): Promise<void>

  /** Retrieve events for a session, ordered by timestamp ascending. Optional limit. */
  getEvents(sessionId: string, limit?: number): Promise<EventRecord[]>

  /** Delete all events belonging to a session. */
  deleteEventsBySession(sessionId: string): Promise<void>

  // ── Context ─────────────────────────────────────────────────────────────────

  /** Store a context snapshot (JSON string) on a session for host transfer. */
  setContextSnapshot(sessionId: string, snapshot: string): Promise<void>

  /** Retrieve the latest context snapshot for a session. Returns null if none stored. */
  getContextSnapshot(sessionId: string): Promise<string | null>

  /** Retrieve the Yjs binary state for the Plan CRDT document. */
  getSessionPlanState(sessionId: string): Promise<Buffer | null>
}
