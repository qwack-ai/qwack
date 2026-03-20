import { QwackWsClient } from "./ws-client";
import { readConfig, type QwackConfig } from "./auth/store";
import { createQwackClient, type QwackClient } from "./auth/client";
import { createPromptCaptureHook, createOutputCaptureHook, createPermissionHook } from "./hooks/capture";
import { PlanSyncHook } from "./hooks/plan-sync";
import type { PluginContext } from "./hooks/capture";
import { CollaboratorState } from "./state/collaborator-state";
import { wireWsHandlers } from "./bridge-ws-handlers";
interface CommandContext {
  sessionId?: string;
  wsClient?: QwackWsClient;
  httpClient?: QwackClient;
}
import { createSystemInjectHook, createMessageInjectHook, createCompactionInjectHook } from "./hooks/inject";
import { createBridgeTools } from "./agent/bridge-tools";
import { createCollabTools } from "./agent/collab-tools";
import { createQwackAgentConfig } from "./agent/agent-config";
import type { QwackToolDefinition } from "./agent/tools";

/**
 * QwackBridge — central coordinator between the WS client and all hooks.
 * Manages session lifecycle, wires hooks to WebSocket, and provides
 * command context for slash commands.
 */
export class QwackBridge {
  private wsClient: QwackWsClient | null = null;
  private planSync: PlanSyncHook | null = null;
  private sessionId: string | null = null;
  private context: PluginContext | null = null;
  private collaboratorState: CollaboratorState | null = null;
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private tools: Record<string, QwackToolDefinition>;
  private sdkClient: any = null;
  private _isHost: boolean = false;

  constructor() {
    // Tools are created once and reference `this` dynamically via accessors.
    // They check isActive on each execute call — safe across session restarts.
    this.tools = {
      ...createBridgeTools(this),
      ...createCollabTools(this),
    };
  }

  /** Start a session — connect WS + wire hooks */
  async start(
    sessionId: string,
    userId: string,
    userName: string,
    config?: QwackConfig,
    wsClientFactory?: (server: string, token: string, sid: string) => QwackWsClient,
  ): Promise<void> {
    const resolvedConfig = config ?? readConfig();
    if (!resolvedConfig) throw new Error("Not logged in. Run /qwack login first.");

    if (this.isActive) {
      this.stop();
    }

    this.sessionId = sessionId;
    this.context = { sessionId, userId, userName };

    this.wsClient = wsClientFactory
      ? wsClientFactory(resolvedConfig.server, resolvedConfig.token, sessionId)
      : new QwackWsClient(resolvedConfig.server, resolvedConfig.token, sessionId);


    this.collaboratorState = new CollaboratorState();

    wireWsHandlers(this.wsClient, this.collaboratorState, {
      userId,
      getSessionId: () => this.sessionId,
      setIsHost: (value) => { this._isHost = value; },
      isHost: () => this._isHost,
      triggerCompaction: (sid) => this.triggerCompactionAndSendSnapshot(sid),
    });

    // Wire plan sync (bidirectional Yjs through server)
    this.planSync = new PlanSyncHook(this.wsClient, sessionId, userId);

    // Connect to the Qwack server
    this.wsClient.connect();

    // Create a promise that resolves once initial presence data arrives.
    // Hooks await this to ensure collaborator state is populated before
    // the system prompt is assembled.
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    this.wsClient.on("presence:list", () => {
      this.readyResolve?.();
      this.readyResolve = null;
    });
    // Timeout fallback — don't block the LLM call indefinitely
    setTimeout(() => {
      this.readyResolve?.();
      this.readyResolve = null;
    }, 3000);
  }

  /** Stop the session — disconnect + cleanup */
  stop(): void {
    this.planSync?.destroy();
    this.planSync = null;
    this.collaboratorState?.clear();
    this.collaboratorState = null;
    this.wsClient?.disconnect();
    this.wsClient = null;
    this.sdkClient = null;
    this.sessionId = null;
    this.context = null;
    this.readyResolve?.();
    this.readyResolve = null;
    this.readyPromise = null;
  }

  /** Get hooks for registering with the OpenCode plugin system */
  getHooks(agentModel?: string) {
    return {
      tools: this.tools,
      agentConfig: createQwackAgentConfig(agentModel),
      promptCapture: this.wsClient
        ? createPromptCaptureHook(this.wsClient)
        : null,
      outputCapture: this.wsClient
        ? createOutputCaptureHook(this.wsClient)
        : null,
      permission: this.wsClient
        ? createPermissionHook(this.wsClient)
        : null,
      systemInject: this.collaboratorState
        ? createSystemInjectHook(this.collaboratorState)
        : null,
      messageInject: this.collaboratorState
        ? createMessageInjectHook(this.collaboratorState)
        : null,
      compactionInject: this.collaboratorState
        ? createCompactionInjectHook(this.collaboratorState)
        : null,
    };
  }

  /** Get command context for slash commands */
  getCommandContext(config?: QwackConfig): CommandContext {
    const resolvedConfig = config ?? readConfig();
    return {
      sessionId: this.sessionId ?? undefined,
      wsClient: this.wsClient ?? undefined,
      httpClient: resolvedConfig ? createQwackClient(resolvedConfig) : undefined,
    };
  }

  get isActive(): boolean {
    return this.wsClient !== null && this.sessionId !== null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getUserId(): string | null {
    return this.context?.userId ?? null;
  }

  getWsClient(): QwackWsClient | null {
    return this.wsClient;
  }

  getContext(): PluginContext | null {
    return this.context;
  }

  getCollaboratorState(): CollaboratorState | null {
    return this.collaboratorState;
  }

  setClient(client: any): void {
    this.sdkClient = client;
  }

  getClient(): any {
    return this.sdkClient;
  }


  async triggerCompactionAndSendSnapshot(sessionId: string): Promise<void> {
    if (!this.sdkClient || !this.wsClient) return;
    try {
      await this.sdkClient.session.summarize({ path: { id: sessionId } });
      const response = await this.sdkClient.session.messages({ path: { id: sessionId } });
      const messages = response?.data ?? response ?? [];
      const summaryMsg = [...messages].reverse().find((m: any) => m.info?.summary === true);
      if (!summaryMsg) return;
      const textPart = summaryMsg.parts?.find((p: any) => p.type === "text");
      if (!textPart?.text) return;
      this.wsClient.send({
        type: "session:context_snapshot",
        sessionId,
        senderId: "system",
        timestamp: Date.now(),
        payload: { snapshot: textPart.text, timestamp: Date.now() },
      });
    } catch {
      // Compaction failed — lightweight snapshot from last agent:complete still on server
    }
  }

  /** Await initial presence data from the server */
  async waitForReady(): Promise<void> {
    if (this.readyPromise) await this.readyPromise;
  }
}
