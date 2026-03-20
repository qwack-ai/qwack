import { issuer } from "@openauthjs/openauth"
import { MemoryStorage } from "@openauthjs/openauth/storage/memory"
import { DynamoStorage } from "./dynamo-storage"
import { createSubjects } from "@openauthjs/openauth/subject"
import { object, string } from "valibot"
import { GithubProvider } from "@openauthjs/openauth/provider/github"
import { ulid } from "ulid"
import { config } from "../config"
import { getGithubUser, getGithubPrimaryEmail } from "./github"
import type { IRepository } from "../repo/types"

/**
 * Subjects define what goes into the JWT access token.
 * Uses valibot (required by OpenAuth, not Zod).
 */
export const subjects = createSubjects({
  user: object({
    id: string(),
  }),
})

/**
 * Create an OpenAuth issuer with repo access for user lookup/creation.
 * Returns a Hono app that handles OAuth flows.
 */
export function createAuthIssuer(repo: IRepository) {
  return issuer({
    subjects,
    storage: process.env.QWACK_TABLE_NAME
      ? DynamoStorage(process.env.QWACK_TABLE_NAME)
      : MemoryStorage({ persist: "./auth-storage.json" }),

    providers: {
      github: GithubProvider({
        clientID: config.githubClientId ?? "",
        clientSecret: config.githubClientSecret ?? "",
        scopes: ["read:user", "user:email"],
      }),
    },

    allow: async () => true,

    async success(ctx, value) {
      if (value.provider === "github") {
        const ghUser = await getGithubUser(value.tokenset.access)
        let ghEmail: string | null = null
        try {
          ghEmail = await getGithubPrimaryEmail(value.tokenset.access)
        } catch {
          // Email may not be available — not fatal
        }

        // Look up by github_id
        let user = await repo.getUserByGithubId(String(ghUser.id))

        // Look up by email
        if (!user && ghEmail) {
          user = await repo.getUserByEmail(ghEmail)
          // Link github_id if found by email
          if (user) {
            await repo.updateUser(user.id, {
              githubId: String(ghUser.id),
              avatarUrl: ghUser.avatar_url,
            })
          }
        }

        // Create new user
        if (!user) {
          const id = ulid()
          user = await repo.createUser({
            id,
            email: ghEmail ?? `${ghUser.id}@github.qwack.dev`,
            name: ghUser.name ?? ghUser.login,
            githubId: String(ghUser.id),
            avatarUrl: ghUser.avatar_url,
          })
        }

        return ctx.subject("user", { id: user.id })
      }

      throw new Error(`Unknown provider: ${value.provider}`)
    },
  })
}
