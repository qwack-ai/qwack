/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, mock } from "bun:test"
import { mockClient } from "aws-sdk-client-mock"
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb"
import { DynamoRepository } from "./dynamo"
import type { CreateUserInput, CreateSessionInput, EventRecord } from "./types"
import {
  userPK,
  userSK,
  emailLookupPK,
  githubLookupPK,
  lookupSK,
  sessionPK,
  sessionSK,
  codeLookupPK,
  participantSK,
  participantGSI1PK,
  participantGSI1SK,
  SK_PART_PREFIX,
  SK_EVT_PREFIX,
  GSI1_NAME,
  toUserItem,
  toSessionItem,
  toParticipantItem,
  toEventItem,
} from "./dynamo-keys"

const ddbMock = mockClient(DynamoDBDocumentClient)
const TABLE = "test-table"

beforeEach(() => {
  ddbMock.reset()
})

function createRepo(): DynamoRepository {
  return new DynamoRepository(TABLE)
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
const USER_EMAIL = "alice@qwack.dev"
const USER_GITHUB = "gh-12345"

function userInput(overrides?: Partial<CreateUserInput>): CreateUserInput {
  return {
    id: USER_ID,
    email: USER_EMAIL,
    name: "Alice",
    ...overrides,
  }
}

function userItem(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    PK: userPK(USER_ID),
    SK: userSK(),
    entityType: "User",
    id: USER_ID,
    email: USER_EMAIL,
    name: "Alice",
    createdAt: 1700000000,
    updatedAt: 1700000000,
    ...overrides,
  }
}

const SESSION_ID = "01ARZ3NDEKTSV4RRFFQ69G5SES"
const SHORT_CODE = "GENTLE-WADDLE-26"

function sessionInput(overrides?: Partial<CreateSessionInput>): CreateSessionInput {
  return {
    id: SESSION_ID,
    title: "Test Session",
    creatorId: USER_ID,
    shortCode: SHORT_CODE,
    ...overrides,
  }
}

function sessionItem(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    PK: sessionPK(SESSION_ID),
    SK: sessionSK(),
    entityType: "Session",
    id: SESSION_ID,
    title: "Test Session",
    status: "active",
    creatorId: USER_ID,
    agentAutonomy: "hybrid",
    permissionModel: "host_decides",
    disagreementThreshold: "configurable",
    shortCode: SHORT_CODE,
    createdAt: 1700000000,
    updatedAt: 1700000000,
    ...overrides,
  }
}

function eventRecord(id: string, sessionId: string = SESSION_ID): EventRecord {
  return {
    id,
    sessionId,
    timestamp: 1700000000,
    type: "prompt:sent",
    actorType: "user",
    actorId: USER_ID,
    payload: JSON.stringify({ content: "hello" }),
  }
}

// ─── User Tests ───────────────────────────────────────────────────────────────

describe("createUser", () => {
  test("creates user with email lookup (no github)", async () => {
    ddbMock.on(PutCommand).resolves({})

    const repo = createRepo()
    const result = await repo.createUser(userInput())

    expect(result.id).toBe(USER_ID)
    expect(result.email).toBe(USER_EMAIL)
    expect(result.name).toBe("Alice")
    expect(result.githubId).toBeNull()
    expect(result.passwordHash).toBeNull()

    const puts = ddbMock.commandCalls(PutCommand)
    expect(puts).toHaveLength(2) // user + email lookup
    expect(puts[0].args[0].input.Item!.PK).toBe(userPK(USER_ID))
    expect(puts[1].args[0].input.Item!.PK).toBe(emailLookupPK(USER_EMAIL))
  })

  test("creates user with github lookup", async () => {
    ddbMock.on(PutCommand).resolves({})

    const repo = createRepo()
    const result = await repo.createUser(userInput({ githubId: USER_GITHUB }))

    expect(result.githubId).toBe(USER_GITHUB)

    const puts = ddbMock.commandCalls(PutCommand)
    expect(puts).toHaveLength(3) // user + email lookup + github lookup
    expect(puts[2].args[0].input.Item!.PK).toBe(githubLookupPK(USER_GITHUB))
  })
})

