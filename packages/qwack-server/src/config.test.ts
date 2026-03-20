import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all QWACK_ env vars before each test
    delete process.env.QWACK_PORT;
    delete process.env.QWACK_HOST;
    delete process.env.QWACK_DATABASE_URL;
    delete process.env.OPENAUTH_ISSUER_URL;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.QWACK_SESSION_SECRET;
    delete process.env.QWACK_MAX_COLLABORATORS;
    delete process.env.QWACK_MAX_SESSIONS_PER_MONTH;
  });

  afterEach(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
  });

  test("returns defaults when no env vars set", () => {
    const config = loadConfig();

    expect(config.port).toBe(4000);
    expect(config.host).toBe("0.0.0.0");
    expect(config.databaseUrl).toBe("file:./qwack.db");
    expect(config.openAuthIssuerUrl).toBe("http://localhost:4001");
    expect(config.githubClientId).toBeUndefined();
    expect(config.githubClientSecret).toBeUndefined();
    expect(config.sessionSecret).toBe("change-me-in-production");
    expect(config.maxCollaborators).toBe(3);
    expect(config.maxSessionsPerMonth).toBe(5);
  });

  test("coerces port from string to number", () => {
    process.env.QWACK_PORT = "8080";
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  test("coerces maxCollaborators from string to number", () => {
    process.env.QWACK_MAX_COLLABORATORS = "10";
    const config = loadConfig();
    expect(config.maxCollaborators).toBe(10);
  });

  test("reads all env vars when set", () => {
    process.env.QWACK_PORT = "5000";
    process.env.QWACK_HOST = "127.0.0.1";
    process.env.QWACK_DATABASE_URL = "file:./test.db";
    process.env.OPENAUTH_ISSUER_URL = "https://auth.example.com";
    process.env.GITHUB_CLIENT_ID = "gh-id-123";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret-456";
    process.env.QWACK_SESSION_SECRET = "super-secret";
    process.env.QWACK_MAX_COLLABORATORS = "20";
    process.env.QWACK_MAX_SESSIONS_PER_MONTH = "50";

    const config = loadConfig();

    expect(config.port).toBe(5000);
    expect(config.host).toBe("127.0.0.1");
    expect(config.databaseUrl).toBe("file:./test.db");
    expect(config.openAuthIssuerUrl).toBe("https://auth.example.com");
    expect(config.githubClientId).toBe("gh-id-123");
    expect(config.githubClientSecret).toBe("gh-secret-456");
    expect(config.sessionSecret).toBe("super-secret");
    expect(config.maxCollaborators).toBe(20);
    expect(config.maxSessionsPerMonth).toBe(50);
  });
});
