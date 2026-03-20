import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export function createDatabase(url: string) {
  const dbPath = url.startsWith("file:") ? url.slice(5) : url;
  const sqlite = new Database(dbPath);

  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export type AppDatabase = ReturnType<typeof createDatabase>["db"];

export { schema };
