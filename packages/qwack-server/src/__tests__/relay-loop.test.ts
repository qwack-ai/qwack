/**
 * E2E Smoke Test: Core Relay Loop
 *
 * Starts a real Qwack server, connects two WebSocket clients,
 * and verifies that events sent by one appear on the other.
 *
 * Tests:
 * 1. Presence — both clients get presence events on connect
 * 2. prompt:sent — host sends prompt, collaborator sees it
 * 3. agent:output — host sends agent output, collaborator sees it
 * 4. collab:message — collaborator sends chat, host sees it
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { app } from "../app";
import { websocket, clearAllConnections, clearHandlerRegistrations } from "../ws/handler";
import { registerWsHandlers } from "../ws/register-handlers";
import { clearAllBuffers } from "../ws/event-buffer";

let server: Server;
let port: number;

function wsUrl(token: string, sessionId: string): string {
  return `ws://localhost:${port}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
}

/** Connect a WS client, collect messages, and resolve when the first message of `waitForType` arrives. */
function connectClient(
  token: string,
  sessionId: string,
): Promise<{
  ws: WebSocket;
  messages: Array<{ type: string; payload: unknown; senderId: string }>;
  waitFor: (type: string, timeout?: number) => Promise<{ type: string; payload: unknown; senderId: string }>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const messages: Array<{ type: string; payload: unknown; senderId: string }> = [];
    const waiters: Array<{ type: string; resolve: (msg: any) => void }> = [];

    const ws = new WebSocket(wsUrl(token, sessionId));

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        messages.push(msg);

        // Check waiters
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (msg.type === waiters[i].type) {
            const waiter = waiters.splice(i, 1)[0];
            waiter.resolve(msg);
          }
        }
      } catch {
        // ignore
      }
    };

    ws.onopen = () => {
      resolve({
        ws,
        messages,
        waitFor: (type: string, timeout = 3000) => {
          // Check already-received messages first
          const existing = messages.find((m) => m.type === type);
          if (existing) return Promise.resolve(existing);

          return new Promise((res, rej) => {
            const timer = setTimeout(
              () => rej(new Error(`Timed out waiting for "${type}". Got: ${messages.map((m) => m.type).join(", ")}`)),
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
        close: () => ws.close(),
      });
    };

    ws.onerror = (err) => reject(err);
  });
}

describe("Core Relay Loop (E2E)", () => {
  beforeAll(() => {
    clearAllConnections();
    clearAllBuffers();
    clearHandlerRegistrations();
    registerWsHandlers();
    server = Bun.serve({
      port: 0,
      fetch: app.fetch,
      websocket,
    });
    port = server.port;
  });

  afterAll(() => {
    server.stop(true);
  });

  const SESSION_ID = "smoke-test-session";

  test("two clients connect and receive presence events", async () => {
    // Client A (host) connects
    const clientA = await connectClient("host-user", SESSION_ID);

    // Client A should receive presence:list with itself
    const listA = await clientA.waitFor("presence:list");
    expect(listA.payload).toHaveProperty("participants");
    expect((listA.payload as any).participants.some((p: any) => p.id === "host-user")).toBe(true);

    // Client B (collaborator) connects
    const clientB = await connectClient("collab-user", SESSION_ID);

    // Client A should see presence:join for collab-user
    const joinA = await clientA.waitFor("presence:join");
    expect((joinA.payload as any).user.id).toBe("collab-user");
    expect((joinA.payload as any).user.name).toBe("collab-user");
    expect((joinA.payload as any).role).toBe("collaborator");

    // Client B should receive presence:list with both users
    const listB = await clientB.waitFor("presence:list");
    const participantsB = (listB.payload as any).participants;
    expect(participantsB.some((p: any) => p.id === "host-user")).toBe(true);
    expect(participantsB.some((p: any) => p.id === "collab-user")).toBe(true);

    clientA.close();
    clientB.close();
  });

  test("prompt:sent relays from host to collaborator", async () => {
    const clientA = await connectClient("host-2", SESSION_ID + "-prompt");
    await clientA.waitFor("presence:list");

    const clientB = await connectClient("collab-2", SESSION_ID + "-prompt");
    await clientB.waitFor("presence:list");

    // Wait for Client A to see the join event (sync)
    await clientA.waitFor("presence:join");

    // Host sends a prompt
    clientA.ws.send(
      JSON.stringify({
        type: "prompt:sent",
        sessionId: SESSION_ID + "-prompt",
        senderId: "host-2",
        timestamp: Date.now(),
        payload: {
          authorId: "host-2",
          authorName: "alice",
          content: "add rate limiting to the auth endpoint",
        },
      }),
    );

    // Collaborator should receive it
    const received = await clientB.waitFor("prompt:sent");
    expect((received.payload as any).content).toBe("add rate limiting to the auth endpoint");
    expect((received.payload as any).authorName).toBe("alice");
    expect(received.senderId).toBe("host-2");

    // Host should NOT receive echo of their own prompt
    await Bun.sleep(100);
    const hostPrompts = clientA.messages.filter((m) => m.type === "prompt:sent");
    expect(hostPrompts.length).toBe(0);

    clientA.close();
    clientB.close();
  });

  test("agent:output relays from host to collaborator", async () => {
    const clientA = await connectClient("host-3", SESSION_ID + "-agent");
    await clientA.waitFor("presence:list");

    const clientB = await connectClient("collab-3", SESSION_ID + "-agent");
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Host sends agent output
    clientA.ws.send(
      JSON.stringify({
        type: "agent:output",
        sessionId: SESSION_ID + "-agent",
        senderId: "host-3",
        timestamp: Date.now(),
        payload: {
          content: "Created file src/auth/rate-limiter.ts",
          partId: "part-001",
        },
      }),
    );

    // Collaborator receives it
    const received = await clientB.waitFor("agent:output");
    expect((received.payload as any).content).toBe("Created file src/auth/rate-limiter.ts");
    expect((received.payload as any).partId).toBe("part-001");

    clientA.close();
    clientB.close();
  });

  test("agent:tool_use relays from host to collaborator", async () => {
    const clientA = await connectClient("host-4", SESSION_ID + "-tool");
    await clientA.waitFor("presence:list");

    const clientB = await connectClient("collab-4", SESSION_ID + "-tool");
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Host sends tool_use event
    clientA.ws.send(
      JSON.stringify({
        type: "agent:tool_use",
        sessionId: SESSION_ID + "-tool",
        senderId: "host-4",
        timestamp: Date.now(),
        payload: {
          tool: "write_file",
          input: { path: "src/auth/rate-limiter.ts", content: "export function rateLimit() {}" },
        },
      }),
    );

    const received = await clientB.waitFor("agent:tool_use");
    expect((received.payload as any).tool).toBe("write_file");

    clientA.close();
    clientB.close();
  });

  test("collab:message relays bidirectionally", async () => {
    const clientA = await connectClient("host-5", SESSION_ID + "-collab");
    await clientA.waitFor("presence:list");

    const clientB = await connectClient("collab-5", SESSION_ID + "-collab");
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Collaborator sends a chat message
    clientB.ws.send(
      JSON.stringify({
        type: "collab:message",
        sessionId: SESSION_ID + "-collab",
        senderId: "collab-5",
        timestamp: Date.now(),
        payload: {
          authorName: "sarah",
          content: "should we add rate limiting too?",
        },
      }),
    );

    // Host receives it
    const received = await clientA.waitFor("collab:message");
    expect((received.payload as any).authorName).toBe("sarah");
    expect((received.payload as any).content).toBe("should we add rate limiting too?");

    clientA.close();
    clientB.close();
  });

  test("presence:leave fires when client disconnects", async () => {
    const clientA = await connectClient("host-6", SESSION_ID + "-leave");
    await clientA.waitFor("presence:list");

    const clientB = await connectClient("collab-6", SESSION_ID + "-leave");
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Collaborator disconnects
    clientB.close();

    // Host should receive presence:leave
    const left = await clientA.waitFor("presence:leave");
    expect((left.payload as any).userId).toBe("collab-6");

    clientA.close();
  });

  test("full relay loop: prompt → agent output → collab message", async () => {
    const clientA = await connectClient("alice", SESSION_ID + "-full");
    await clientA.waitFor("presence:list");

    const clientB = await connectClient("bob", SESSION_ID + "-full");
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Step 1: Alice (host) sends a prompt
    clientA.ws.send(
      JSON.stringify({
        type: "prompt:sent",
        sessionId: SESSION_ID + "-full",
        senderId: "alice",
        timestamp: Date.now(),
        payload: {
          authorId: "alice",
          authorName: "Alice",
          content: "refactor auth module",
        },
      }),
    );

    const prompt = await clientB.waitFor("prompt:sent");
    expect((prompt.payload as any).content).toBe("refactor auth module");

    // Step 2: Alice's agent produces output
    clientA.ws.send(
      JSON.stringify({
        type: "agent:output",
        sessionId: SESSION_ID + "-full",
        senderId: "alice",
        timestamp: Date.now(),
        payload: { content: "Reading src/auth/jwt.ts...", partId: "p1" },
      }),
    );

    const output = await clientB.waitFor("agent:output");
    expect((output.payload as any).content).toBe("Reading src/auth/jwt.ts...");

    // Step 3: Bob comments inline
    clientB.ws.send(
      JSON.stringify({
        type: "collab:message",
        sessionId: SESSION_ID + "-full",
        senderId: "bob",
        timestamp: Date.now(),
        payload: { authorName: "Bob", content: "looks good, keep going!" },
      }),
    );

    const chat = await clientA.waitFor("collab:message");
    expect((chat.payload as any).authorName).toBe("Bob");
    expect((chat.payload as any).content).toBe("looks good, keep going!");

    // Step 4: Agent completes
    clientA.ws.send(
      JSON.stringify({
        type: "agent:complete",
        sessionId: SESSION_ID + "-full",
        senderId: "alice",
        timestamp: Date.now(),
        payload: { messageId: "msg-final" },
      }),
    );

    const complete = await clientB.waitFor("agent:complete");
    expect((complete.payload as any).messageId).toBe("msg-final");

    clientA.close();
    clientB.close();
  });

  test("prompt:request relays as prompt:execute to host only", async () => {
    const clientA = await connectClient("alice-pr", SESSION_ID + "-prompt-req");
    await clientA.waitFor("presence:list");

    const clientB = await connectClient("bob-pr", SESSION_ID + "-prompt-req");
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Bob (non-host) sends a prompt:request
    clientB.ws.send(
      JSON.stringify({
        type: "prompt:request",
        sessionId: SESSION_ID + "-prompt-req",
        senderId: "bob-pr",
        timestamp: Date.now(),
        payload: {
          authorId: "bob-pr",
          authorName: "Bob",
          content: "add rate limiting to the auth endpoint",
        },
      }),
    );

    // Alice (host) should receive prompt:execute
    const execute = await clientA.waitFor("prompt:execute");
    expect((execute.payload as any).content).toBe("add rate limiting to the auth endpoint");
    expect((execute.payload as any).requestedBy).toBe("bob-pr");

    // Alice also gets prompt:sent (broadcast excludes sender bob-pr, not alice)
    const aliceSent = await clientA.waitFor("prompt:sent");
    expect((aliceSent.payload as any).content).toBe("add rate limiting to the auth endpoint");
    expect((aliceSent.payload as any).authorName).toBe("Bob");

    // Bob should NOT receive prompt:execute (that's host-only)
    await Bun.sleep(100);
    const bobExecute = clientB.messages.find(m => m.type === "prompt:execute");
    expect(bobExecute).toBeUndefined();

    clientA.close();
    clientB.close();
  });

  test("prompt:request buffers when host offline, delivers on reconnect", async () => {
    const sid = SESSION_ID + "-buffer";

    // Alice connects as host, then disconnects
    const clientA1 = await connectClient("alice-buf", sid);
    await clientA1.waitFor("presence:list");

    const clientB = await connectClient("bob-buf", sid);
    await clientB.waitFor("presence:list");
    await clientA1.waitFor("presence:join");

    // Alice goes offline
    clientA1.close();
    await clientB.waitFor("presence:leave");

    // Bob sends prompts while Alice is offline
    clientB.ws.send(
      JSON.stringify({
        type: "prompt:request",
        sessionId: sid,
        senderId: "bob-buf",
        timestamp: Date.now(),
        payload: {
          authorId: "bob-buf",
          authorName: "Bob",
          content: "first buffered prompt",
        },
      }),
    );
    clientB.ws.send(
      JSON.stringify({
        type: "prompt:request",
        sessionId: sid,
        senderId: "bob-buf",
        timestamp: Date.now(),
        payload: {
          authorId: "bob-buf",
          authorName: "Bob",
          content: "second buffered prompt",
        },
      }),
    );

    // Small delay for server to process
    await Bun.sleep(50);

    // Alice reconnects — should receive buffered prompts as prompt:execute
    const clientA2 = await connectClient("alice-buf", sid);

    // Wait for the buffered prompt(s) to arrive
    await clientA2.waitFor("prompt:execute");
    await Bun.sleep(100);

    const executeMessages = clientA2.messages.filter(m => m.type === "prompt:execute");
    expect(executeMessages.length).toBe(2);
    expect((executeMessages[0].payload as any).content).toBe("first buffered prompt");
    expect((executeMessages[1].payload as any).content).toBe("second buffered prompt");

    clientA2.close();
    clientB.close();
  });

  test("full non-host relay loop: prompt:request → prompt:execute → agent output", async () => {
    const sid = SESSION_ID + "-nonhost-full";
    const clientA = await connectClient("alice-nh", sid);
    await clientA.waitFor("presence:list");

    const clientB = await connectClient("bob-nh", sid);
    await clientB.waitFor("presence:list");
    await clientA.waitFor("presence:join");

    // Step 1: Bob sends prompt:request
    clientB.ws.send(
      JSON.stringify({
        type: "prompt:request",
        sessionId: sid,
        senderId: "bob-nh",
        timestamp: Date.now(),
        payload: {
          authorId: "bob-nh",
          authorName: "Bob",
          content: "refactor the auth module",
        },
      }),
    );

    // Alice receives prompt:execute
    const execute = await clientA.waitFor("prompt:execute");
    expect((execute.payload as any).content).toBe("refactor the auth module");

    // Step 2: Alice's agent processes and produces output
    clientA.ws.send(
      JSON.stringify({
        type: "agent:output",
        sessionId: sid,
        senderId: "alice-nh",
        timestamp: Date.now(),
        payload: { content: "Refactoring auth module...", partId: "p1" },
      }),
    );

    // Bob sees the agent output
    const output = await clientB.waitFor("agent:output");
    expect((output.payload as any).content).toBe("Refactoring auth module...");

    // Step 3: Agent completes
    clientA.ws.send(
      JSON.stringify({
        type: "agent:complete",
        sessionId: sid,
        senderId: "alice-nh",
        timestamp: Date.now(),
        payload: { messageId: "msg-done" },
      }),
    );

    const complete = await clientB.waitFor("agent:complete");
    expect((complete.payload as any).messageId).toBe("msg-done");

    clientA.close();
    clientB.close();
  });
});

describe("Session persistence (E2E)", () => {
  let server2: Server;
  let port2: number;

  beforeAll(() => {
    // Create a fresh app with its own in-memory DB (tables + seed users)
    const { createTestRepository } = require("../db/test-helpers");
    const { createApp } = require("../app");
    const { repo, db } = createTestRepository();
    // Seed alice and bob users so foreign keys pass
    db.run(
      require("drizzle-orm").sql`INSERT INTO users (id, email, name) VALUES ('alice', 'alice@test.com', 'Alice'), ('bob', 'bob@test.com', 'Bob')`,
    );
    const testApp = createApp(repo);
    server2 = Bun.serve({
      port: 0,
      fetch: testApp.fetch,
      websocket,
    });
    port2 = server2.port;
  });

  afterAll(() => {
    server2.stop(true);
  });

  test("POST /sessions/:id/join persists participant so GET /sessions returns it", async () => {
    const baseUrl = `http://localhost:${port2}`;

    // 1. Create a session as alice
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Persist Test" }),
    });
    expect(createRes.status).toBe(201);
    const session = (await createRes.json()) as { id: string };

    // 1b. Alice connects via WebSocket (activates the session)
    const aliceWs = new WebSocket(`ws://localhost:${port2}/ws?token=alice&sessionId=${session.id}`);
    await new Promise<void>((resolve) => { aliceWs.onopen = () => resolve() });
    await new Promise((r) => setTimeout(r, 100));

    const joinRes = await fetch(`${baseUrl}/api/sessions/${session.id}/join`, {
      method: "POST",
      headers: { Authorization: "Bearer bob", "Content-Type": "application/json" },
    });
    expect(joinRes.status).toBe(201);

    // 3. Bob's sessions list should include this session
    const listRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: "Bearer bob" },
    });
    expect(listRes.status).toBe(200);
    const sessions = (await listRes.json()) as Array<{ id: string; title: string }>;
    const found = sessions.find((s) => s.id === session.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe("Persist Test");
    aliceWs.close();
  });

  test("POST /sessions/:id/join returns 409 on duplicate", async () => {
    const baseUrl = `http://localhost:${port2}`;

    // Create session as alice
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Duplicate Test" }),
    });
    const session = (await createRes.json()) as { id: string };

    // Alice is already a participant (creator), joining again should 409
    const joinRes = await fetch(`${baseUrl}/api/sessions/${session.id}/join`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
    });
    expect(joinRes.status).toBe(409);
  });

  test("POST /sessions with custom id creates session with that id", async () => {
    const baseUrl = `http://localhost:${port2}`;
    const customId = "custom-session-" + Date.now();

    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Custom ID Test", id: customId }),
    });
    expect(createRes.status).toBe(201);
    const session = (await createRes.json()) as { id: string; title: string };
    expect(session.id).toBe(customId);
    expect(session.title).toBe("Custom ID Test");
  });

  test("POST /sessions with existing id returns existing session (idempotent)", async () => {
    const baseUrl = `http://localhost:${port2}`;
    const customId = "idempotent-session-" + Date.now();

    // Create
    const res1 = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "First Create", id: customId }),
    });
    expect(res1.status).toBe(201);

    // Duplicate create returns existing
    const res2 = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Second Create", id: customId }),
    });
    expect(res2.status).toBe(200);
    const existing = (await res2.json()) as { id: string; title: string };
    expect(existing.id).toBe(customId);
    expect(existing.title).toBe("First Create"); // original title preserved
  });

  test("POST /sessions generates a short code", async () => {
    const baseUrl = `http://localhost:${port2}`;
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Short Code Test" }),
    });
    expect(res.status).toBe(201);
    const session = (await res.json()) as { shortCode: string };
    expect(session.shortCode).toBeDefined();
    expect(session.shortCode).toMatch(/^[A-Z]+-[A-Z]+-\d+$/);
  });

  test("GET /sessions/code/:code resolves to session", async () => {
    const baseUrl = `http://localhost:${port2}`;
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Resolve Test" }),
    });
    const session = (await createRes.json()) as { id: string; shortCode: string };

    const resolveRes = await fetch(`${baseUrl}/api/sessions/code/${session.shortCode}`, {
      headers: { Authorization: "Bearer alice" },
    });
    expect(resolveRes.status).toBe(200);
    const resolved = (await resolveRes.json()) as { id: string };
    expect(resolved.id).toBe(session.id);
  });

  test("GET /sessions/code/:code is case-insensitive", async () => {
    const baseUrl = `http://localhost:${port2}`;
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Case Test" }),
    });
    const session = (await createRes.json()) as { shortCode: string };

    const resolveRes = await fetch(`${baseUrl}/api/sessions/code/${session.shortCode.toLowerCase()}`, {
      headers: { Authorization: "Bearer alice" },
    });
    expect(resolveRes.status).toBe(200);
  });

  test("full /qstart flow: create session + join persists for listing", async () => {
    const baseUrl = `http://localhost:${port2}`;
    const sid = "qstart-flow-" + Date.now();

    // Simulates what the TUI does on auth:ok after /qstart
    // 1. Create session
    await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer charlie", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Qwack Session", id: sid }),
    });

    // 2. Join (registers participant)
    const joinRes = await fetch(`${baseUrl}/api/sessions/${sid}/join`, {
      method: "POST",
      headers: { Authorization: "Bearer charlie", "Content-Type": "application/json" },
    });
    // Creator is already a participant from POST /sessions, so 409 is expected
    expect([201, 409]).toContain(joinRes.status);

    // 3. Session shows up in listing
    const listRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: "Bearer charlie" },
    });
    const sessions = (await listRes.json()) as Array<{ id: string }>;
    expect(sessions.some((s) => s.id === sid)).toBe(true);
  });
});
