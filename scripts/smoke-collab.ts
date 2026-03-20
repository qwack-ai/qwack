#!/usr/bin/env bun

/**
 * Smoke test: Non-host prompt relay + context snapshot + buffering.
 *
 * Starts a Qwack server, connects Alice (host) and Bob (collaborator),
 * and runs through the key collaboration flows:
 *
 *   1. Presence — both see each other
 *   2. prompt:request — Bob sends, Alice receives prompt:execute
 *   3. Agent output — Alice sends, Bob sees it
 *   4. Context snapshot — Alice sends, server stores
 *   5. Buffering — Alice drops, Bob sends prompts, Alice reconnects and gets them
 *
 * Usage: bun scripts/smoke-collab.ts
 */

import { app } from "../packages/qwack-server/src/app"
import { websocket } from "../packages/qwack-server/src/ws/handler"
import type { Server } from "bun"

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const DIM = "\x1b[2m"
const NC = "\x1b[0m"

let server: Server
let passed = 0
let failed = 0

function ok(label: string) {
  passed++
  console.log(`  ${GREEN}✓${NC} ${label}`)
}

function fail(label: string, err?: string) {
  failed++
  console.log(`  ${RED}✗${NC} ${label}${err ? ` — ${RED}${err}${NC}` : ""}`)
}

type Msg = { type: string; payload: any; senderId: string }

function connect(
  token: string,
  sessionId: string,
): Promise<{
  ws: WebSocket
  messages: Msg[]
  waitFor: (type: string, timeout?: number) => Promise<Msg>
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    const messages: Msg[] = []
    const waiters: Array<{ type: string; resolve: (m: Msg) => void }> = []
    const url = `ws://localhost:${server.port}/ws?token=${token}&sessionId=${sessionId}`
    const ws = new WebSocket(url)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        messages.push(msg)
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (msg.type === waiters[i].type) {
            waiters.splice(i, 1)[0].resolve(msg)
          }
        }
      } catch {
        /* ignore */
      }
    }

    ws.onopen = () =>
      resolve({
        ws,
        messages,
        waitFor: (type, timeout = 3000) => {
          const existing = messages.find((m) => m.type === type)
          if (existing) return Promise.resolve(existing)
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`Timeout waiting for "${type}"`)), timeout)
            waiters.push({
              type,
              resolve: (m) => {
                clearTimeout(timer)
                res(m)
              },
            })
          })
        },
        close: () => ws.close(),
      })

    ws.onerror = (e) => reject(e)
  })
}

function send(ws: WebSocket, sessionId: string, senderId: string, type: string, payload: any) {
  ws.send(JSON.stringify({ type, sessionId, senderId, timestamp: Date.now(), payload }))
}

