import type { IRepository } from "./types"

/**
 * Create a repository instance based on environment configuration.
 *
 * - If QWACK_TABLE_NAME is set → DynamoRepository (production/staging)
 * - Otherwise → SqliteRepository (local dev)
 */
export async function createRepository(): Promise<IRepository> {
  const tableName = process.env.QWACK_TABLE_NAME

  if (tableName) {
    const { DynamoRepository } = await import("./dynamo")
    return new DynamoRepository(tableName)
  }

  // Dynamic import avoids pulling bun:sqlite into Lambda bundles
  const { SqliteRepository } = await import("./sqlite")
  const { createDatabase } = await import("../db/index")
  const databaseUrl = process.env.QWACK_DATABASE_URL ?? "file:./qwack.db"
  const { db } = createDatabase(databaseUrl)
  return new SqliteRepository(db)
}
