import { ulid } from "ulid"
import type { Hooks } from "@opencode-ai/plugin"
import type { CollaboratorState } from "../state/collaborator-state"

type SystemTransformHook = NonNullable<Hooks["experimental.chat.system.transform"]>
type ChatMessageHook = NonNullable<Hooks["chat.message"]>
type CompactionHook = NonNullable<Hooks["experimental.session.compacting"]>

/**
 * Creates an experimental.chat.system.transform hook that injects
 * collaborator context into the system prompt.
 *
 * Fires before every LLM call. The `output.system` array is mutable —
 * push strings and they become system messages.
 */
export function createSystemInjectHook(state: CollaboratorState): SystemTransformHook {
  return async (_input, output) => {
    const context = state.formatForSystemPrompt()
    if (context) {
      output.system.push(context)
    }
  }
}

/**
 * Creates a chat.message hook that injects unprocessed collaborator
 * messages as a synthetic text part into the user message.
 *
 * Fires after message parts are assembled but BEFORE Session.updateMessage().
 * Mutates output.parts to add a synthetic text part with team messages.
 * After injection, marks messages as processed so they aren't re-injected.
 */
export function createMessageInjectHook(state: CollaboratorState): ChatMessageHook {
  return async (input, output) => {
    const text = state.formatForMessageInjection()
    if (!text) return

    output.parts.push({
      id: ulid(),
      messageID: output.message.id,
      sessionID: input.sessionID,
      type: "text",
      synthetic: true,
      text,
    } as (typeof output.parts)[number])
    state.markMessagesProcessed()
  }
}

/**
 * Creates an experimental.session.compacting hook that persists
 * collaborator state across context window resets.
 *
 * When OpenCode compacts the session (context window full), this
 * injects team state so the agent retains awareness of collaborators.
 */
export function createCompactionInjectHook(state: CollaboratorState): CompactionHook {
  return async (_input, output) => {
    const context = state.formatForCompaction()
    if (context) {
      output.context.push(context)
    }
  }
}