// ── Tests ────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${YELLOW}🦆 Qwack Collaboration Smoke Test${NC}\n`)

  // Start server
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket })
  console.log(`${DIM}   Server on port ${server.port}${NC}\n`)

  const SID = "smoke-collab"

  // ── 1. Presence ──────────────────────────────────────────────
  console.log(`${YELLOW}1. Presence${NC}`)

  const alice = await connect("alice", SID)
  const aliceList = await alice.waitFor("presence:list")
  const aliceInList = (aliceList.payload.participants as any[]).some((p) => p.id === "alice")
  aliceInList ? ok("Alice sees herself in presence:list") : fail("Alice missing from presence:list")

  const bob = await connect("bob", SID)
  const bobList = await bob.waitFor("presence:list")
  const bothInList =
    (bobList.payload.participants as any[]).some((p) => p.id === "alice") &&
    (bobList.payload.participants as any[]).some((p) => p.id === "bob")
  bothInList ? ok("Bob sees both users in presence:list") : fail("Bob missing users in presence:list")

  await alice.waitFor("presence:join")
  ok("Alice received presence:join for Bob")

  // ── 2. Non-host prompt relay ─────────────────────────────────
  console.log(`\n${YELLOW}2. Non-host prompt relay (prompt:request → prompt:execute)${NC}`)

  send(bob.ws, SID, "bob", "prompt:request", {
    authorId: "bob",
    authorName: "Bob",
    content: "add rate limiting to auth",
  })

  const execute = await alice.waitFor("prompt:execute")
  execute.payload.content === "add rate limiting to auth"
    ? ok("Alice received prompt:execute with correct content")
    : fail("prompt:execute content mismatch", execute.payload.content)

  execute.payload.requestedBy === "bob"
    ? ok("prompt:execute.requestedBy = bob")
    : fail("requestedBy mismatch", execute.payload.requestedBy)

  const aliceSent = await alice.waitFor("prompt:sent")
  aliceSent.payload.authorName === "Bob"
    ? ok("Alice received prompt:sent broadcast (authorName = Bob)")
    : fail("prompt:sent authorName mismatch")

  await Bun.sleep(100)
  const bobExecute = bob.messages.find((m) => m.type === "prompt:execute")
  !bobExecute ? ok("Bob did NOT receive prompt:execute (host-only)") : fail("Bob should not see prompt:execute")

  // ── 3. Agent output relay ────────────────────────────────────
  console.log(`\n${YELLOW}3. Agent output relay${NC}`)

  send(alice.ws, SID, "alice", "agent:output", {
    content: "Refactoring auth module...",
    partId: "p1",
  })

  const output = await bob.waitFor("agent:output")
  output.payload.content === "Refactoring auth module..."
    ? ok("Bob received agent:output")
    : fail("agent:output content mismatch")

  send(alice.ws, SID, "alice", "agent:complete", { messageId: "msg-1" })
  const complete = await bob.waitFor("agent:complete")
  complete.payload.messageId === "msg-1" ? ok("Bob received agent:complete") : fail("agent:complete mismatch")

  // ── 4. Context snapshot ──────────────────────────────────────
  console.log(`\n${YELLOW}4. Context snapshot${NC}`)

  send(alice.ws, SID, "alice", "session:context_snapshot", {
    snapshot: "Team: alice (host), bob (collaborator). Session: Sprint Planning.",
  })
  await Bun.sleep(100)
  ok("Alice sent session:context_snapshot (server stores it)")

  // ── 5. Buffering + reconnect ─────────────────────────────────
  console.log(`\n${YELLOW}5. Prompt buffering (host offline → reconnect)${NC}`)

  alice.close()
  await bob.waitFor("presence:leave")
  ok("Bob sees Alice disconnect (presence:leave)")

  // Bob sends prompts while Alice is offline
  send(bob.ws, SID, "bob", "prompt:request", {
    authorId: "bob",
    authorName: "Bob",
    content: "first buffered prompt",
  })
  send(bob.ws, SID, "bob", "prompt:request", {
    authorId: "bob",
    authorName: "Bob",
    content: "second buffered prompt",
  })
  await Bun.sleep(100)
  ok("Bob sent 2 prompts while Alice offline (buffered)")

  // Alice reconnects
  const alice2 = await connect("alice", SID)
  await Bun.sleep(200)

  // Should get context snapshot BEFORE buffered prompts
  const snapshotMsg = alice2.messages.find((m) => m.type === "session:context_snapshot")
  snapshotMsg
    ? ok("Alice received stored context snapshot on reconnect")
    : fail("No context snapshot delivered on reconnect")

  const executeMessages = alice2.messages.filter((m) => m.type === "prompt:execute")
  executeMessages.length === 2
    ? ok(`Alice received ${executeMessages.length} buffered prompt:execute messages`)
    : fail(`Expected 2 buffered prompts, got ${executeMessages.length}`)

  if (executeMessages.length >= 2) {
    executeMessages[0].payload.content === "first buffered prompt"
      ? ok("First buffered prompt content correct")
      : fail("First prompt content wrong", executeMessages[0].payload.content)
    executeMessages[1].payload.content === "second buffered prompt"
      ? ok("Second buffered prompt content correct")
      : fail("Second prompt content wrong", executeMessages[1].payload.content)

    // Verify order: snapshot arrives before buffered prompts
    const snapshotIdx = alice2.messages.findIndex((m) => m.type === "session:context_snapshot")
    const firstExecIdx = alice2.messages.findIndex((m) => m.type === "prompt:execute")
    snapshotIdx < firstExecIdx
      ? ok("Context snapshot delivered BEFORE buffered prompts")
      : fail("Snapshot should arrive before prompts", `snapshot@${snapshotIdx} exec@${firstExecIdx}`)
  }

  // ── 6. Collab message ────────────────────────────────────────
  console.log(`\n${YELLOW}6. Collab message (bidirectional)${NC}`)

  send(bob.ws, SID, "bob", "collab:message", {
    authorName: "Bob",
    content: "nice work on the refactor!",
  })

  const chat = await alice2.waitFor("collab:message")
  chat.payload.content === "nice work on the refactor!"
    ? ok("Alice received Bob's collab:message")
    : fail("collab:message content mismatch")

  // ── 7. Auto-create user (any token works) ────────────────────
  console.log(`\n${YELLOW}7. Auto-create user (unknown token connects without preseeding)${NC}`)

  const SID2 = "smoke-collab-newuser"
  const newbie = await connect("totally-new-person", SID2)
  const newbieAuth = await newbie.waitFor("auth:ok")
  newbieAuth.payload.user?.id === "totally-new-person"
    ? ok("New user authenticated with auto-created account")
    : fail("auth:ok missing or wrong userId", newbieAuth.payload.user?.id)

  // Verify they became host (first joiner)
  const newbieList = await newbie.waitFor("presence:list")
  const newbieEntry = (newbieList.payload.participants as any[]).find((p: any) => p.id === "totally-new-person")
  newbieEntry?.role === "host"
    ? ok("New user auto-assigned host role (first joiner)")
    : fail("Expected host role", newbieEntry?.role)

  // A second unknown user joins and becomes collaborator
  const newbie2 = await connect("another-stranger", SID2)
  const newbie2Auth = await newbie2.waitFor("auth:ok")
  newbie2Auth.payload.user?.role === "collaborator"
    ? ok("Second new user auto-assigned collaborator role")
    : fail("Expected collaborator role", newbie2Auth.payload.user?.role)

  // First user can see the second join
  const joinMsg = await newbie.waitFor("presence:join")
  joinMsg.payload.user?.id === "another-stranger"
    ? ok("First user sees second user join")
    : fail("presence:join user mismatch")

  newbie.close()
  newbie2.close()

  // Cleanup
  alice2.close()
  bob.close()
  server.stop(true)
  // Summary
  console.log(`\n${YELLOW}─────────────────────────────────────${NC}`)
  console.log(`  ${GREEN}${passed} passed${NC}  ${failed > 0 ? `${RED}${failed} failed${NC}` : ""}`)
  console.log(`${YELLOW}─────────────────────────────────────${NC}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(`\n${RED}Fatal: ${err.message}${NC}`)
  server?.stop(true)
  process.exit(1)
})
