import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import {
  MAX_COLLAB_MESSAGES,
  WS_HEARTBEAT_MS,
  WS_MAX_RECONNECT_DELAY,
  } from "@qwack/shared"
import type { PresenceEntry, CollabMessage } from "@qwack/shared"

/** Re-export shared PresenceEntry as QwackPresenceEntry for existing consumers */
  export type QwackPresenceEntry = PresenceEntry

  /** TUI collab message — extends shared CollabMessage with streaming/thinking fields */
  export interface QwackCollabMessage extends CollabMessage {
  streaming?: boolean
  thinking?: boolean
  toolEvent?: {
    tool: string
    status: "running" | "completed" | "error"
    input?: string
    output?: string
    error?: string
    partId: string
  }
}

export interface AuthConfig {
  server: string
  token: string
  refreshToken?: string
  name?: string
}

/** Callback type for when the host receives a prompt:execute from a non-host */
export type PromptExecuteCallback = (content: string, requestedBy: string) => void

export const MAX_MESSAGES = MAX_COLLAB_MESSAGES
export const HEARTBEAT_MS = WS_HEARTBEAT_MS
export const MAX_RECONNECT_DELAY = WS_MAX_RECONNECT_DELAY
export const CONFIG_FILE = process.env.QWACK_CONFIG_FILE ?? join(homedir(), ".config", "qwack", "config.json")
export const SESSION_FILE = process.env.QWACK_SESSION_FILE ?? join(homedir(), ".config", "qwack", "active-session.json")
const SESSION_MAP_FILE = process.env.QWACK_SESSION_MAP_FILE ?? join(homedir(), ".config", "qwack", "session-map.json")

/** Map qwackSessionId → localSessionId so hosts return to the same local session. */
export function getLocalSessionForQwack(qwackSessionId: string): string | null {
  try {
    if (!existsSync(SESSION_MAP_FILE)) return null
    const map = JSON.parse(readFileSync(SESSION_MAP_FILE, "utf-8")) as Record<string, string>
    return map[qwackSessionId] ?? null
  } catch {
    return null
  }
}

export function setLocalSessionForQwack(qwackSessionId: string, localSessionId: string): void {
  try {
    const dir = dirname(SESSION_MAP_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    let map: Record<string, string> = {}
    if (existsSync(SESSION_MAP_FILE)) {
      try { map = JSON.parse(readFileSync(SESSION_MAP_FILE, "utf-8")) } catch {}
    }
    map[qwackSessionId] = localSessionId
    writeFileSync(SESSION_MAP_FILE, JSON.stringify(map, null, 2), "utf-8")
  } catch {}
}

export function readAuthConfig(): AuthConfig | null {
  if (!existsSync(CONFIG_FILE)) return null
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as AuthConfig
  } catch {
    return null
  }
}

export function writeAuthConfig(config: AuthConfig): void {
  const dir = dirname(CONFIG_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8")
}

export function clearAuthConfig(): void {
  try {
    const existing = readAuthConfig()
    if (existing) {
      writeAuthConfig({ server: existing.server, token: "" })
    }
  } catch {}
}
