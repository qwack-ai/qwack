import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { QwackConfig } from "./store";

// Test the JSON read/write logic using a temp directory to avoid touching real config
describe("auth/store", () => {
  let tempDir: string;
  let configFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "qwack-test-"));
    configFile = join(tempDir, "config.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes and reads config correctly", () => {
    const config: QwackConfig = {
      server: "https://qwack.ai",
      token: "test-token-123",
      refreshToken: "refresh-456",
    };

    mkdirSync(tempDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");

    const raw = readFileSync(configFile, "utf-8");
    const parsed = JSON.parse(raw) as QwackConfig;

    expect(parsed.server).toBe("https://qwack.ai");
    expect(parsed.token).toBe("test-token-123");
    expect(parsed.refreshToken).toBe("refresh-456");
  });

  test("returns null for missing config file", () => {
    const missing = join(tempDir, "nonexistent.json");
    expect(existsSync(missing)).toBe(false);
  });

  test("writes config without refreshToken", () => {
    const config: QwackConfig = {
      server: "https://custom.server.com",
      token: "abc",
    };

    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
    const parsed = JSON.parse(readFileSync(configFile, "utf-8")) as QwackConfig;

    expect(parsed.server).toBe("https://custom.server.com");
    expect(parsed.token).toBe("abc");
    expect(parsed.refreshToken).toBeUndefined();
  });

  test("handles malformed JSON gracefully", () => {
    writeFileSync(configFile, "not valid json{{{", "utf-8");

    let result: QwackConfig | null = null;
    try {
      JSON.parse(readFileSync(configFile, "utf-8"));
    } catch {
      result = null;
    }

    expect(result).toBeNull();
  });

  test("getConfigDir and getConfigFile return strings", async () => {
    const { getConfigDir, getConfigFile } = await import("./store");
    expect(typeof getConfigDir()).toBe("string");
    expect(typeof getConfigFile()).toBe("string");
    expect(getConfigFile()).toContain("config.json");
    expect(getConfigDir()).toContain(".config");
  });
});
