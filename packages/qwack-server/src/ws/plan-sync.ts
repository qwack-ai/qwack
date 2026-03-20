import * as Y from "yjs";
import { broadcastToSession } from "./handler";
import type { WsMessage, PlanSyncPayload } from "@qwack/shared";

// Server-side Yjs doc manager: one Y.Doc per active session.
// Maintains authoritative state so new joiners get full doc.
const sessionDocs = new Map<string, Y.Doc>();

/** Get or create the Yjs doc for a session, optionally restoring from persisted state. */
export function getOrCreateDoc(
  sessionId: string,
  initialState?: Uint8Array,
): Y.Doc {
  let doc = sessionDocs.get(sessionId);
  if (!doc) {
    doc = new Y.Doc();
    if (initialState) {
      Y.applyUpdate(doc, initialState);
    }
    sessionDocs.set(sessionId, doc);
  }
  return doc;
}

/**
 * Handle plan:sync — apply a Yjs update from a client and broadcast to others.
 * Updates are base64-encoded binary for JSON transport.
 */
export function handlePlanSync(
  sessionId: string,
  userId: string,
  payload: unknown,
): void {
  const { update } = payload as PlanSyncPayload;
  if (!update) return;

  const binaryUpdate = Uint8Array.from(atob(update), (c) => c.charCodeAt(0));

  const doc = getOrCreateDoc(sessionId);
  Y.applyUpdate(doc, binaryUpdate, userId);

  broadcastToSession(
    sessionId,
    {
      type: "plan:sync",
      sessionId,
      senderId: userId,
      timestamp: Date.now(),
      payload: { update } satisfies PlanSyncPayload,
    } satisfies WsMessage<PlanSyncPayload>,
    userId,
  );
}

/** Handle plan:awareness — relay cursor/selection state to other clients. */
export function handlePlanAwareness(
  sessionId: string,
  userId: string,
  payload: unknown,
): void {
  broadcastToSession(
    sessionId,
    {
      type: "plan:awareness",
      sessionId,
      senderId: userId,
      timestamp: Date.now(),
      payload,
    } satisfies WsMessage,
    userId,
  );
}

/** Get the current doc state as binary for DB persistence. */
export function getDocState(sessionId: string): Uint8Array | null {
  const doc = sessionDocs.get(sessionId);
  if (!doc) return null;
  return Y.encodeStateAsUpdate(doc);
}

/** Clean up when a session ends. */
export function removeDoc(sessionId: string): void {
  const doc = sessionDocs.get(sessionId);
  if (doc) {
    doc.destroy();
    sessionDocs.delete(sessionId);
  }
}

/** For testing — clear all docs. */
export function clearAllDocs(): void {
  for (const doc of sessionDocs.values()) {
    doc.destroy();
  }
  sessionDocs.clear();
}
