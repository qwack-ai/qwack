import type { Plugin } from "@opencode-ai/plugin";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { QwackBridge } from "./bridge";
import { readConfig } from "./auth/store";
import { createQwackAgentConfig } from "./agent/agent-config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Qwack OpenCode Plugin — collaborative AI agent.
 *
 * Registers:
 *   - "qwack" agent (primary, configurable model)
 *   - Collaboration tools (propose, disagree, status, who, etc.)
 *   - System prompt injection (team context)
 *   - Message injection (collab messages as synthetic parts)
 *   - Compaction injection (persist state across context resets)
 */
const QwackPlugin: Plugin = async (_ctx) => {
  const bridge = new QwackBridge();
  const config = readConfig();
  const agentModel = config?.agentModel;

  const SESSION_FILE = process.env.QWACK_SESSION_FILE ?? join(homedir(), ".config", "qwack", "active-session.json");

  async function ensureBridge() {
    // Always re-read the session file — session ID may have changed since last call
    if (!existsSync(SESSION_FILE)) {
      if (bridge.isActive) bridge.stop();
      return;
    }
    try {
      const session = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
      const cfg = readConfig();
      if (!cfg || !session.sessionId) return;

      if (bridge.isActive && bridge.getSessionId() === session.sessionId) {
        // Already connected — ensure initial presence data has arrived
        await bridge.waitForReady();
        return;
      }

      // Session changed or not yet connected — (re)connect
      await bridge.start(session.sessionId, cfg.name ?? "plugin-user", cfg.name ?? "Plugin", cfg);
      await bridge.waitForReady();
    } catch {
      return;
    }
  }

  const hooks = bridge.getHooks(agentModel);
  const pluginTools: Record<string, ReturnType<typeof tool>> = {};
  for (const [name, def] of Object.entries(hooks.tools)) {
    pluginTools[name] = tool({
      description: def.description,
      args: def.args,
      execute: def.execute as ToolDefinition["execute"],
    });
  }

  // Track part types: partID → "text" | "reasoning" | "tool" | etc.
  const partTypes = new Map<string, string>();
  const toolStates = new Map<string, string>(); // partId → lastStatus

  return {
    // Register Qwack as a primary agent
    config: async (openCodeConfig: any) => {
      openCodeConfig.agent ??= {};
      openCodeConfig.agent["qwack"] = createQwackAgentConfig(agentModel);
    },

    // Register collaboration tools
    tool: pluginTools,

    // Inject team context into system prompt
    "experimental.chat.system.transform": async (_input: any, output: any) => {
      await ensureBridge();
      const state = bridge.getCollaboratorState();
      const context = state?.formatForSystemPrompt() ?? "";
      if (context) output.system.push(context);
    },

    // Inject collab messages as synthetic parts
    "chat.message": async (input: any, output: any) => {
      await ensureBridge();
      const state = bridge.getCollaboratorState();
      if (state) {
        const text = state.formatForMessageInjection();
        if (text) {
          output.parts.push({
            id: Date.now().toString(36),
            messageID: output.message?.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            text,
          });
          state.markMessagesProcessed();
        }
      }
    },

    // Persist team state across context resets
    "experimental.session.compacting": async (_input: any, output: any) => {
      await ensureBridge();
      const state = bridge.getCollaboratorState();
      if (state) {
        const context = state.formatForCompaction();
        if (context) output.context.push(context);
      }
    },

    // Relay streaming agent output to collaborators
    event: async (input: { event: { type: string; properties: Record<string, unknown> } }) => {
      const wsClient = bridge.getWsClient();
      if (!wsClient || !bridge.isActive) return;
      const evt = input.event;

      // Track part types from full Part objects
      if (evt.type === "message.part.updated") {
        const part = evt.properties.part as { id?: string; type?: string } | undefined;
        if (part?.id && part?.type) partTypes.set(part.id, part.type);

        // Relay tool state transitions
        if (part?.type === "tool") {
          const toolPart = part as { id: string; tool: string; state: { status: string; input?: unknown; output?: string; error?: string; metadata?: Record<string, unknown> }; messageID?: string };
          const prevStatus = toolStates.get(toolPart.id);
          const newStatus = toolPart.state?.status;

          if (newStatus && newStatus !== prevStatus) {
            toolStates.set(toolPart.id, newStatus);

            if (newStatus === "running") {
              wsClient.send({
                type: "agent:tool_use",
                sessionId: bridge.getSessionId() ?? "",
                senderId: bridge.getUserId() ?? "agent",
                timestamp: Date.now(),
                payload: {
                  tool: toolPart.tool,
                  input: toolPart.state.input ?? {},
                  partId: toolPart.id,
                  messageId: toolPart.messageID,
                },
              });
            } else if (newStatus === "completed" || newStatus === "error") {
              wsClient.send({
                type: "agent:tool_result",
                sessionId: bridge.getSessionId() ?? "",
                senderId: bridge.getUserId() ?? "agent",
                timestamp: Date.now(),
                payload: {
                  tool: toolPart.tool,
                  output: newStatus === "completed" ? (toolPart.state.output ?? "") : "",
                  metadata: toolPart.state.metadata,
                  partId: toolPart.id,
                  messageId: toolPart.messageID,
                  status: newStatus as "completed" | "error",
                  error: newStatus === "error" ? (toolPart.state.error ?? "Unknown error") : undefined,
                },
              });
            }
          }
        }
      }

      // Relay text and reasoning as separate event types
      if (evt.type === "message.part.delta") {
        const props = evt.properties as { partID?: string; messageID?: string; field?: string; delta?: string };
        if (props.field !== "text" || !props.delta) return;
        const partType = props.partID ? partTypes.get(props.partID) : undefined;
        if (partType === "text") {
          wsClient.send({
            type: "agent:output",
            sessionId: bridge.getSessionId() ?? "",
            senderId: "agent",
            timestamp: Date.now(),
            payload: { content: props.delta, messageId: props.messageID },
          });
        } else if (partType === "reasoning") {
          wsClient.send({
            type: "agent:thinking",
            sessionId: bridge.getSessionId() ?? "",
            senderId: "agent",
            timestamp: Date.now(),
            payload: { content: props.delta, messageId: props.messageID },
          });
        }
      }

      if (evt.type === "message.updated") {
        const props = evt.properties as { info?: { id?: string; role?: string; time?: { completed?: string } } };
        if (props.info?.role === "assistant" && props.info?.time?.completed) {
          partTypes.clear();
          toolStates.clear();
          wsClient.send({
            type: "agent:complete",
            sessionId: bridge.getSessionId() ?? "",
            senderId: "agent",
            timestamp: Date.now(),
            payload: { messageId: props.info?.id },
          });

          // Send lightweight context snapshot for crash recovery
          const state = bridge.getCollaboratorState();
          if (state) {
            const snapshot = state.formatForCompaction();
            if (snapshot) {
              wsClient.send({
                type: "session:context_snapshot",
                sessionId: bridge.getSessionId() ?? "",
                senderId: "agent",
                timestamp: Date.now(),
                payload: { snapshot, timestamp: Date.now() },
              });
            }
          }
        }
      }
    },
  };
};

export default QwackPlugin;