describe("getUserById", () => {
  test("returns user when found", async () => {
    ddbMock.on(GetCommand).resolves({ Item: userItem() })

    const repo = createRepo()
    const result = await repo.getUserById(USER_ID)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(USER_ID)
    expect(result!.email).toBe(USER_EMAIL)

    const gets = ddbMock.commandCalls(GetCommand)
    expect(gets[0].args[0].input.Key).toEqual({ PK: userPK(USER_ID), SK: userSK() })
  })

  test("returns null when not found", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.getUserById("nonexistent")

    expect(result).toBeNull()
  })
})

describe("getUserByEmail", () => {
  test("performs two-step lookup", async () => {
    // First call: email lookup
    ddbMock
      .on(GetCommand, { Key: { PK: emailLookupPK(USER_EMAIL), SK: lookupSK() } })
      .resolves({ Item: { PK: emailLookupPK(USER_EMAIL), SK: lookupSK(), userId: USER_ID } })
    // Second call: user fetch
    ddbMock.on(GetCommand, { Key: { PK: userPK(USER_ID), SK: userSK() } }).resolves({ Item: userItem() })

    const repo = createRepo()
    const result = await repo.getUserByEmail(USER_EMAIL)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(USER_ID)

    const gets = ddbMock.commandCalls(GetCommand)
    expect(gets).toHaveLength(2)
  })

  test("returns null when email not found", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.getUserByEmail("nobody@test.com")

    expect(result).toBeNull()
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1) // only lookup, no user fetch
  })
})

describe("getUserByGithubId", () => {
  test("performs two-step lookup", async () => {
    ddbMock
      .on(GetCommand, { Key: { PK: githubLookupPK(USER_GITHUB), SK: lookupSK() } })
      .resolves({ Item: { PK: githubLookupPK(USER_GITHUB), SK: lookupSK(), userId: USER_ID } })
    ddbMock.on(GetCommand, { Key: { PK: userPK(USER_ID), SK: userSK() } }).resolves({ Item: userItem() })

    const repo = createRepo()
    const result = await repo.getUserByGithubId(USER_GITHUB)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(USER_ID)
  })

  test("returns null when github id not found", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.getUserByGithubId("no-such-gh")

    expect(result).toBeNull()
  })
})

describe("updateUser", () => {
  test("updates name and returns fresh record", async () => {
    // getUserById (exists check) + getUserById (return fresh)
    ddbMock.on(GetCommand).resolves({ Item: userItem() })
    ddbMock.on(UpdateCommand).resolves({})

    const repo = createRepo()
    const result = await repo.updateUser(USER_ID, { name: "Bob" })

    expect(result).not.toBeNull()

    const updates = ddbMock.commandCalls(UpdateCommand)
    expect(updates).toHaveLength(1)
    const expr = updates[0].args[0].input.UpdateExpression as string
    expect(expr).toContain("#n = :n")
    expect(updates[0].args[0].input.ExpressionAttributeValues![":n"]).toBe("Bob")
  })

  test("returns null when user does not exist", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.updateUser("nonexistent", { name: "Bob" })

    expect(result).toBeNull()
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  test("updates github lookup when githubId changes", async () => {
    ddbMock.on(GetCommand).resolves({ Item: userItem({ githubId: "old-gh" }) })
    ddbMock.on(UpdateCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})

    const repo = createRepo()
    await repo.updateUser(USER_ID, { githubId: "new-gh" })

    const puts = ddbMock.commandCalls(PutCommand)
    // Old lookup "deleted" (overwritten) + new lookup
    expect(puts).toHaveLength(2)
    expect(puts[1].args[0].input.Item!.PK).toBe(githubLookupPK("new-gh"))
  })
})

// ─── Session Tests ────────────────────────────────────────────────────────────

