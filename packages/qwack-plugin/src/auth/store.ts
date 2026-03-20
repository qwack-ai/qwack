import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface QwackConfig {
  server: string;
  token: string;
  refreshToken?: string;
  agentModel?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "qwack");
const CONFIG_FILE = process.env.QWACK_CONFIG_FILE ?? join(CONFIG_DIR, "config.json");

export function readConfig(): QwackConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) return null;
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as QwackConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: QwackConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function clearConfig(): void {
  try {
    const existing = readConfig();
    if (existing) {
      writeConfig({ server: existing.server, token: "" });
    }
  } catch {}
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigFile(): string {
  return CONFIG_FILE;
}
