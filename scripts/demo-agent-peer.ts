#!/usr/bin/env bun

/**
 * Demo: Agent-as-Peer — Full Feature Demo
 *
 * Tests awareness hooks (system prompt, message inject, compaction)
 * AND Option C agent features (tools, agent config, proposal lifecycle).
 *
 * Prerequisites:
 *   1. bun scripts/seed-dev.ts         # create test users
 *   2. bun run dev:server              # start server on :4000
 *
 * Usage:
 *   bun scripts/demo-agent-peer.ts
 *   bun scripts/demo-agent-peer.ts localhost:4000   # custom server
 */

import { CollaboratorState } from "../packages/plugin/src/state/collaborator-state";
import { createSystemInjectHook } from "../packages/plugin/src/hooks/system-inject";
import { createMessageInjectHook } from "../packages/plugin/src/hooks/message-inject";
import { createCompactionInjectHook } from "../packages/plugin/src/hooks/compaction-inject";
import { createQwackAgentConfig } from "../packages/plugin/src/agent/agent-config";
import { createBridgeTools, type SessionAccessor } from "../packages/plugin/src/agent/bridge-tools";
import { QWACK_SYSTEM_PROMPT, DEFAULT_AGENT_MODEL } from "../packages/plugin/src/agent/system-prompt";
import type { WsMessage } from "@qwack/shared";

const serverArg = process.argv[2];
const baseUrl = serverArg
  ? (serverArg.startsWith("http") ? serverArg : `http://${serverArg}`)
  : "http://localhost:4000";

// ── Helpers ──────────────────────────────────────────────────────

function wsUrl(token: string, sessionId: string): string {
  const ws = baseUrl.replace(/^http/, "ws");
  return `${ws}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
}

function connectUser(token: string, sessionId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(token, sessionId));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`WS connect failed for ${token}`));
  });
}

function send(ws: WebSocket, type: string, sessionId: string, senderId: string, payload: unknown) {
  ws.send(JSON.stringify({ type, sessionId, senderId, timestamp: Date.now(), payload }));
}

function waitForEvent(ws: WebSocket, eventType: string, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventType}`)), timeoutMs);
    const handler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as WsMessage;
      if (msg.type === eventType) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        resolve(msg.payload);
      }
    };
    ws.addEventListener("message", handler);
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function banner(title: string) {
  const line = "═".repeat(60);
  console.log(`\n\x1b[36m╔${line}╗`);
  console.log(`║ ${title.padEnd(58)} ║`);
  console.log(`╚${line}╝\x1b[0m`);
}

