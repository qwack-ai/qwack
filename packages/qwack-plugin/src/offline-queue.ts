import type { WsMessage } from "@qwack/shared";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export const MAX_QUEUE_SIZE = 10 * 1024 * 1024; // 10MB

export const QUEUABLE_TYPES = new Set([
  "prompt:sent",
  "collab:message",
  "agent:output",
  "agent:thinking",
  "agent:tool_use",
  "agent:tool_result",
  "agent:complete",
  "session:context_snapshot",
]);

export const PERSIST_DEBOUNCE_MS = 250;

let QUEUE_FILE = join(homedir(), ".config", "qwack", "offline-queue.json");

export class OfflineQueue {
  private queue: WsMessage[] = [];
  private sizeBytes = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromDisk();
  }

  enqueue(message: WsMessage, emitSize: (size: number) => void): void {
    const msgStr = JSON.stringify(message);
    this.sizeBytes += msgStr.length;
    this.queue.push(message);
    while (this.sizeBytes > MAX_QUEUE_SIZE && this.queue.length > 0) {
      const dropped = this.queue.shift()!;
      this.sizeBytes -= JSON.stringify(dropped).length;
    }
    emitSize(this.queue.length);
    this.schedulePersist();
  }

  flush(sendFn: (msg: WsMessage) => void, emitSize: (size: number) => void): void {
    if (this.queue.length === 0) return;
    const pending = [...this.queue];
    this.queue = [];
    this.sizeBytes = 0;
    for (const msg of pending) {
      const replayed = {
        ...msg,
        replayed: true,
      };
      sendFn(replayed);
    }
    emitSize(0);
    this.persistToDisk();
  }

  getSize(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.sizeBytes = 0;
    this.persistToDisk();
  }

  /** Cancel pending persist timer and force a final write */
  shutdown(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.persistToDisk();
    }
  }

  static setQueueFile(path: string): void {
    QUEUE_FILE = path;
  }

  private loadFromDisk(): void {
    try {
      if (!QUEUE_FILE || !existsSync(QUEUE_FILE)) {
        this.queue = [];
        this.sizeBytes = 0;
        return;
      }
      const data = readFileSync(QUEUE_FILE, "utf-8");
      const parsed = JSON.parse(data) as WsMessage[];
      if (Array.isArray(parsed)) {
        this.queue = parsed;
        this.sizeBytes = JSON.stringify(parsed).length;
      } else {
        this.queue = [];
        this.sizeBytes = 0;
      }
    } catch {
      // Corrupt file or read error — start fresh
      this.queue = [];
      this.sizeBytes = 0;
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistToDisk();
      this.persistTimer = null;
    }, PERSIST_DEBOUNCE_MS);
  }

  private persistToDisk(): void {
    try {
      const dir = dirname(QUEUE_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (this.queue.length === 0) {
        if (existsSync(QUEUE_FILE)) unlinkSync(QUEUE_FILE);
      } else {
        writeFileSync(QUEUE_FILE, JSON.stringify(this.queue));
      }
    } catch {
      // Disk write failure — queue remains in memory only
    }
  }
}
