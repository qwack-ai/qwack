import * as Y from "yjs";
import type { QwackWsClient } from "../ws-client";
import { createPlanDoc } from "@qwack/shared";
import type { PlanSyncPayload } from "@qwack/shared";

export class PlanSyncHook {
  private doc: Y.Doc;
  private isApplyingRemote = false;

  constructor(
    private wsClient: QwackWsClient,
    private sessionId: string,
    private userId: string,
  ) {
    this.doc = createPlanDoc();

    // Listen for remote plan updates from the Qwack server
    this.wsClient.on("plan:sync", (payload) => {
      const { update } = payload as PlanSyncPayload;
      if (!update) return;

      this.isApplyingRemote = true;
      try {
        const binary = Uint8Array.from(atob(update), (c) => c.charCodeAt(0));
        Y.applyUpdate(this.doc, binary);
      } finally {
        this.isApplyingRemote = false;
      }
    });

    // Watch for local changes and send to server
    this.doc.on("update", (update: Uint8Array, _origin: unknown) => {
      if (this.isApplyingRemote) return;

      const base64 = btoa(String.fromCharCode(...update));
      this.wsClient.send({
        type: "plan:sync",
        sessionId: this.sessionId,
        senderId: this.userId,
        timestamp: Date.now(),
        payload: { update: base64 },
      });
    });
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  destroy(): void {
    this.doc.destroy();
  }
}