function section(title: string) {
  console.log(`\n\x1b[33m── ${title} ${"─".repeat(56 - title.length)}\x1b[0m\n`);
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  banner("🦆 Agent-as-Peer Full Demo (Option C: Dedicated Qwack Agent)");
  console.log(`Server: ${baseUrl}`);

  // 1. Create a session via API
  section("Step 1: Create session");
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer alice" },
    body: JSON.stringify({ title: "Refactor auth module" }),
  });
  if (!res.ok) {
    console.error(`Failed to create session: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const session = (await res.json()) as { id: string; title: string };
  console.log(`Created session: "${session.title}" (${session.id})`);

  // 2. Connect alice and bob via WS
  section("Step 2: Connect users");
  const aliceWs = await connectUser("alice", session.id);
  console.log("✅ Alice connected (driver)");
  await sleep(200);
  const bobWs = await connectUser("bob", session.id);
  console.log("✅ Bob connected (collaborator)");
  await sleep(500);

  // 3. Build CollaboratorState from events (simulating what bridge.ts does)
  section("Step 3: Populate state (simulating bridge WS listeners)");
  const state = new CollaboratorState();

  // Simulate presence:join events that the bridge would receive
  state.addPresence({ id: "alice", name: "Alice", role: "driver" });
  state.addPresence({ id: "bob", name: "Bob", role: "collaborator" });
  state.setSessionTitle(session.title);
  console.log(`Presence: ${state.getPresenceCount()} users online`);

  // 4. Exchange collab messages
  section("Step 4: Exchange messages");
  const messages = [
    { from: "alice", ws: aliceWs, text: "should we add rate limiting to the refresh endpoint?" },
    { from: "bob", ws: bobWs, text: "yes, 100 req/min per user sounds right" },
    { from: "alice", ws: aliceWs, text: "agreed — let's also add token rotation" },
  ];

  for (const msg of messages) {
    send(msg.ws, "collab:message", session.id, msg.from, {
      authorName: msg.from === "alice" ? "Alice" : "Bob",
      content: msg.text,
    });
    // Feed into state (simulating what bridge.ts does on collab:message)
    state.addMessage(
      msg.from === "alice" ? "Alice" : "Bob",
      msg.text,
    );
    console.log(`  👤 ${msg.from === "alice" ? "Alice" : "Bob"}: ${msg.text}`);
    await sleep(200);
  }

  // 5. Show hook outputs
  banner("Hook Output: experimental.chat.system.transform");
  console.log("This gets pushed into the system prompt array before every LLM call:\n");
  const systemHook = createSystemInjectHook(state);
  const systemOutput = { system: [] as string[] };
  await systemHook(
    { sessionID: session.id, model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" } },
    systemOutput,
  );
  if (systemOutput.system.length > 0) {
    console.log("\x1b[32m" + systemOutput.system[0] + "\x1b[0m");
  } else {
    console.log("(empty — no context to inject)");
  }

  banner("Hook Output: chat.message (synthetic part)");
  console.log("This gets injected as a synthetic text part on the next user message:\n");
  const messageHook = createMessageInjectHook(state);
  const msgOutput = {
    message: { id: "msg-demo", role: "user" as const, sessionID: session.id },
    parts: [] as Array<Record<string, unknown>>,
  };
  await messageHook(
    { sessionID: session.id, agent: "default", messageID: "msg-demo" },
    msgOutput,
  );
  if (msgOutput.parts.length > 0) {
    const part = msgOutput.parts[0];
    console.log(`\x1b[32mPart ID:    ${part.id}`);
    console.log(`Type:       ${part.type}`);
    console.log(`Synthetic:  ${part.synthetic}`);
    console.log(`Text:\n${part.text}\x1b[0m`);
  } else {
    console.log("(empty — no unprocessed messages)");
  }

  banner("Hook Output: chat.message (2nd call — after markProcessed)");
  console.log("Second call should be empty (messages already processed):\n");
  const msgOutput2 = {
    message: { id: "msg-demo-2", role: "user" as const, sessionID: session.id },
    parts: [] as Array<Record<string, unknown>>,
  };
  await messageHook(
    { sessionID: session.id, agent: "default", messageID: "msg-demo-2" },
    msgOutput2,
  );
  console.log(msgOutput2.parts.length === 0
    ? "\x1b[32m✅ Correctly empty — no double injection\x1b[0m"
    : "\x1b[31m❌ Unexpected: parts were injected again\x1b[0m");

  banner("Hook Output: experimental.session.compacting");
  console.log("This persists team state when the context window resets:\n");
  const compactionHook = createCompactionInjectHook(state);
  const compactOutput = { context: [] as string[] };
  await compactionHook({ sessionID: session.id }, compactOutput);
  if (compactOutput.context.length > 0) {
    console.log("\x1b[32m" + compactOutput.context[0] + "\x1b[0m");
  } else {
    console.log("(empty)");
  }

  // ── OPTION C: Agent Features ────────────────────────────────────

  banner("Agent Config: createQwackAgentConfig()");
  console.log("This is injected into OpenCode config via the config hook:\n");
  const agentConfig = createQwackAgentConfig();
  console.log(`\x1b[32m  Name:        qwack`);
  console.log(`  Model:       ${agentConfig.model}`);
  console.log(`  Mode:        ${agentConfig.mode}`);
  console.log(`  Color:       ${agentConfig.color}`);
  console.log(`  Description: ${agentConfig.description}`);
  console.log(`  Prompt:      ${agentConfig.prompt.slice(0, 80)}...\x1b[0m`);

  const customConfig = createQwackAgentConfig("openai/gpt-4o");
  console.log(`\n  Custom model override: ${customConfig.model}`);

  banner("Agent Tools: qwack_propose + qwack_disagree");
  console.log("These are registered via Hooks.tool at plugin load:\n");

  // Build a SessionAccessor backed by our live state + a WS collector
  const wsSent: any[] = [];
  const accessor: SessionAccessor = {
    isActive: true,
    getWsClient: () => ({ send: (msg: any) => wsSent.push(msg) }),
    getCollaboratorState: () => state,
    getSessionId: () => session.id,
  };
  const tools = createBridgeTools(accessor);

  section("qwack_propose");
  const proposeResult = await tools.qwack_propose.execute(
    { proposal: "Refactor JWT into shared util", rationale: "3 modules duplicate token logic" },
    {} as any,
  );
  console.log(`  Tool returned: \x1b[32m${proposeResult}\x1b[0m`);
  console.log(`  WS event sent: \x1b[33m${JSON.stringify(wsSent[wsSent.length - 1], null, 2)}\x1b[0m`);
  console.log(`  Pending proposals: ${state.getPendingProposals().length}`);

  section("qwack_disagree (minor)");
  const disagreeMinor = await tools.qwack_disagree.execute(
    { concern: "localStorage for tokens is insecure", severity: "minor", suggestion: "Use httpOnly cookies" },
    {} as any,
  );
  console.log(`  Tool returned: \x1b[32m${disagreeMinor}\x1b[0m`);

  section("qwack_disagree (major)");
  const disagreeMajor = await tools.qwack_disagree.execute(
    { concern: "No rate limiting on auth endpoints", severity: "major" },
    {} as any,
  );
  console.log(`  Tool returned: \x1b[33m${disagreeMajor}\x1b[0m`);

  section("Proposal response → system prompt update");
  const pending = state.getPendingProposals();
  if (pending.length > 0) {
    state.resolveProposal(pending[0].id, true, "bob", "Bob", "Sounds good, go for it");
    console.log(`  ✅ Bob accepted proposal: "${pending[0].content}"`);
    const injected = state.formatForMessageInjection();
    console.log(`  Message injection now shows:\n\x1b[32m${injected}\x1b[0m`);
  }

  section("Tools when no session (safety check)");
  const inactiveAccessor: SessionAccessor = {
    isActive: false,
    getWsClient: () => null,
    getCollaboratorState: () => null,
    getSessionId: () => null,
  };
  const inactiveTools = createBridgeTools(inactiveAccessor);
  const noSession = await inactiveTools.qwack_propose.execute(
    { proposal: "test", rationale: "test" },
    {} as any,
  );
  console.log(`  Result: \x1b[32m${noSession}\x1b[0m`);

  // Cleanup
  section("Cleanup");
  aliceWs.close();
  bobWs.close();
  console.log("Disconnected both users.");

  // Summary
  banner("Summary");
  console.log("Agent-as-Peer (Option C: Dedicated Qwack Agent):");
  console.log("");
  console.log("  AWARENESS LAYER (hooks):");
  console.log("    1. \x1b[36msystem prompt\x1b[0m  → collaborator list + messages + pending proposals");
  console.log("    2. \x1b[36muser message\x1b[0m   → unprocessed team messages as synthetic part");
  console.log("    3. \x1b[36mcompaction\x1b[0m     → team state persists across context resets");
  console.log("");
  console.log("  INTERACTION LAYER (agent + tools):");
  console.log("    4. \x1b[36magent config\x1b[0m   → Qwack registered as primary agent in OpenCode");
  console.log("    5. \x1b[36mqwack_propose\x1b[0m  → propose changes, team accepts/rejects");
  console.log("    6. \x1b[36mqwack_disagree\x1b[0m → flag concerns (minor/major)");
  console.log("");
  console.log(`  Default model: ${DEFAULT_AGENT_MODEL}`);
  console.log("  WS events sent: " + wsSent.length);
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error("\n\x1b[31mError:\x1b[0m", err.message);
  console.error("\nMake sure the server is running: bun run dev:server");
  console.error("And users are seeded: bun scripts/seed-dev.ts");
  process.exit(1);
});
