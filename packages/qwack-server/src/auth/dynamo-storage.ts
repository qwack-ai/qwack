import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"

const SEPARATOR = String.fromCharCode(31)

function joinKey(key: string[]): string {
  return key.join(SEPARATOR)
}

function splitKey(key: string): string[] {
  return key.split(SEPARATOR)
}

export function DynamoStorage(tableName: string, client?: DynamoDBClient) {
  const rawClient = client ?? new DynamoDBClient({})
  const docClient = DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true },
  })

  return {
    async get(key: string[]) {
      const result = await docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: "AUTHKEY", SK: joinKey(key) },
        }),
      )
      if (!result.Item) return undefined
      if (result.Item.expiry && Date.now() >= result.Item.expiry) {
        await docClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: "AUTHKEY", SK: joinKey(key) },
          }),
        )
        return undefined
      }
      return result.Item.value
    },

    async set(key: string[], value: unknown, expiry?: Date) {
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: "AUTHKEY",
            SK: joinKey(key),
            value,
            expiry: expiry ? expiry.getTime() : undefined,
            ttl: expiry ? Math.floor(expiry.getTime() / 1000) : undefined,
          },
        }),
      )
    },

    async remove(key: string[]) {
      await docClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: "AUTHKEY", SK: joinKey(key) },
        }),
      )
    },

    async *scan(prefix: string[]) {
      const prefixStr = joinKey(prefix)
      const now = Date.now()
      let lastKey: Record<string, unknown> | undefined

      do {
        const result = await docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
            ExpressionAttributeValues: { ":pk": "AUTHKEY", ":prefix": prefixStr },
            ExclusiveStartKey: lastKey,
          }),
        )

        for (const item of result.Items ?? []) {
          if (item.expiry && now >= item.expiry) continue
          yield [splitKey(item.SK as string), item.value] as [string[], unknown]
        }

        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
      } while (lastKey)
    },
  }
}
