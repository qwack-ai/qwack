import { createAuthIssuer } from "./openauth"
import { createDatabase } from "../db/index"
import { SqliteRepository } from "../repo/sqlite"
import { loadConfig } from "../config"

const config = loadConfig()
const { db } = createDatabase(config.databaseUrl)
const repo = new SqliteRepository(db)
const issuerApp = createAuthIssuer(repo)
const port = parseInt(process.env.OPENAUTH_PORT ?? "4001")

export default Bun.serve({
  port,
  fetch: issuerApp.fetch,
})

console.log(`🔐 OpenAuth issuer running on port ${port}`)
