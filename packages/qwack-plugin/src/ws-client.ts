import type { WsMessage } from "@qwack/shared";
import { OfflineQueue, QUEUABLE_TYPES } from "./offline-queue";

type EventHandler = (payload: unknown) => void;

export class QwackWsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectAttempts = 0;
  private maxReconnectDelay = QwackWsClient.MAX_RECONNECT_DELAY_MS;
  private shouldReconnect = true;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private queue: OfflineQueue;

  static MAX_RECONNECT_DELAY_MS = 30000;
  static HEARTBEAT_INTERVAL_MS = 30000;

  constructor(
    private serverUrl: string,
    private token: string,
    private sessionId: string,
  ) {
    this.queue = new OfflineQueue();
  }


  connect(): void {
    this.shouldReconnect = true;
    const wsUrl = this.serverUrl.replace(/^http/, "ws");
    const url = `${wsUrl}/ws?token=${encodeURIComponent(this.token)}&sessionId=${encodeURIComponent(this.sessionId)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.flushOfflineQueue();
      this.emit("connected", {});
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WsMessage;
        this.emit(message.type, message.payload);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.emit("disconnected", {});
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.queue.shutdown();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: WsMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    if (QUEUABLE_TYPES.has(message.type)) {
      this.queue.enqueue(message, (size) => this.emit("queue:size", { size }));
      return false;
    }
    return false;
  }

  on(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  off(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  get isConnected(): boolean {
    if (!this.ws) return false;
    return this.ws.readyState === WebSocket.OPEN;
  }

  private emit(eventType: string, payload: unknown): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[QwackWS] Handler error for ${eventType}:`, err);
        }
      }
    }
  }

  getQueueSize(): number {
    return this.queue.getSize();
  }

  clearQueue(): void {
    this.queue.clear();
  }

  static setQueueFile(path: string): void {
    OfflineQueue.setQueueFile(path);
  }


  private flushOfflineQueue(): void {
    this.queue.flush(
      (msg) => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(msg));
        }
      },
      (size) => this.emit("queue:size", { size }),
    );
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, QwackWsClient.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
