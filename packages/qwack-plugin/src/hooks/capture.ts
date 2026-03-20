import type { QwackWsClient } from "../ws-client"

export interface PluginContext {
  sessionId: string;
  userId: string;
  userName: string;
}

interface PromptEvent {
  content: string;
  messageId: string;
}

interface OutputEvent {
  content: string;
  partId: string;
  messageId: string;
}

interface PermissionEvent {
  tool: string;
  command: string;
  requestId: string;
}

type HookHandler<T> = (event: T, context: PluginContext) => void | Promise<void>

export function createPromptCaptureHook(wsClient: QwackWsClient): HookHandler<PromptEvent> {
  return (event, context) => {
    wsClient.send({
      type: "prompt:sent",
      sessionId: context.sessionId,
      senderId: context.userId,
      timestamp: Date.now(),
      payload: {
        authorId: context.userId,
        authorName: context.userName,
        content: event.content,
      },
    })
  }
}

export function createOutputCaptureHook(wsClient: QwackWsClient): HookHandler<OutputEvent> {
  return (event, context) => {
    wsClient.send({
      type: "agent:output",
      sessionId: context.sessionId,
      senderId: context.userId,
      timestamp: Date.now(),
      payload: {
        content: event.content,
        partId: event.partId,
      },
    })
  }
}

export function createPermissionHook(wsClient: QwackWsClient): HookHandler<PermissionEvent> {
  return (event, context) => {
    wsClient.send({
      type: "agent:permission",
      sessionId: context.sessionId,
      senderId: context.userId,
      timestamp: Date.now(),
      payload: {
        tool: event.tool,
        command: event.command,
        requestId: event.requestId,
      },
    })
  }
}