describe("createSession", () => {
  test("creates session with code lookup", async () => {
    ddbMock.on(PutCommand).resolves({})

    const repo = createRepo()
    const result = await repo.createSession(sessionInput())

    expect(result.id).toBe(SESSION_ID)
    expect(result.title).toBe("Test Session")
    expect(result.status).toBe("active")
    expect(result.shortCode).toBe(SHORT_CODE)
    expect(result.agentAutonomy).toBe("hybrid")

    const puts = ddbMock.commandCalls(PutCommand)
    expect(puts).toHaveLength(2) // session + code lookup
    expect(puts[0].args[0].input.Item!.PK).toBe(sessionPK(SESSION_ID))
    expect(puts[1].args[0].input.Item!.PK).toBe(codeLookupPK(SHORT_CODE))
  })

  test("uses provided status and autonomy", async () => {
    ddbMock.on(PutCommand).resolves({})

    const repo = createRepo()
    const result = await repo.createSession(sessionInput({ status: "paused", agentAutonomy: "full_peer" }))

    expect(result.status).toBe("paused")
    expect(result.agentAutonomy).toBe("full_peer")
  })
})

describe("getSessionById", () => {
  test("returns session when found", async () => {
    ddbMock.on(GetCommand).resolves({ Item: sessionItem() })

    const repo = createRepo()
    const result = await repo.getSessionById(SESSION_ID)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(SESSION_ID)
    expect(result!.title).toBe("Test Session")
  })

  test("returns null when not found", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.getSessionById("nonexistent")

    expect(result).toBeNull()
  })
})

describe("getSessionsByUser", () => {
  test("queries GSI1 and fetches each session", async () => {
    const sessId2 = "01ARZ3NDEKTSV4RRFFQ69G5SE2"
    // GSI1 query returns participant items
    ddbMock
      .on(QueryCommand, {
        IndexName: GSI1_NAME,
      })
      .resolves({
        Items: [
          { sessionId: SESSION_ID, userId: USER_ID },
          { sessionId: sessId2, userId: USER_ID },
        ],
      })

    // getSessionById calls for each session
    ddbMock.on(GetCommand, { Key: { PK: sessionPK(SESSION_ID), SK: sessionSK() } }).resolves({ Item: sessionItem() })
    ddbMock
      .on(GetCommand, { Key: { PK: sessionPK(sessId2), SK: sessionSK() } })
      .resolves({ Item: sessionItem({ id: sessId2, title: "Session 2" }) })

    // getParticipantCount queries
    ddbMock
      .on(QueryCommand, {
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      })
      .resolves({ Count: 2 })

    const repo = createRepo()
    const result = await repo.getSessionsByUser(USER_ID)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe(SESSION_ID)
    expect(result[0].participantCount).toBe(2)
  })

  test("returns empty array when no sessions", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const repo = createRepo()
    const result = await repo.getSessionsByUser(USER_ID)

    expect(result).toEqual([])
  })

  test("skips sessions that no longer exist", async () => {
    ddbMock.on(QueryCommand, { IndexName: GSI1_NAME }).resolves({
      Items: [{ sessionId: SESSION_ID, userId: USER_ID }],
    })
    // Session not found
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.getSessionsByUser(USER_ID)

    expect(result).toEqual([])
  })
})

describe("getSessionByShortCode", () => {
  test("resolves short code case-insensitively", async () => {
    ddbMock
      .on(GetCommand, { Key: { PK: codeLookupPK("GENTLE-WADDLE-26"), SK: lookupSK() } })
      .resolves({ Item: { sessionId: SESSION_ID } })
    ddbMock.on(GetCommand, { Key: { PK: sessionPK(SESSION_ID), SK: sessionSK() } }).resolves({ Item: sessionItem() })

    const repo = createRepo()
    const result = await repo.getSessionByShortCode("gentle-waddle-26")

    expect(result).not.toBeNull()
    expect(result!.id).toBe(SESSION_ID)
    expect(result!.title).toBe("Test Session")
    expect(result!.shortCode).toBe(SHORT_CODE)
  })

  test("returns null when code not found", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.getSessionByShortCode("NOPE-NOPE-99")

    expect(result).toBeNull()
  })

  test("returns null when session behind code is missing", async () => {
    ddbMock
      .on(GetCommand, { Key: { PK: codeLookupPK("GENTLE-WADDLE-26"), SK: lookupSK() } })
      .resolves({ Item: { sessionId: SESSION_ID } })
    ddbMock.on(GetCommand, { Key: { PK: sessionPK(SESSION_ID), SK: sessionSK() } }).resolves({})

    const repo = createRepo()
    const result = await repo.getSessionByShortCode("GENTLE-WADDLE-26")

    expect(result).toBeNull()
  })
})

