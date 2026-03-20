#!/usr/bin/env bun

/**
 * Interactive test client for Qwack — simulates a plugin user.
 *
 * Usage:
 *   bun scripts/test-client.ts alice                 # connect as alice
 *   bun scripts/test-client.ts bob                   # connect as bob
 *   bun scripts/test-client.ts alice localhost:4000   # custom server
 *
 * Once connected to a session, just type normally:
 *   /qwack start Sprint Planning    ← create a session
 *   hello from alice!               ← auto-sent as collab message
 *   /qwack status                   ← check connection
 *   /qwack leave                    ← disconnect
 *
 * Plain text is broadcast to all collaborators (like real OpenCode).
 * Ctrl+C to quit.
 */

import { createInterface } from "node:readline";
import { QwackRouter } from "../packages/plugin/src/commands/router";

const token = process.argv[2];
const serverArg = process.argv[3];

if (!token) {
  console.error("Usage: bun scripts/test-client.ts <token> [host:port]");
  console.error("");
  console.error("  token     User token (e.g. alice, bob — must match seeded users)");
  console.error("  host:port Server address (default: localhost:4000)");
  console.error("");
  console.error("Run 'bun scripts/seed-dev.ts' first to create test users.");
  process.exit(1);
}

const server = serverArg
  ? (serverArg.startsWith("http") ? serverArg : `http://${serverArg}`)
  : "http://localhost:4000";

const router = new QwackRouter({
  config: { server, token },
  injector: (msg) => {
    // Clear the current line, print the injected message, re-show prompt
    process.stdout.write(`\r\x1b[K${msg}\n`);
    rl.prompt(true);
  },
});
router.setUserName(token);

console.log(`\n🦆 Qwack Test Client`);
console.log(`   User:   ${token}`);
console.log(`   Server: ${server}`);
console.log(`   Type normally once connected — messages auto-broadcast.\n`);

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `[${token}] > `,
});

rl.prompt();

rl.on("line", async (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }

  const result = await router.handleInput(trimmed);
  if (result !== null) {
    // /qwack command was handled
    console.log(result);
  } else if (router.getBridge().isActive) {
    // In a session — send as collab message (like real OpenCode prompt capture)
    const sent = await router.handleInput(`/qwack msg ${trimmed}`);
    if (sent) console.log(sent);
  } else {
    console.log(`(not in a session — run /qwack start or /qwack join first)`);
  }
});

rl.on("close", () => {
  if (router.getBridge().isActive) {
    router.handleInput("/qwack leave").then(() => process.exit(0));
  } else {
    process.exit(0);
  }
});

// Graceful shutdown on Ctrl+C
process.on("SIGINT", () => {
  console.log("\n🦆 Disconnecting...");
  rl.close();
});
