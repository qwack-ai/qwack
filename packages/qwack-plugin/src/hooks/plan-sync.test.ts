import { describe, test, expect } from "bun:test";
import { PlanSyncHook } from "./plan-sync";
import { createMockWsClient } from "./test-helpers";
import { setPlanContent, getPlanContent } from "@qwack/shared";
import type { WsMessage, PlanSyncPayload } from "@qwack/shared";

describe("PlanSyncHook", () => {
  test("sends plan:sync on local doc changes", () => {
    const ws = createMockWsClient();
    const hook = new PlanSyncHook(ws as any, "ses-1", "user-1");

    setPlanContent(hook.getDoc(), "# My Plan");

    expect(ws._sent.length).toBeGreaterThan(0);
    const msg = ws._sent[0] as WsMessage<PlanSyncPayload>;
    expect(msg.type).toBe("plan:sync");
    expect(msg.sessionId).toBe("ses-1");
    expect(msg.senderId).toBe("user-1");
    expect(typeof msg.payload.update).toBe("string");

    hook.destroy();
  });

  test("applies remote plan:sync updates to local doc", () => {
    const ws = createMockWsClient();
    const hook = new PlanSyncHook(ws as any, "ses-1", "user-1");

    // Create a source doc, write content, encode its update
    const { createPlanDoc } = require("@qwack/shared");
    const sourceDoc = createPlanDoc();
    const sentBefore = ws._sent.length;

    // Capture the update from source doc
    let capturedUpdate: Uint8Array | null = null;
    sourceDoc.on("update", (update: Uint8Array) => {
      capturedUpdate = update;
    });
    setPlanContent(sourceDoc, "# Remote Plan");

    // Encode as base64 and emit as remote update
    const base64 = btoa(String.fromCharCode(...capturedUpdate!));
    ws._emit("plan:sync", { update: base64 });

    expect(getPlanContent(hook.getDoc())).toBe("# Remote Plan");

    // Should not re-broadcast the remote update
    const sentAfter = ws._sent.length;
    expect(sentAfter).toBe(sentBefore);

    sourceDoc.destroy();
    hook.destroy();
  });

  test("ignores plan:sync with missing update", () => {
    const ws = createMockWsClient();
    const hook = new PlanSyncHook(ws as any, "ses-1", "user-1");

    // Should not throw
    ws._emit("plan:sync", {});
    ws._emit("plan:sync", { update: "" });

    hook.destroy();
  });

  test("destroy cleans up the Yjs doc", () => {
    const ws = createMockWsClient();
    const hook = new PlanSyncHook(ws as any, "ses-1", "user-1");
    const doc = hook.getDoc();

    hook.destroy();

    // Doc should be destroyed (isDestroyed available on Y.Doc)
    expect(doc.isDestroyed).toBe(true);
  });
});