describe("updateSession", () => {
  test("builds dynamic UpdateExpression", async () => {
    ddbMock.on(UpdateCommand).resolves({})

    const repo = createRepo()
    await repo.updateSession(SESSION_ID, { title: "New Title", status: "paused" })

    const updates = ddbMock.commandCalls(UpdateCommand)
    expect(updates).toHaveLength(1)
    const expr = updates[0].args[0].input.UpdateExpression as string
    expect(expr).toContain("#title = :title")
    expect(expr).toContain("#status = :status")
    expect(expr).toContain("#updatedAt = :updatedAt")
    expect(updates[0].args[0].input.ExpressionAttributeValues![":title"]).toBe("New Title")
  })

  test("encodes planYjsState as base64", async () => {
    ddbMock.on(UpdateCommand).resolves({})

    const buf = Buffer.from("yjs-binary-data")
    const repo = createRepo()
    await repo.updateSession(SESSION_ID, { planYjsState: buf })

    const updates = ddbMock.commandCalls(UpdateCommand)
    const encoded = updates[0].args[0].input.ExpressionAttributeValues![":planYjsState"]
    expect(encoded).toBe(buf.toString("base64"))
  })

  test("sets planYjsState to null when passed null", async () => {
    ddbMock.on(UpdateCommand).resolves({})

    const repo = createRepo()
    await repo.updateSession(SESSION_ID, { planYjsState: null })

    const updates = ddbMock.commandCalls(UpdateCommand)
    const val = updates[0].args[0].input.ExpressionAttributeValues![":planYjsState"]
    expect(val).toBeNull()
  })
})

describe("deleteSession", () => {
  test("queries all items and batch-deletes", async () => {
    // Query returns META + 2 PARTs + 1 EVT
    ddbMock
      .on(QueryCommand, {
        KeyConditionExpression: "PK = :pk",
      })
      .resolves({
        Items: [
          { PK: sessionPK(SESSION_ID), SK: sessionSK() },
          { PK: sessionPK(SESSION_ID), SK: "PART#user1" },
          { PK: sessionPK(SESSION_ID), SK: "PART#user2" },
          { PK: sessionPK(SESSION_ID), SK: "EVT#01abc" },
        ],
      })
    // getSessionById for shortCode
    ddbMock.on(GetCommand).resolves({ Item: sessionItem() })
    ddbMock.on(BatchWriteCommand).resolves({})

    const repo = createRepo()
    await repo.deleteSession(SESSION_ID)

    const batches = ddbMock.commandCalls(BatchWriteCommand)
    expect(batches).toHaveLength(1) // 5 items < 25, one batch
    const requests = batches[0].args[0].input.RequestItems![TABLE]!
    expect(requests).toHaveLength(5) // 4 query items + 1 code lookup
  })

  test("handles pagination and chunking for large sessions", async () => {
    // Build 30 items (> 25 batch limit)
    const items = Array.from({ length: 30 }, (_, i) => ({
      PK: sessionPK(SESSION_ID),
      SK: `EVT#evt-${String(i).padStart(3, "0")}`,
    }))

    // First query page returns 20 items with LastEvaluatedKey
    ddbMock
      .on(QueryCommand, { KeyConditionExpression: "PK = :pk" })
      .resolvesOnce({
        Items: items.slice(0, 20),
        LastEvaluatedKey: { PK: sessionPK(SESSION_ID), SK: items[19].SK },
      })
      .resolvesOnce({
        Items: items.slice(20),
      })

    // getSessionById — no shortCode
    ddbMock.on(GetCommand).resolves({ Item: sessionItem({ shortCode: undefined }) })
    ddbMock.on(BatchWriteCommand).resolves({})

    const repo = createRepo()
    await repo.deleteSession(SESSION_ID)

    const batches = ddbMock.commandCalls(BatchWriteCommand)
    expect(batches).toHaveLength(2) // 30 items → 25 + 5
    expect(batches[0].args[0].input.RequestItems![TABLE]!).toHaveLength(25)
    expect(batches[1].args[0].input.RequestItems![TABLE]!).toHaveLength(5)
  })
})

