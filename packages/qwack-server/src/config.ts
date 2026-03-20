import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(4000),
  host: z.string().default("0.0.0.0"),
  databaseUrl: z.string().default("file:./qwack.db"),
  openAuthIssuerUrl: z.string().default("http://localhost:4001"),
  githubClientId: z.string().optional(),
  githubClientSecret: z.string().optional(),
  sessionSecret: z.string().default("change-me-in-production"),
  maxCollaborators: z.coerce.number().default(3),
  maxSessionsPerMonth: z.coerce.number().default(5),
  isDev: z.boolean().default(false),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    port: process.env.QWACK_PORT,
    host: process.env.QWACK_HOST,
    databaseUrl: process.env.QWACK_DATABASE_URL,
    openAuthIssuerUrl: process.env.OPENAUTH_ISSUER_URL,
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    sessionSecret: process.env.QWACK_SESSION_SECRET,
    maxCollaborators: process.env.QWACK_MAX_COLLABORATORS,
    maxSessionsPerMonth: process.env.QWACK_MAX_SESSIONS_PER_MONTH,
    isDev: process.env.QWACK_DEV === "true",
  });
}

export const config = loadConfig();
