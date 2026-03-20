/**
 * E2E: Plan Document Sync via Yjs CRDT
 *
 * Proves the full Yjs sync loop:
 *   Client A edits Y.Doc → base64 update → WS → server applies + broadcasts
 *   → Client B receives → applies to its Y.Doc → docs converge
 *
 * Tests:
 * 1. Single edit syncs from A to B
 * 2. Edits sync from B to A (bidirectional)
 * 3. Concurrent edits merge correctly (CRDT)
 * 4. Plan metadata (title, status) syncs
 * 5. Server maintains authoritative state (late joiner gets full doc)
 * 6. plan:awareness relays between clients
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as Y from "yjs";
import type { Server } from "bun";
import { app } from "../app";
import { websocket, clearAllConnections, clearHandlerRegistrations } from "../ws/handler";
import { registerWsHandlers } from "../ws/register-handlers";
import { clearAllBuffers } from "../ws/event-buffer";
import {
  createPlanDoc,
  getPlanContent,
  setPlanContent,
  getPlanMeta,
  setPlanMeta,
  PLAN_TEXT_KEY,
  PLAN_META_KEY,
} from "@qwack/shared";

let server: Server;
let port: number;

function wsUrl(token: string, sessionId: string): string {
  return `ws://localhost:${port}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
}

/** Encode a Yjs update to base64 (same as plugin does) */
function encodeUpdate(update: Uint8Array): string {
  return btoa(String.fromCharCode(...update));
}

/** Decode a base64 Yjs update (same as plugin does) */
function decodeUpdate(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Create a "plan client" — a Y.Doc wired to a WebSocket, simulating
 * what PlanSyncHook does in the plugin. This is the client-side half.
 */
function createPlanClient(
  token: string,
  sessionId: string,
): Promise<{
  doc: Y.Doc;
  ws: WebSocket;
  received: Array<{ type: string; payload: unknown }>;
  waitFor: (type: string, timeout?: number) => Promise<any>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const doc = createPlanDoc();
    const received: Array<{ type: string; payload: unknown }> = [];
    const waiters: Array<{ type: string; resolve: (msg: any) => void }> = [];
    let isApplyingRemote = false;

    const ws = new WebSocket(wsUrl(token, sessionId));

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        received.push(msg);

        // Apply incoming plan:sync updates to our local doc
        if (msg.type === "plan:sync") {
          const { update } = msg.payload as { update: string };
          if (update) {
            isApplyingRemote = true;
            try {
              Y.applyUpdate(doc, decodeUpdate(update));
            } finally {
              isApplyingRemote = false;
            }
          }
        }

        // Resolve waiters
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (msg.type === waiters[i].type) {
            waiters.splice(i, 1)[0].resolve(msg);
          }
        }
      } catch {
        // ignore
      }
    };

    // Watch local doc changes → send to server (mirrors PlanSyncHook logic)
    doc.on("update", (update: Uint8Array, _origin: unknown) => {
      if (isApplyingRemote) return;
      if (ws.readyState !== WebSocket.OPEN) return;

      ws.send(
        JSON.stringify({
          type: "plan:sync",
          sessionId,
          senderId: token,
          timestamp: Date.now(),
          payload: { update: encodeUpdate(update) },
        }),
      );
    });

    ws.onopen = () => {
      resolve({
        doc,
        ws,
        received,
        waitFor: (type: string, timeout = 3000) => {
          const existing = received.find((m) => m.type === type);
          if (existing) return Promise.resolve(existing);
          return new Promise((res, rej) => {
            const timer = setTimeout(
              () =>
                rej(
                  new Error(
                    `Timed out waiting for "${type}". Got: ${received.map((m) => m.type).join(", ")}`,
                  ),
                ),
              timeout,
            );
            waiters.push({
              type,
              resolve: (msg) => {
                clearTimeout(timer);
                res(msg);
              },
            });
          });
        },
        close: () => {
          doc.destroy();
          ws.close();
        },
      });
    };

    ws.onerror = (err) => reject(err);
  });
}

