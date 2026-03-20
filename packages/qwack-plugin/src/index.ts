export { default } from "./plugin";

export { QwackBridge } from "./bridge";
export { CollaboratorState } from "./state/collaborator-state";
export { QwackWsClient } from "./ws-client";

export { readConfig, writeConfig, clearConfig } from "./auth/store";
export { createQwackClient } from "./auth/client";
export { loginFlow } from "./auth/login";

export { createPromptCaptureHook, createOutputCaptureHook, createPermissionHook } from "./hooks/capture";
export { PlanSyncHook } from "./hooks/plan-sync";
export { createSystemInjectHook, createMessageInjectHook, createCompactionInjectHook } from "./hooks/inject";

export { QWACK_SYSTEM_PROMPT, QWACK_AGENT_DESCRIPTION, QWACK_AGENT_COLOR, DEFAULT_AGENT_MODEL } from "./agent/agent-config";
export { createQwackAgentConfig } from "./agent/agent-config";
export { createQwackTools } from "./agent/tools";
export { createBridgeTools } from "./agent/bridge-tools";

export type { PluginContext } from "./hooks/capture";
export type { QwackConfig } from "./auth/store";
export type { QwackClient } from "./auth/client";
export type { QwackAgentConfig } from "./agent/agent-config";
export type { QwackToolDefinition, ToolContext } from "./agent/tools";
export type { SessionAccessor } from "./agent/bridge-tools";