describe("isShortCodeTaken", () => {
  test("returns true when code exists", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { sessionId: SESSION_ID } })

    const repo = createRepo()
    expect(await repo.isShortCodeTaken("gentle-waddle-26")).toBe(true)
  })

  test("returns false when code does not exist", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    expect(await repo.isShortCodeTaken("NOPE-NOPE-00")).toBe(false)
  })
})

// ─── Participant Tests ────────────────────────────────────────────────────────

describe("addParticipant", () => {
  test("writes participant with GSI1 keys", async () => {
    ddbMock.on(PutCommand).resolves({})

    const repo = createRepo()
    await repo.addParticipant(SESSION_ID, USER_ID, "host")

    const puts = ddbMock.commandCalls(PutCommand)
    expect(puts).toHaveLength(1)
    const item = puts[0].args[0].input.Item!
    expect(item.PK).toBe(sessionPK(SESSION_ID))
    expect(item.SK).toBe(participantSK(USER_ID))
    expect(item.GSI1PK).toBe(participantGSI1PK(USER_ID))
    expect(item.GSI1SK).toBe(participantGSI1SK(SESSION_ID))
    expect(item.role).toBe("host")
  })
})

describe("getParticipants", () => {
  test("queries by session PK with PART# prefix", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          id: "part-1",
          sessionId: SESSION_ID,
          userId: USER_ID,
          role: "host",
          isConnected: true,
          joinedAt: 1700000000,
        },
        {
          id: "part-2",
          sessionId: SESSION_ID,
          userId: "user-2",
          role: "collaborator",
          isConnected: false,
          joinedAt: 1700000100,
        },
      ],
    })

    const repo = createRepo()
    const result = await repo.getParticipants(SESSION_ID)

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("host")
    expect(result[1].userId).toBe("user-2")

    const queries = ddbMock.commandCalls(QueryCommand)
    expect(queries[0].args[0].input.ExpressionAttributeValues![":skPrefix"]).toBe(SK_PART_PREFIX)
  })

  test("returns empty array when no participants", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const repo = createRepo()
    const result = await repo.getParticipants(SESSION_ID)

    expect(result).toEqual([])
  })
})

describe("isParticipant", () => {
  test("returns true when participant exists", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { id: "part-1" } })

    const repo = createRepo()
    expect(await repo.isParticipant(SESSION_ID, USER_ID)).toBe(true)

    const gets = ddbMock.commandCalls(GetCommand)
    expect(gets[0].args[0].input.Key).toEqual({
      PK: sessionPK(SESSION_ID),
      SK: participantSK(USER_ID),
    })
  })

  test("returns false when not a participant", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    expect(await repo.isParticipant(SESSION_ID, "stranger")).toBe(false)
  })
})

describe("getParticipantCount", () => {
  test("uses SELECT COUNT", async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 5 })

    const repo = createRepo()
    expect(await repo.getParticipantCount(SESSION_ID)).toBe(5)

    const queries = ddbMock.commandCalls(QueryCommand)
    expect(queries[0].args[0].input.Select).toBe("COUNT")
  })

  test("returns 0 when no participants", async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 0 })

    const repo = createRepo()
    expect(await repo.getParticipantCount(SESSION_ID)).toBe(0)
  })

  test("returns 0 when Count is undefined", async () => {
    ddbMock.on(QueryCommand).resolves({})

    const repo = createRepo()
    expect(await repo.getParticipantCount(SESSION_ID)).toBe(0)
  })
})

