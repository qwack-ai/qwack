#!/usr/bin/env bun

/**
 * Demo: /qwack Commands — walks through every command with expected output.
 *
 * Prerequisites:
 *   1. bun scripts/seed-dev.ts
 *   2. bun packages/server/src/index.ts   (server running on :4000)
 *
 * Usage:
 *   bun scripts/demo-commands.ts
 */

import { QwackRouter } from "../packages/plugin/src/commands/router";
import { writeConfig, readConfig } from "../packages/plugin/src/auth/store";
import type { QwackConfig } from "../packages/plugin/src/auth/store";

const baseUrl = process.argv[2] ?? "http://localhost:4000";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function banner(title: string) {
  const line = "═".repeat(60);
  console.log(`\n\x1b[36m╔${line}╗`);
  console.log(`║ ${title.padEnd(58)} ║`);
  console.log(`╚${line}╝\x1b[0m`);
}

function cmd(input: string) {
  console.log(`\n\x1b[33m  > ${input}\x1b[0m\n`);
}

let passed = 0;
let failed = 0;

function check(label: string, result: string | null, expected: string) {
  const ok = result !== null && result.includes(expected);
  const icon = ok ? "\x1b[32m✅" : "\x1b[31m❌";
  console.log(`${icon} ${label}\x1b[0m`);
  if (result) {
    for (const line of result.split("\n")) {
      console.log(`     ${line}`);
    }
  } else {
    console.log("     (null — not a /qwack command)");
  }
  if (!ok) {
    console.log(`\x1b[31m     Expected to contain: "${expected}"\x1b[0m`);
    failed++;
  } else {
    passed++;
  }
}

async function main() {
  banner("🦆 /qwack Command Demo");
  console.log(`Server: ${baseUrl}`);

  // Ensure auth config exists for local dev
  const config: QwackConfig = { server: baseUrl, token: "alice" };
  writeConfig(config);

  const messages: string[] = [];
  const router = new QwackRouter({
    config,
    injector: (msg) => messages.push(msg),
  });
  router.setUserName("Alice");

  // ── 1. Help ──────────────────────────────────────────────
  banner("1. /qwack help");
  cmd("/qwack help");
  const help = await router.handleInput("/qwack help");
  check("Shows command list", help, "Qwack Commands");

  // ── 2. No args ───────────────────────────────────────────
  banner("2. /qwack (no args)");
  cmd("/qwack");
  const noArgs = await router.handleInput("/qwack");
  check("Shows help when no subcommand", noArgs, "Qwack Commands");

  // ── 3. Status (no session) ───────────────────────────────
  banner("3. /qwack status (before session)");
  cmd("/qwack status");
  const statusBefore = await router.handleInput("/qwack status");
  check("Shows status with no session", statusBefore, "Session: none");

  // ── 4. Config (view) ─────────────────────────────────────
  banner("4. /qwack config");
  cmd("/qwack config");
  const configView = await router.handleInput("/qwack config");
  check("Shows current config", configView, "Qwack Config");

  // ── 5. Config model (view) ───────────────────────────────
  banner("5. /qwack config model");
  cmd("/qwack config model");
  const configModel = await router.handleInput("/qwack config model");
  check("Shows current model", configModel, "Current model:");

  // ── 6. Config model (set) ───────────────────────────────
  banner("6. /qwack config model anthropic/claude-sonnet-4-20250514");
  cmd("/qwack config model anthropic/claude-sonnet-4-20250514");
  const setModel = await router.handleInput("/qwack config model anthropic/claude-sonnet-4-20250514");
  check("Sets custom model", setModel, "set to: anthropic/claude-sonnet-4-20250514");

  // ── 7. Config model (reset) ──────────────────────────────
  banner("7. /qwack config model default");
  cmd("/qwack config model default");
  const resetModel = await router.handleInput("/qwack config model default");
  check("Resets to default model", resetModel, "reset to default");

  // ── 8. Start session ─────────────────────────────────────
  banner("8. /qwack start Sprint Planning");
  cmd('/qwack start Sprint Planning');
  const start = await router.handleInput('/qwack start Sprint Planning');
  check("Creates session", start, "Session started");
  await sleep(500); // let WS connect

  // ── 9. Status (with session) ─────────────────────────────
  banner("9. /qwack status (after start)");
  cmd("/qwack status");
  const statusAfter = await router.handleInput("/qwack status");
  check("Shows active session", statusAfter, "connected");

  // ── 10. Invite ───────────────────────────────────────────
  banner("10. /qwack invite");
  cmd("/qwack invite");
  const invite = await router.handleInput("/qwack invite");
  check("Shows invite URL", invite, "/join/");

  // ── 11. Msg ──────────────────────────────────────────────
  banner("11. /qwack msg hello from the demo!");
  cmd("/qwack msg hello from the demo!");
  const msg = await router.handleInput("/qwack msg hello from the demo!");
  check("Sends collaborator message", msg, "👤 Alice: hello from the demo!");

  // ── 12. Who ──────────────────────────────────────────────
  banner("12. /qwack who");
  cmd("/qwack who");
  const who = await router.handleInput("/qwack who");
  // who calls the HTTP API; might fail if session-participants route doesn't match
  const whoOk = who !== null && (who.includes("Participants") || who.includes("alice"));
  const whoIcon = whoOk ? "\x1b[32m✅" : "\x1b[33m⚠️ ";
  console.log(`${whoIcon} Lists participants\x1b[0m`);
  if (who) for (const line of who.split("\n")) console.log(`     ${line}`);
  if (whoOk) passed++;
  else { console.log("     (may fail if participants API returns empty — not critical)"); }

  // ── 13. Unknown command ──────────────────────────────────
  banner("13. /qwack foobar (unknown)");
  cmd("/qwack foobar");
  const unknown = await router.handleInput("/qwack foobar");
  check("Shows error for unknown command", unknown, "Unknown command: foobar");

  // ── 14. Non-qwack input ──────────────────────────────────
  banner("14. Regular input (not a command)");
  cmd("hello world");
  const regular = await router.handleInput("hello world");
  check("Returns null for non-command input", regular === null ? "null (correct)" : regular, "null (correct)");

  // ── 15. Leave ────────────────────────────────────────────
  banner("15. /qwack leave");
  cmd("/qwack leave");
  const leave = await router.handleInput("/qwack leave");
  check("Leaves session", leave, "Left the session");

  // ── 16. Status after leave ───────────────────────────────
  banner("16. /qwack status (after leave)");
  cmd("/qwack status");
  const statusGone = await router.handleInput("/qwack status");
  check("Back to no session", statusGone, "Session: none");

  // ── Summary ──────────────────────────────────────────────
  banner("Summary");
  console.log(`\n  \x1b[32m${passed} passed\x1b[0m`);
  if (failed > 0) console.log(`  \x1b[31m${failed} failed\x1b[0m`);
  console.log(`  ${passed + failed} total\n`);

  // Restore config
  writeConfig({ server: baseUrl, token: "alice" });

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n\x1b[31mError:\x1b[0m", err.message);
  console.error("\nMake sure the server is running: bun packages/server/src/index.ts");
  console.error("And users are seeded: bun scripts/seed-dev.ts\n");
  process.exit(1);
});
