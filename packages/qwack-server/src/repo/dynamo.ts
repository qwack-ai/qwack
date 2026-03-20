/// <reference types="bun-types" />
/**
 * DynamoDB single-table repository implementation.
 *
 * Uses @aws-sdk/lib-dynamodb DocumentClient for simplified marshalling.
 * All entities share one table — see dynamo-keys.ts for key schema.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  BatchWriteCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb"
import { ulid } from "ulid"
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
  eventSK,
  GSI1_NAME,
  EVENT_TTL_SECONDS,
  SK_PART_PREFIX,
  SK_EVT_PREFIX,
  toUserItem,
  fromUserItem,
  toEmailLookupItem,
  toGithubLookupItem,
  toSessionItem,
  fromSessionItem,
  toCodeLookupItem,
  toParticipantItem,
  fromParticipantItem,
  toEventItem,
  fromEventItem,
} from "./dynamo-keys"

/** Maximum items per BatchWriteCommand (DynamoDB hard limit). */
const BATCH_WRITE_LIMIT = 25

export class DynamoRepository implements IRepository {
  private docClient: DynamoDBDocumentClient

  constructor(
    private tableName: string,
    client?: DynamoDBClient,
  ) {
    const rawClient = client ?? new DynamoDBClient({})
    this.docClient = DynamoDBDocumentClient.from(rawClient, {
      marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
      unmarshallOptions: { wrapNumbers: false },
    })
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const now = Math.floor(Date.now() / 1000)
    const record: UserRecord = {
      ...input,
      avatarUrl: input.avatarUrl ?? null,
      githubId: input.githubId ?? null,
      passwordHash: input.passwordHash ?? null,
      createdAt: now,
      updatedAt: now,
    }

    // Write user item
    await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: toUserItem(record) }))

    // Write email lookup
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toEmailLookupItem(record.email, record.id),
      }),
    )

    // Write github lookup if present
    if (record.githubId) {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toGithubLookupItem(record.githubId, record.id),
        }),
      )
    }

    return record
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: userPK(id), SK: userSK() },
      }),
    )
    return result.Item ? fromUserItem(result.Item as Record<string, unknown>) : null
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    // Step 1: lookup email → userId
    const lookup = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: emailLookupPK(email), SK: lookupSK() },
      }),
    )
    if (!lookup.Item) return null

    // Step 2: fetch user by id
    const userId = lookup.Item.userId as string
    return this.getUserById(userId)
  }

  async getUserByGithubId(githubId: string): Promise<UserRecord | null> {
    // Step 1: lookup githubId → userId
    const lookup = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: githubLookupPK(githubId), SK: lookupSK() },
      }),
    )
    if (!lookup.Item) return null

    // Step 2: fetch user by id
    const userId = lookup.Item.userId as string
    return this.getUserById(userId)
  }

  async updateUser(id: string, updates: UpdateUserInput): Promise<UserRecord | null> {
    // Check user exists first
    const existing = await this.getUserById(id)
    if (!existing) return null

    const now = Math.floor(Date.now() / 1000)
    const expressions: string[] = ["#updatedAt = :updatedAt"]
    const names: Record<string, string> = { "#updatedAt": "updatedAt" }
    const values: Record<string, unknown> = { ":updatedAt": now }

    if (updates.name !== undefined) {
      expressions.push("#n = :n")
      names["#n"] = "name"
      values[":n"] = updates.name
    }
    if (updates.avatarUrl !== undefined) {
      expressions.push("#avatarUrl = :avatarUrl")
      names["#avatarUrl"] = "avatarUrl"
      values[":avatarUrl"] = updates.avatarUrl
    }
    if (updates.passwordHash !== undefined) {
      expressions.push("#passwordHash = :passwordHash")
      names["#passwordHash"] = "passwordHash"
      values[":passwordHash"] = updates.passwordHash
    }
    if (updates.githubId !== undefined) {
      expressions.push("#githubId = :githubId")
      names["#githubId"] = "githubId"
      values[":githubId"] = updates.githubId

      // Handle github lookup updates
      if (existing.githubId && existing.githubId !== updates.githubId) {
        // Delete old lookup
        await this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: { PK: githubLookupPK(existing.githubId), SK: lookupSK(), _deleted: true },
          }),
        )
      }
      if (updates.githubId) {
        // Write new lookup
        await this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: toGithubLookupItem(updates.githubId, id),
          }),
        )
      }
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: userPK(id), SK: userSK() },
        UpdateExpression: `SET ${expressions.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    )

    // Return fresh record
    return this.getUserById(id)
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const now = Math.floor(Date.now() / 1000)
    const record: SessionRecord = {
      id: input.id,
      title: input.title,
      status: input.status ?? "active",
      creatorId: input.creatorId,
      agentAutonomy: input.agentAutonomy ?? "hybrid",
      permissionModel: input.permissionModel ?? "host_decides",
      disagreementThreshold: input.disagreementThreshold ?? "configurable",
      planYjsState: null,
      shortCode: input.shortCode,
      contextSnapshot: null,
      createdAt: now,
      updatedAt: now,
    }

    // Write session item
    await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: toSessionItem(record) }))

    // Write code lookup
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toCodeLookupItem(record.shortCode!, record.id),
      }),
    )

    return record
  }

  async getSessionById(id: string): Promise<SessionRecord | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: sessionPK(id), SK: sessionSK() },
      }),
    )
    return result.Item ? fromSessionItem(result.Item as Record<string, unknown>) : null
  }

  async getSessionsByUser(userId: string): Promise<SessionListItem[]> {
    // Query GSI1 to find all sessions this user participates in
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1_NAME,
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": participantGSI1PK(userId),
          ":skPrefix": "SESSION#",
        },
      }),
    )

    const items = result.Items ?? []
    const sessions: SessionListItem[] = []

    for (const item of items) {
      const sessionId = item.sessionId as string
      // Get session metadata
      const session = await this.getSessionById(sessionId)
      if (!session) continue

      // Get participant count
      const count = await this.getParticipantCount(sessionId)

      sessions.push({
        id: session.id,
        title: session.title,
        status: session.status,
        shortCode: session.shortCode,
        creatorId: session.creatorId,
        createdAt: session.createdAt,
        participantCount: count,
      })
    }

    return sessions
  }

  async getSessionByShortCode(code: string): Promise<ShortCodeResult | null> {
    const upperCode = code.toUpperCase()
    const lookup = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: codeLookupPK(upperCode), SK: lookupSK() },
      }),
    )
    if (!lookup.Item) return null

    const sessionId = lookup.Item.sessionId as string
    const session = await this.getSessionById(sessionId)
    if (!session) return null

    return {
      id: session.id,
      title: session.title,
      shortCode: session.shortCode!,
    }
  }

  async updateSession(id: string, updates: UpdateSessionInput): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const expressions: string[] = ["#updatedAt = :updatedAt"]
    const names: Record<string, string> = { "#updatedAt": "updatedAt" }
    const values: Record<string, unknown> = { ":updatedAt": now }

    if (updates.title !== undefined) {
      expressions.push("#title = :title")
      names["#title"] = "title"
      values[":title"] = updates.title
    }
    if (updates.status !== undefined) {
      expressions.push("#status = :status")
      names["#status"] = "status"
      values[":status"] = updates.status
    }
    if (updates.contextSnapshot !== undefined) {
      expressions.push("#contextSnapshot = :contextSnapshot")
      names["#contextSnapshot"] = "contextSnapshot"
      values[":contextSnapshot"] = updates.contextSnapshot
    }
    if (updates.planYjsState !== undefined) {
      const encoded = updates.planYjsState ? Buffer.from(updates.planYjsState).toString("base64") : null
      expressions.push("#planYjsState = :planYjsState")
      names["#planYjsState"] = "planYjsState"
      values[":planYjsState"] = encoded
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: sessionPK(id), SK: sessionSK() },
        UpdateExpression: `SET ${expressions.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    )
  }

  async deleteSession(id: string): Promise<void> {
    // Query ALL items with PK = SESSION#id (META, PARTs, EVTs)
    const allItems: Array<{ PK: string; SK: string }> = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": sessionPK(id) },
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey: lastKey,
        }),
      )
      for (const item of result.Items ?? []) {
        allItems.push({ PK: item.PK as string, SK: item.SK as string })
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
    } while (lastKey)

    // Also delete the code lookup — fetch session first to get shortCode
    const session = await this.getSessionById(id)
    if (session?.shortCode) {
      allItems.push({ PK: codeLookupPK(session.shortCode), SK: lookupSK() })
    }

    // BatchWrite delete in chunks of 25
    await this.batchDelete(allItems)
  }

  async isShortCodeTaken(code: string): Promise<boolean> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: codeLookupPK(code.toUpperCase()), SK: lookupSK() },
      }),
    )
    return !!result.Item
  }

  // ── Participants ──────────────────────────────────────────────────────────

  async addParticipant(sessionId: string, userId: string, role: string): Promise<void> {
    const record: ParticipantRecord = {
      id: ulid(),
      sessionId,
      userId,
      role,
      isConnected: false,
      joinedAt: Math.floor(Date.now() / 1000),
    }

    await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: toParticipantItem(record) }))
  }

  async getParticipants(sessionId: string): Promise<ParticipantRecord[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": sessionPK(sessionId),
          ":skPrefix": SK_PART_PREFIX,
        },
      }),
    )
    return (result.Items ?? []).map((item) => fromParticipantItem(item as Record<string, unknown>))
  }

  async isParticipant(sessionId: string, userId: string): Promise<boolean> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: sessionPK(sessionId), SK: participantSK(userId) },
      }),
    )
    return !!result.Item
  }

  async getParticipantCount(sessionId: string): Promise<number> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": sessionPK(sessionId),
          ":skPrefix": SK_PART_PREFIX,
        },
        Select: "COUNT",
      }),
    )
    return result.Count ?? 0
  }

  // ── Events ────────────────────────────────────────────────────────────────

  async putEvent(event: EventRecord): Promise<void> {
    await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: toEventItem(event) }))
  }

  async putEventsBatch(events: EventRecord[]): Promise<void> {
    if (events.length === 0) return

    const items = events.map((e) => toEventItem(e))

    // Chunk into groups of 25 (DynamoDB BatchWriteItem limit)
    for (let i = 0; i < items.length; i += BATCH_WRITE_LIMIT) {
      const chunk = items.slice(i, i + BATCH_WRITE_LIMIT)
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: chunk.map((item) => ({
              PutRequest: { Item: item },
            })),
          },
        }),
      )
    }
  }

  async getEvents(sessionId: string, limit?: number): Promise<EventRecord[]> {
    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": sessionPK(sessionId),
        ":skPrefix": SK_EVT_PREFIX,
      },
      ScanIndexForward: true,
    }
    if (limit !== undefined) {
      params.Limit = limit
    }

    const result = await this.docClient.send(new QueryCommand(params))
    return (result.Items ?? []).map((item) => fromEventItem(item as Record<string, unknown>))
  }

  async deleteEventsBySession(sessionId: string): Promise<void> {
    // Query all event keys
    const eventKeys: Array<{ PK: string; SK: string }> = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": sessionPK(sessionId),
            ":skPrefix": SK_EVT_PREFIX,
          },
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey: lastKey,
        }),
      )
      for (const item of result.Items ?? []) {
        eventKeys.push({ PK: item.PK as string, SK: item.SK as string })
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
    } while (lastKey)

    await this.batchDelete(eventKeys)
  }

  // ── Context ───────────────────────────────────────────────────────────────

  async setContextSnapshot(sessionId: string, snapshot: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: sessionPK(sessionId), SK: sessionSK() },
        UpdateExpression: "SET #cs = :cs, #u = :u",
        ExpressionAttributeNames: { "#cs": "contextSnapshot", "#u": "updatedAt" },
        ExpressionAttributeValues: {
          ":cs": snapshot,
          ":u": Math.floor(Date.now() / 1000),
        },
      }),
    )
  }

  async getContextSnapshot(sessionId: string): Promise<string | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: sessionPK(sessionId), SK: sessionSK() },
      }),
    )
    if (!result.Item) return null
    return (result.Item.contextSnapshot as string) ?? null
  }

  async getSessionPlanState(sessionId: string): Promise<Buffer | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: sessionPK(sessionId), SK: sessionSK() },
      }),
    )
    if (!result.Item) return null
    const encoded = result.Item.planYjsState as string | undefined
    if (!encoded) return null
    return Buffer.from(encoded, "base64")
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Delete items in BatchWriteCommand chunks of 25. */
  private async batchDelete(keys: Array<{ PK: string; SK: string }>): Promise<void> {
    if (keys.length === 0) return

    for (let i = 0; i < keys.length; i += BATCH_WRITE_LIMIT) {
      const chunk = keys.slice(i, i + BATCH_WRITE_LIMIT)
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: chunk.map((key) => ({
              DeleteRequest: { Key: { PK: key.PK, SK: key.SK } },
            })),
          },
        }),
      )
    }
  }
}