// ─── Event Tests ──────────────────────────────────────────────────────────────

describe("putEvent", () => {
  test("writes event item with TTL", async () => {
    ddbMock.on(PutCommand).resolves({})

    const repo = createRepo()
    const event = eventRecord("evt-001")
    await repo.putEvent(event)

    const puts = ddbMock.commandCalls(PutCommand)
    expect(puts).toHaveLength(1)
    const item = puts[0].args[0].input.Item!
    expect(item.PK).toBe(sessionPK(SESSION_ID))
    expect(item.SK).toBe("EVT#evt-001")
    expect(item.type).toBe("prompt:sent")
    expect(typeof item.ttl).toBe("number")
  })
})

describe("putEventsBatch", () => {
  test("writes single batch for <= 25 events", async () => {
    ddbMock.on(BatchWriteCommand).resolves({})

    const events = Array.from({ length: 10 }, (_, i) => eventRecord(`evt-${i}`))
    const repo = createRepo()
    await repo.putEventsBatch(events)

    const batches = ddbMock.commandCalls(BatchWriteCommand)
    expect(batches).toHaveLength(1)
    expect(batches[0].args[0].input.RequestItems![TABLE]!).toHaveLength(10)
  })

  test("chunks into multiple batches for > 25 events", async () => {
    ddbMock.on(BatchWriteCommand).resolves({})

    const events = Array.from({ length: 60 }, (_, i) => eventRecord(`evt-${i}`))
    const repo = createRepo()
    await repo.putEventsBatch(events)

    const batches = ddbMock.commandCalls(BatchWriteCommand)
    expect(batches).toHaveLength(3) // 25 + 25 + 10
    expect(batches[0].args[0].input.RequestItems![TABLE]!).toHaveLength(25)
    expect(batches[1].args[0].input.RequestItems![TABLE]!).toHaveLength(25)
    expect(batches[2].args[0].input.RequestItems![TABLE]!).toHaveLength(10)
  })

  test("handles empty array gracefully", async () => {
    const repo = createRepo()
    await repo.putEventsBatch([])

    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0)
  })
})

describe("getEvents", () => {
  test("queries events ordered ascending", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          id: "evt-1",
          sessionId: SESSION_ID,
          timestamp: 1700000000,
          type: "prompt:sent",
          actorType: "user",
          actorId: USER_ID,
          payload: "{}",
        },
        {
          id: "evt-2",
          sessionId: SESSION_ID,
          timestamp: 1700000001,
          type: "agent:output",
          actorType: "agent",
          payload: "{}",
        },
      ],
    })

    const repo = createRepo()
    const result = await repo.getEvents(SESSION_ID)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("evt-1")
    expect(result[1].type).toBe("agent:output")

    const queries = ddbMock.commandCalls(QueryCommand)
    expect(queries[0].args[0].input.ScanIndexForward).toBe(true)
  })

  test("passes Limit when specified", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const repo = createRepo()
    await repo.getEvents(SESSION_ID, 50)

    const queries = ddbMock.commandCalls(QueryCommand)
    expect(queries[0].args[0].input.Limit).toBe(50)
  })

  test("omits Limit when not specified", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const repo = createRepo()
    await repo.getEvents(SESSION_ID)

    const queries = ddbMock.commandCalls(QueryCommand)
    expect(queries[0].args[0].input.Limit).toBeUndefined()
  })

  test("returns empty array when no events", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const repo = createRepo()
    const result = await repo.getEvents(SESSION_ID)

    expect(result).toEqual([])
  })
})