describe("Plan Sync E2E (Yjs CRDT)", () => {
  beforeAll(() => {
    clearAllConnections();
    clearAllBuffers();
    clearHandlerRegistrations();
    registerWsHandlers();
    server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
    port = server.port;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("edit on Client A syncs to Client B", async () => {
    const session = "plan-sync-basic";
    const clientA = await createPlanClient("alice", session);
    await clientA.waitFor("presence:list");

    const clientB = await createPlanClient("bob", session);
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Alice writes plan content
    setPlanContent(clientA.doc, "# Auth Refactor\n1. Extract JWT utils\n2. Add refresh tokens");

    // Bob should receive the update
    await clientB.waitFor("plan:sync");

    // Small delay to let Yjs process
    await Bun.sleep(50);

    // Both docs should have identical content
    expect(getPlanContent(clientB.doc)).toBe(
      "# Auth Refactor\n1. Extract JWT utils\n2. Add refresh tokens",
    );

    clientA.close();
    clientB.close();
  });

  test("edits sync bidirectionally (B → A)", async () => {
    const session = "plan-sync-bidi";
    const clientA = await createPlanClient("alice", session);
    await clientA.waitFor("presence:list");

    const clientB = await createPlanClient("bob", session);
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Alice writes initial content
    setPlanContent(clientA.doc, "Step 1: Setup");
    await clientB.waitFor("plan:sync");
    await Bun.sleep(50);
    expect(getPlanContent(clientB.doc)).toBe("Step 1: Setup");

    // Bob replaces the content
    setPlanContent(clientB.doc, "Step 1: Setup\nStep 2: Implement");
    await clientA.waitFor("plan:sync");
    await Bun.sleep(50);
    expect(getPlanContent(clientA.doc)).toBe("Step 1: Setup\nStep 2: Implement");

    clientA.close();
    clientB.close();
  });

  test("concurrent edits merge via CRDT (no conflicts)", async () => {
    const session = "plan-sync-concurrent";
    const clientA = await createPlanClient("alice", session);
    await clientA.waitFor("presence:list");

    const clientB = await createPlanClient("bob", session);
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Both start with same base content
    setPlanContent(clientA.doc, "Base plan");
    await clientB.waitFor("plan:sync");
    await Bun.sleep(50);

    // Now both edit concurrently — different Y.Text operations
    // Alice appends to the text
    clientA.doc.getText(PLAN_TEXT_KEY).insert(
      getPlanContent(clientA.doc).length,
      "\n- Alice's step",
    );

    // Bob also appends (before receiving Alice's update)
    clientB.doc.getText(PLAN_TEXT_KEY).insert(
      getPlanContent(clientB.doc).length,
      "\n- Bob's step",
    );

    // Wait for sync to propagate both ways
    await Bun.sleep(200);

    // CRDT magic: both docs should contain both additions
    const contentA = getPlanContent(clientA.doc);
    const contentB = getPlanContent(clientB.doc);

    expect(contentA).toContain("Base plan");
    expect(contentA).toContain("Alice's step");
    expect(contentA).toContain("Bob's step");

    expect(contentB).toContain("Base plan");
    expect(contentB).toContain("Alice's step");
    expect(contentB).toContain("Bob's step");

    // Both docs converge to the same content
    expect(contentA).toBe(contentB);

    clientA.close();
    clientB.close();
  });

  test("plan metadata syncs (title, status)", async () => {
    const session = "plan-sync-meta";
    const clientA = await createPlanClient("alice", session);
    await clientA.waitFor("presence:list");

    const clientB = await createPlanClient("bob", session);
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Alice sets plan metadata
    setPlanMeta(clientA.doc, {
      title: "Auth Refactor Sprint",
      status: "active",
      updatedAt: Date.now(),
    });

    await clientB.waitFor("plan:sync");
    await Bun.sleep(50);

    const metaB = getPlanMeta(clientB.doc);
    expect(metaB.title).toBe("Auth Refactor Sprint");
    expect(metaB.status).toBe("active");

    // Bob updates status
    setPlanMeta(clientB.doc, { status: "paused" });

    await clientA.waitFor("plan:sync");
    await Bun.sleep(50);

    const metaA = getPlanMeta(clientA.doc);
    expect(metaA.status).toBe("paused");
    expect(metaA.title).toBe("Auth Refactor Sprint"); // unchanged

    clientA.close();
    clientB.close();
  });

  test("late joiner gets full document state", async () => {
    const session = "plan-sync-late-join";

    // Alice connects and writes content
    const clientA = await createPlanClient("alice", session);
    await clientA.waitFor("presence:list");

    setPlanContent(clientA.doc, "# Plan\n1. First step\n2. Second step");
    setPlanMeta(clientA.doc, { title: "Late Join Test", status: "active", updatedAt: Date.now() });

    // Wait for server to receive and store the updates
    await Bun.sleep(150);

    // Bob joins AFTER Alice has already written content
    // Server should auto-send full plan state on connect
    const clientB = await createPlanClient("bob", session);
    await clientB.waitFor("presence:list");

    // Bob should receive plan:sync with full state from server
    await clientB.waitFor("plan:sync");
    await Bun.sleep(50);

    // Bob should have the full content Alice wrote
    const bobContent = getPlanContent(clientB.doc);
    expect(bobContent).toBe("# Plan\n1. First step\n2. Second step");

    // Bob should also have metadata
    const bobMeta = getPlanMeta(clientB.doc);
    expect(bobMeta.title).toBe("Late Join Test");
    expect(bobMeta.status).toBe("active");

    clientA.close();
    clientB.close();
  });

  test("plan:awareness relays between clients", async () => {
    const session = "plan-sync-awareness";
    const clientA = await createPlanClient("alice", session);
    await clientA.waitFor("presence:list");

    const clientB = await createPlanClient("bob", session);
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Alice sends awareness (cursor position)
    clientA.ws.send(
      JSON.stringify({
        type: "plan:awareness",
        sessionId: session,
        senderId: "alice",
        timestamp: Date.now(),
        payload: {
          cursor: { line: 5, ch: 12 },
          user: { name: "Alice", color: "#ff0000" },
        },
      }),
    );

    // Bob should receive it
    const awareness = await clientB.waitFor("plan:awareness");
    expect((awareness.payload as any).cursor.line).toBe(5);
    expect((awareness.payload as any).user.name).toBe("Alice");

    // Alice should NOT receive echo
    await Bun.sleep(100);
    const aliceAwareness = clientA.received.filter((m) => m.type === "plan:awareness");
    expect(aliceAwareness.length).toBe(0);

    clientA.close();
    clientB.close();
  });

  test("rapid sequential edits all sync correctly", async () => {
    const session = "plan-sync-rapid";
    const clientA = await createPlanClient("alice", session);
    await clientA.waitFor("presence:list");

    const clientB = await createPlanClient("bob", session);
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Alice makes 10 rapid edits
    const text = clientA.doc.getText(PLAN_TEXT_KEY);
    for (let i = 0; i < 10; i++) {
      text.insert(text.length, `Line ${i}\n`);
    }

    // Wait for all updates to propagate
    await Bun.sleep(300);

    const bobContent = getPlanContent(clientB.doc);
    for (let i = 0; i < 10; i++) {
      expect(bobContent).toContain(`Line ${i}`);
    }

    clientA.close();
    clientB.close();
  });
});
