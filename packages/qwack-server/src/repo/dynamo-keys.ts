/// <reference types="bun-types" />
/**
 * DynamoDB single-table key builders and item marshalling helpers.
 *
 * Pure data-transformation functions — no AWS SDK imports, no side effects.
 */
import type { UserRecord, SessionRecord, ParticipantRecord, EventRecord } from "./types"

// ---------------------------------------------------------------------------
// Key Prefixes
// ---------------------------------------------------------------------------

export const PK_USER = "USER#"
export const PK_EMAIL = "EMAIL#"
export const PK_GITHUB = "GITHUB#"
export const PK_SESSION = "SESSION#"
export const PK_CODE = "CODE#"
export const PK_CONN = "CONN#"

export const SK_PROFILE = "PROFILE"
export const SK_LOOKUP = "LOOKUP"
export const SK_META = "META"
export const SK_PART_PREFIX = "PART#"
export const SK_EVT_PREFIX = "EVT#"

export const GSI1_NAME = "GSI1"

/** 30 days in seconds — used for DynamoDB TTL on events. */
export const EVENT_TTL_SECONDS = 30 * 24 * 60 * 60

// ---------------------------------------------------------------------------
// Key Builders — User
// ---------------------------------------------------------------------------

export function userPK(userId: string): string {
  return `${PK_USER}${userId}`
}

export function userSK(): string {
  return SK_PROFILE
}

// ---------------------------------------------------------------------------
// Key Builders — Lookup (Email / GitHub / Code)
// ---------------------------------------------------------------------------

export function emailLookupPK(email: string): string {
  return `${PK_EMAIL}${email}`
}

export function githubLookupPK(githubId: string): string {
  return `${PK_GITHUB}${githubId}`
}

export function lookupSK(): string {
  return SK_LOOKUP
}

export function codeLookupPK(shortCode: string): string {
  return `${PK_CODE}${shortCode}`
}

// ---------------------------------------------------------------------------
// Key Builders — Session
// ---------------------------------------------------------------------------

export function sessionPK(sessionId: string): string {
  return `${PK_SESSION}${sessionId}`
}

export function sessionSK(): string {
  return SK_META
}

// ---------------------------------------------------------------------------
// Key Builders — Participant
// ---------------------------------------------------------------------------

export function participantSK(userId: string): string {
  return `${SK_PART_PREFIX}${userId}`
}

export function participantGSI1PK(userId: string): string {
  return `${PK_USER}${userId}`
}

export function participantGSI1SK(sessionId: string): string {
  return `${PK_SESSION}${sessionId}`
}

// ---------------------------------------------------------------------------
// Key Builders — Event
// ---------------------------------------------------------------------------

export function eventSK(eventId: string): string {
  return `${SK_EVT_PREFIX}${eventId}`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Remove keys whose value is `undefined` so DynamoDB doesn't store them.
 * DynamoDB DocumentClient chokes on explicit `undefined` values.
 */
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v
    }
  }
  return clean
}

// ---------------------------------------------------------------------------
// Marshalling — User
// ---------------------------------------------------------------------------

export function toUserItem(user: UserRecord): Record<string, unknown> {
  return stripUndefined({
    PK: userPK(user.id),
    SK: userSK(),
    entityType: "User",
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? undefined,
    githubId: user.githubId ?? undefined,
    passwordHash: user.passwordHash ?? undefined,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  })
}

export function fromUserItem(item: Record<string, unknown>): UserRecord {
  return {
    id: item.id as string,
    email: item.email as string,
    name: item.name as string,
    avatarUrl: (item.avatarUrl as string) ?? null,
    githubId: (item.githubId as string) ?? null,
    passwordHash: (item.passwordHash as string) ?? null,
    createdAt: item.createdAt as number,
    updatedAt: item.updatedAt as number,
  }
}

// ---------------------------------------------------------------------------
// Marshalling — Email Lookup
// ---------------------------------------------------------------------------

export function toEmailLookupItem(email: string, userId: string): Record<string, unknown> {
  return {
    PK: emailLookupPK(email),
    SK: lookupSK(),
    entityType: "EmailLookup",
    userId,
  }
}