describe("deleteEventsBySession", () => {
  test("queries event keys and batch-deletes", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { PK: sessionPK(SESSION_ID), SK: "EVT#01" },
        { PK: sessionPK(SESSION_ID), SK: "EVT#02" },
      ],
    })
    ddbMock.on(BatchWriteCommand).resolves({})

    const repo = createRepo()
    await repo.deleteEventsBySession(SESSION_ID)

    const queries = ddbMock.commandCalls(QueryCommand)
    expect(queries[0].args[0].input.ExpressionAttributeValues![":skPrefix"]).toBe(SK_EVT_PREFIX)

    const batches = ddbMock.commandCalls(BatchWriteCommand)
    expect(batches).toHaveLength(1)
    const deletes = batches[0].args[0].input.RequestItems![TABLE]!
    expect(deletes).toHaveLength(2)
    expect(deletes[0].DeleteRequest!.Key).toEqual({
      PK: sessionPK(SESSION_ID),
      SK: "EVT#01",
    })
  })

  test("handles empty event list gracefully", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const repo = createRepo()
    await repo.deleteEventsBySession(SESSION_ID)

    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0)
  })

  test("paginates through all events", async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ PK: sessionPK(SESSION_ID), SK: "EVT#01" }],
        LastEvaluatedKey: { PK: sessionPK(SESSION_ID), SK: "EVT#01" },
      })
      .resolvesOnce({
        Items: [{ PK: sessionPK(SESSION_ID), SK: "EVT#02" }],
      })
    ddbMock.on(BatchWriteCommand).resolves({})

    const repo = createRepo()
    await repo.deleteEventsBySession(SESSION_ID)

    const queries = ddbMock.commandCalls(QueryCommand)
    expect(queries).toHaveLength(2)

    const batches = ddbMock.commandCalls(BatchWriteCommand)
    expect(batches[0].args[0].input.RequestItems![TABLE]!).toHaveLength(2)
  })
})

// ─── Context Tests ────────────────────────────────────────────────────────────

describe("setContextSnapshot", () => {
  test("updates contextSnapshot on session item", async () => {
    ddbMock.on(UpdateCommand).resolves({})

    const repo = createRepo()
    await repo.setContextSnapshot(SESSION_ID, '{"goals":["ship MVP"]}')

    const updates = ddbMock.commandCalls(UpdateCommand)
    expect(updates).toHaveLength(1)
    expect(updates[0].args[0].input.Key).toEqual({
      PK: sessionPK(SESSION_ID),
      SK: sessionSK(),
    })
    const expr = updates[0].args[0].input.UpdateExpression as string
    expect(expr).toContain("#cs = :cs")
    expect(updates[0].args[0].input.ExpressionAttributeValues![":cs"]).toBe('{"goals":["ship MVP"]}')
  })
})

describe("getContextSnapshot", () => {
  test("returns snapshot when present", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { ...sessionItem(), contextSnapshot: '{"goals":[]}' },
    })

    const repo = createRepo()
    const result = await repo.getContextSnapshot(SESSION_ID)

    expect(result).toBe('{"goals":[]}')
  })

  test("returns null when session not found", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.getContextSnapshot(SESSION_ID)

    expect(result).toBeNull()
  })

  test("returns null when contextSnapshot field missing", async () => {
    ddbMock.on(GetCommand).resolves({ Item: sessionItem() })

    const repo = createRepo()
    const result = await repo.getContextSnapshot(SESSION_ID)

    // sessionItem() has no contextSnapshot field by default
    expect(result).toBeNull()
  })
})

describe("getSessionPlanState", () => {
  test("decodes base64 planYjsState to Buffer", async () => {
    const raw = Buffer.from("yjs-data")
    const encoded = raw.toString("base64")
    ddbMock.on(GetCommand).resolves({
      Item: { ...sessionItem(), planYjsState: encoded },
    })

    const repo = createRepo()
    const result = await repo.getSessionPlanState(SESSION_ID)

    expect(result).not.toBeNull()
    expect(result!.toString()).toBe("yjs-data")
  })

  test("returns null when session not found", async () => {
    ddbMock.on(GetCommand).resolves({})

    const repo = createRepo()
    const result = await repo.getSessionPlanState(SESSION_ID)

    expect(result).toBeNull()
  })

  test("returns null when planYjsState is absent", async () => {
    ddbMock.on(GetCommand).resolves({ Item: sessionItem() })

    const repo = createRepo()
    const result = await repo.getSessionPlanState(SESSION_ID)

    expect(result).toBeNull()
  })
})
