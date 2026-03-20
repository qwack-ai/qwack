import type { QwackWsClient } from "./ws-client";
import type { CollaboratorState } from "./state/collaborator-state";
import type {
  PresenceJoinPayload,
  PresenceLeavePayload,
  PresenceListPayload,
  CollabMessagePayload,
  AgentProposalResponsePayload,
} from "@qwack/shared";

interface PresenceParticipant {
  id?: string;
  userId?: string;
  name?: string;
  role?: string;
  user?: { name?: string };
}

interface WireContext {
  userId: string;
  getSessionId: () => string | null;
  setIsHost: (value: boolean) => void;
  isHost: () => boolean;
  triggerCompaction: (sessionId: string) => void;
}

export function wireWsHandlers(
  wsClient: QwackWsClient,
  collaboratorState: CollaboratorState,
  ctx: WireContext,
): void {
  wsClient.on("presence:join", (payload) => {
    const { user, role } = payload as PresenceJoinPayload;
    collaboratorState.addPresence({ id: user.id, name: user.name, role });
  });

  wsClient.on("presence:leave", (payload) => {
    const { userId } = payload as PresenceLeavePayload;
    collaboratorState.removePresence(userId);
  });

  wsClient.on("presence:list", (payload) => {
    const { participants } = payload as PresenceListPayload;
    for (const p of participants as PresenceParticipant[]) {
      const id = p.id ?? p.userId;
      const name = p.name ?? p.user?.name ?? "unknown";
      const role = p.role ?? "collaborator";
      if (id) {
        collaboratorState.addPresence({ id, name, role });
        if (id === ctx.userId) ctx.setIsHost(role === "host");
      }
    }
  });

  wsClient.on("collab:message", (payload) => {
    const { authorName, content } = payload as CollabMessagePayload;
    collaboratorState.addMessage(authorName, content);
  });

  wsClient.on("agent:proposal_response", (payload) => {
    const p = payload as AgentProposalResponsePayload;
    collaboratorState.resolveProposal(p.proposalId, p.accepted, p.responderId, p.responderName, p.reason);
  });

  wsClient.on("session:context_snapshot", (payload) => {
    const { snapshot } = payload as { snapshot: string };
    if (snapshot) {
      collaboratorState.setTransferContext(snapshot);
    }
  });

  wsClient.on("session:history", (payload) => {
    const { events } = payload as { events: Array<{ type: string; payload: Record<string, unknown> }> };
    if (events && events.length > 0) {
      const formatted = collaboratorState.formatEventHistoryForPrompt(events);
      if (formatted) collaboratorState.setEventHistory(formatted);
    }
  });

  wsClient.on("session:host_change", (payload) => {
    const { newHostId } = payload as { newHostId: string };
    if (ctx.isHost() && newHostId !== ctx.userId) {
      ctx.setIsHost(false);
      const sessionId = ctx.getSessionId();
      if (sessionId) {
        ctx.triggerCompaction(sessionId);
      }
    } else if (newHostId === ctx.userId) {
      ctx.setIsHost(true);
    }
  });
}
