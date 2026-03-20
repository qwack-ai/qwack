import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { resolve } from "node:path";
import { createDatabase } from "./index";

const dbUrl = process.env.QWACK_DATABASE_URL ?? "file:./qwack.db";
const { db, sqlite } = createDatabase(dbUrl);

const migrationsFolder = resolve(import.meta.dir, "../../../drizzle");

console.log("🦆 Running migrations...");
migrate(db, { migrationsFolder });
console.log("✅ Migrations complete");

sqlite.close();