// ---------------------------------------------------------------------------
// Marshalling — GitHub Lookup
// ---------------------------------------------------------------------------

export function toGithubLookupItem(githubId: string, userId: string): Record<string, unknown> {
  return {
    PK: githubLookupPK(githubId),
    SK: lookupSK(),
    entityType: "GithubLookup",
    userId,
  }
}

// ---------------------------------------------------------------------------
// Marshalling — Session
// ---------------------------------------------------------------------------

export function toSessionItem(session: SessionRecord): Record<string, unknown> {
  return stripUndefined({
    PK: sessionPK(session.id),
    SK: sessionSK(),
    entityType: "Session",
    id: session.id,
    title: session.title,
    status: session.status,
    creatorId: session.creatorId ?? undefined,
    agentAutonomy: session.agentAutonomy,
    permissionModel: session.permissionModel,
    disagreementThreshold: session.disagreementThreshold,
    planYjsState: session.planYjsState ? Buffer.from(session.planYjsState).toString("base64") : undefined,
    shortCode: session.shortCode ?? undefined,
    contextSnapshot: session.contextSnapshot ?? undefined,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  })
}

export function fromSessionItem(item: Record<string, unknown>): SessionRecord {
  return {
    id: item.id as string,
    title: item.title as string,
    status: item.status as SessionRecord["status"],
    creatorId: (item.creatorId as string) ?? null,
    agentAutonomy: item.agentAutonomy as string,
    permissionModel: item.permissionModel as string,
    disagreementThreshold: item.disagreementThreshold as string,
    planYjsState: item.planYjsState ? Buffer.from(item.planYjsState as string, "base64") : null,
    shortCode: (item.shortCode as string) ?? null,
    contextSnapshot: (item.contextSnapshot as string) ?? null,
    createdAt: item.createdAt as number,
    updatedAt: item.updatedAt as number,
  }
}

// ---------------------------------------------------------------------------
// Marshalling — Code Lookup
// ---------------------------------------------------------------------------

export function toCodeLookupItem(shortCode: string, sessionId: string): Record<string, unknown> {
  return {
    PK: codeLookupPK(shortCode),
    SK: lookupSK(),
    entityType: "CodeLookup",
    sessionId,
  }
}

// ---------------------------------------------------------------------------
// Marshalling — Participant
// ---------------------------------------------------------------------------

export function toParticipantItem(participant: ParticipantRecord): Record<string, unknown> {
  return stripUndefined({
    PK: sessionPK(participant.sessionId),
    SK: participantSK(participant.userId),
    GSI1PK: participantGSI1PK(participant.userId),
    GSI1SK: participantGSI1SK(participant.sessionId),
    entityType: "Participant",
    id: participant.id,
    sessionId: participant.sessionId,
    userId: participant.userId,
    role: participant.role,
    isConnected: participant.isConnected,
    joinedAt: participant.joinedAt,
  })
}

export function fromParticipantItem(item: Record<string, unknown>): ParticipantRecord {
  return {
    id: item.id as string,
    sessionId: item.sessionId as string,
    userId: item.userId as string,
    role: item.role as string,
    isConnected: (item.isConnected as boolean) ?? false,
    joinedAt: item.joinedAt as number,
  }
}

// ---------------------------------------------------------------------------
// Marshalling — Event
// ---------------------------------------------------------------------------

export function toEventItem(event: EventRecord): Record<string, unknown> {
  return stripUndefined({
    PK: sessionPK(event.sessionId),
    SK: eventSK(event.id),
    entityType: "Event",
    id: event.id,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    type: event.type,
    actorType: event.actorType,
    actorId: event.actorId ?? undefined,
    payload: event.payload,
    ttl: Math.floor(Date.now() / 1000) + EVENT_TTL_SECONDS,
  })
}

export function fromEventItem(item: Record<string, unknown>): EventRecord {
  return {
    id: item.id as string,
    sessionId: item.sessionId as string,
    timestamp: item.timestamp as number,
    type: item.type as string,
    actorType: item.actorType as EventRecord["actorType"],
    actorId: (item.actorId as string) ?? null,
    payload: item.payload as string,
  }
}
