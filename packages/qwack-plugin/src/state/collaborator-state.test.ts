import { describe, it, expect, beforeEach, test } from "bun:test"
import { CollaboratorState } from "./collaborator-state"

describe("CollaboratorState", () => {
  let state: CollaboratorState

  beforeEach(() => {
    state = new CollaboratorState()
  })

  // ── Presence ──────────────────────────────────────

  it("addPresence and getPresenceList return added users", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addPresence({ id: "u2", name: "bob", role: "collaborator" })
    expect(state.getPresenceList()).toEqual([
      { id: "u1", name: "alice", role: "host" },
      { id: "u2", name: "bob", role: "collaborator" },
    ])
  })

  it("removePresence removes a user by id", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addPresence({ id: "u2", name: "bob", role: "collaborator" })
    state.removePresence("u1")
    expect(state.getPresenceList()).toEqual([{ id: "u2", name: "bob", role: "collaborator" }])
  })

  it("removePresence is a no-op for unknown id", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.removePresence("unknown")
    expect(state.getPresenceCount()).toBe(1)
  })

  it("getPresenceCount returns correct count", () => {
    expect(state.getPresenceCount()).toBe(0)
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    expect(state.getPresenceCount()).toBe(1)
    state.addPresence({ id: "u2", name: "bob", role: "collaborator" })
    expect(state.getPresenceCount()).toBe(2)
  })

  it("addPresence overwrites duplicate user id", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addPresence({ id: "u1", name: "alice", role: "collaborator" })
    expect(state.getPresenceCount()).toBe(1)
    expect(state.getPresenceList()[0].role).toBe("collaborator")
  })

  // ── Messages ──────────────────────────────────────

  it("addMessage and getRecentMessages returns messages", () => {
    state.addMessage("alice", "hello")
    state.addMessage("bob", "world")
    const msgs = state.getRecentMessages()
    expect(msgs).toHaveLength(2)
    expect(msgs[0].authorName).toBe("alice")
    expect(msgs[0].content).toBe("hello")
    expect(typeof msgs[0].timestamp).toBe("number")
  })

  it("getRecentMessages respects limit parameter", () => {
    for (let i = 0; i < 5; i++) state.addMessage("user", `msg${i}`)
    const msgs = state.getRecentMessages(3)
    expect(msgs).toHaveLength(3)
    expect(msgs[0].content).toBe("msg2")
    expect(msgs[2].content).toBe("msg4")
  })

  it("getRecentMessages defaults to 10", () => {
    for (let i = 0; i < 15; i++) state.addMessage("user", `msg${i}`)
    expect(state.getRecentMessages()).toHaveLength(10)
    expect(state.getRecentMessages()[0].content).toBe("msg5")
  })

  it("ring buffer drops oldest when exceeding MAX_COLLAB_MESSAGES", () => {
    for (let i = 0; i < 105; i++) state.addMessage("user", `msg${i}`)
    const all = state.getRecentMessages(200)
    expect(all).toHaveLength(100)
    expect(all[0].content).toBe("msg5")
    expect(all[99].content).toBe("msg104")
  })

  // ── Unprocessed messages ──────────────────────────

  it("getUnprocessedMessages returns all messages initially", () => {
    state.addMessage("alice", "one")
    state.addMessage("bob", "two")
    expect(state.getUnprocessedMessages()).toHaveLength(2)
  })

  it("markMessagesProcessed clears unprocessed", () => {
    state.addMessage("alice", "one")
    state.addMessage("bob", "two")
    state.markMessagesProcessed()
    expect(state.getUnprocessedMessages()).toHaveLength(0)
  })

  it("new messages after markMessagesProcessed are unprocessed", () => {
    state.addMessage("alice", "one")
    state.markMessagesProcessed()
    state.addMessage("bob", "two")
    const unprocessed = state.getUnprocessedMessages()
    expect(unprocessed).toHaveLength(1)
    expect(unprocessed[0].content).toBe("two")
  })

  it("ring buffer overflow adjusts processedIndex correctly", () => {
    for (let i = 0; i < 50; i++) state.addMessage("user", `msg${i}`)
    state.markMessagesProcessed()
    // Add 5 more — causes 5 shifts
    for (let i = 50; i < 55; i++) state.addMessage("user", `msg${i}`)
    const unprocessed = state.getUnprocessedMessages()
    expect(unprocessed).toHaveLength(5)
    expect(unprocessed[0].content).toBe("msg50")
  })

  // ── Session metadata ──────────────────────────────

  it("session title defaults to null", () => {
    expect(state.getSessionTitle()).toBeNull()
  })

  it("setSessionTitle / getSessionTitle round-trips", () => {
    state.setSessionTitle("Refactor auth module")
    expect(state.getSessionTitle()).toBe("Refactor auth module")
  })

  // ── formatForSystemPrompt ─────────────────────────

  it("formatForSystemPrompt returns empty string with no collaborators", () => {
    expect(state.formatForSystemPrompt()).toBe("")
  })

  it("formatForSystemPrompt with one collaborator, no messages", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const out = state.formatForSystemPrompt()
    expect(out).toContain("Collaborative Session")
    expect(out).toContain("alice (host)")
    expect(out).toContain("Propose before executing")
    expect(out).not.toContain("Recent Team Discussion")
  })

  it("formatForSystemPrompt with multiple collaborators and messages", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addPresence({ id: "u2", name: "bob", role: "collaborator" })
    state.addMessage("alice", "should we add rate limiting?")
    state.addMessage("bob", "yes, 100 req/min")
    const out = state.formatForSystemPrompt()
    expect(out).toContain("alice (host)")
    expect(out).toContain("bob (collaborator)")
    expect(out).toContain("Recent Team Discussion")
    expect(out).toContain('alice: "should we add rate limiting?"')
    expect(out).toContain('bob: "yes, 100 req/min"')
  })

  it("formatForSystemPrompt includes collaboration rules", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const out = state.formatForSystemPrompt()
    expect(out).toContain("Collaboration Rules")
    expect(out).toContain("Propose before executing")
    expect(out).toContain("Don't silently execute large changes")
    expect(out).toContain("Small, obvious fixes are OK")
  })

  // ── formatForMessageInjection ─────────────────────

  it("formatForMessageInjection returns empty when no unprocessed messages", () => {
    state.addMessage("alice", "old")
    state.markMessagesProcessed()
    expect(state.formatForMessageInjection()).toBe("")
  })

  it("formatForMessageInjection only includes unprocessed messages", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addPresence({ id: "u2", name: "bob", role: "collaborator" })
    state.addMessage("alice", "old msg")
    state.markMessagesProcessed()
    state.addMessage("bob", "new msg")
    const out = state.formatForMessageInjection()
    expect(out).toContain("Your teammates just said some things")
    expect(out).toContain('bob: "new msg"')
    expect(out).not.toContain("old msg")
  })

  it("formatForMessageInjection uses natural prose", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addMessage("alice", "test")
    const out = state.formatForMessageInjection()
    expect(out).toContain("Your teammates just said")
    expect(out).not.toContain("##")
  })

  // ── formatForCompaction ───────────────────────────

  it("formatForCompaction includes session title and all state", () => {
    state.setSessionTitle("Refactor auth module")
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addPresence({ id: "u2", name: "bob", role: "collaborator" })
    state.addMessage("alice", "should we add rate limiting?")
    const out = state.formatForCompaction()
    expect(out).toContain("You're in a Qwack session with")
    expect(out).toContain("alice (host)")
    expect(out).toContain("bob (collaborator)")
    expect(out).toContain("Refactor auth module")
    expect(out).toContain("Recent team discussion")
  })

  it("formatForCompaction shows none when no collaborators", () => {
    const out = state.formatForCompaction()
    expect(out).toContain("You're in a Qwack session with none")
  })

  it("formatForCompaction uses natural prose, not markdown", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    const out = state.formatForCompaction()
    expect(out).not.toContain("##")
  })

  // ── clear ─────────────────────────────────────────

  it("clear resets all state including proposals", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addMessage("alice", "hello")
    state.setSessionTitle("Test Session")
    state.addProposal("p1", "use Postgres", "better scaling")
    state.clear()
    expect(state.getPresenceCount()).toBe(0)
    expect(state.getPresenceList()).toEqual([])
    expect(state.getRecentMessages()).toEqual([])
    expect(state.getUnprocessedMessages()).toEqual([])
    expect(state.getSessionTitle()).toBeNull()
    expect(state.formatForSystemPrompt()).toBe("")
    expect(state.getPendingProposals()).toEqual([])
    expect(state.getUnacknowledgedResolutions()).toEqual([])
  })

  // ── Proposals ──────────────────────────────────────

  it("addProposal creates a pending proposal", () => {
    state.addProposal("p1", "use Postgres", "better scaling")
    const pending = state.getPendingProposals()
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe("p1")
    expect(pending[0].content).toBe("use Postgres")
    expect(pending[0].reason).toBe("better scaling")
    expect(pending[0].status).toBe("pending")
    expect(typeof pending[0].createdAt).toBe("number")
  })

  it("getPendingProposals returns only pending proposals", () => {
    state.addProposal("p1", "use Postgres", "scaling")
    state.addProposal("p2", "add rate limiting", "security")
    state.addProposal("p3", "use Redis", "caching")
    state.resolveProposal("p2", true, "u1", "alice")
    const pending = state.getPendingProposals()
    expect(pending).toHaveLength(2)
    expect(pending.map((p) => p.id)).toEqual(["p1", "p3"])
  })

  it("resolveProposal marks proposal as accepted", () => {
    state.addProposal("p1", "use Postgres", "scaling")
    state.resolveProposal("p1", true, "u1", "alice", "agreed")
    const resolutions = state.getUnacknowledgedResolutions()
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0].status).toBe("accepted")
    expect(resolutions[0].responderId).toBe("u1")
    expect(resolutions[0].responderName).toBe("alice")
    expect(resolutions[0].responseReason).toBe("agreed")
    expect(typeof resolutions[0].resolvedAt).toBe("number")
  })

  it("resolveProposal marks proposal as rejected", () => {
    state.addProposal("p1", "use Postgres", "scaling")
    state.resolveProposal("p1", false, "u2", "bob", "too complex")
    const resolutions = state.getUnacknowledgedResolutions()
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0].status).toBe("rejected")
    expect(resolutions[0].responderName).toBe("bob")
    expect(resolutions[0].responseReason).toBe("too complex")
  })

  it("resolveProposal is a no-op for unknown proposal id", () => {
    state.resolveProposal("unknown", true, "u1", "alice")
    expect(state.getUnacknowledgedResolutions()).toEqual([])
  })

  it("getUnacknowledgedResolutions returns resolved but unacknowledged", () => {
    state.addProposal("p1", "use Postgres", "scaling")
    state.addProposal("p2", "add rate limiting", "security")
    state.resolveProposal("p1", true, "u1", "alice")
    // p2 still pending — should NOT appear in resolutions
    const resolutions = state.getUnacknowledgedResolutions()
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0].id).toBe("p1")
  })

  it("acknowledgeResolutions marks all resolved as acknowledged", () => {
    state.addProposal("p1", "use Postgres", "scaling")
    state.addProposal("p2", "add rate limiting", "security")
    state.resolveProposal("p1", true, "u1", "alice")
    state.resolveProposal("p2", false, "u2", "bob")
    state.acknowledgeResolutions()
    expect(state.getUnacknowledgedResolutions()).toEqual([])
  })

  it("getUnacknowledgedResolutions is empty after acknowledge", () => {
    state.addProposal("p1", "use Postgres", "scaling")
    state.resolveProposal("p1", true, "u1", "alice")
    expect(state.getUnacknowledgedResolutions()).toHaveLength(1)
    state.acknowledgeResolutions()
    expect(state.getUnacknowledgedResolutions()).toHaveLength(0)
    // Adding new resolved proposal after acknowledge shows up
    state.addProposal("p2", "use Redis", "caching")
    state.resolveProposal("p2", true, "u1", "alice")
    expect(state.getUnacknowledgedResolutions()).toHaveLength(1)
  })

  it("formatForSystemPrompt includes pending proposals", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addProposal("p1", "use Postgres", "scaling")
    state.addProposal("p2", "add rate limiting", "security")
    // Resolve p2 so only p1 is pending
    state.resolveProposal("p2", true, "u1", "alice")
    const out = state.formatForSystemPrompt()
    expect(out).toContain("Pending Proposals")
    expect(out).toContain("use Postgres")
    expect(out).not.toContain("add rate limiting")
  })

  it("formatForSystemPrompt omits proposals section when none pending", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addProposal("p1", "use Postgres", "scaling")
    state.resolveProposal("p1", true, "u1", "alice")
    const out = state.formatForSystemPrompt()
    expect(out).not.toContain("Pending proposals")
  })

  it("formatForMessageInjection includes resolved proposals", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addMessage("alice", "test msg")
    state.addProposal("p1", "use Postgres", "scaling")
    state.addProposal("p2", "add caching", "performance")
    state.resolveProposal("p1", true, "u1", "alice", "sounds good")
    state.resolveProposal("p2", false, "u2", "bob")
    const out = state.formatForMessageInjection()
    expect(out).toContain("Team responses to your proposals")
    expect(out).toContain("✅ accepted")
    expect(out).toContain("use Postgres")
    expect(out).toContain("alice: sounds good")
    expect(out).toContain("❌ rejected")
    expect(out).toContain("add caching")
  })

  it("formatForMessageInjection acknowledges resolutions after call", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addProposal("p1", "use Postgres", "scaling")
    state.resolveProposal("p1", true, "u1", "alice")
    state.addMessage("alice", "msg")
    // First call includes resolution
    const out1 = state.formatForMessageInjection()
    expect(out1).toContain("Team responses to your proposals")
    // Mark messages processed so only resolutions matter
    state.markMessagesProcessed()
    // Second call — resolutions already acknowledged, no unprocessed msgs
    const out2 = state.formatForMessageInjection()
    expect(out2).toBe("")
  })

  it("formatForMessageInjection returns content with only resolutions (no unprocessed msgs)", () => {
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.addMessage("alice", "old msg")
    state.markMessagesProcessed()
    state.addProposal("p1", "use Postgres", "scaling")
    state.resolveProposal("p1", true, "u1", "alice")
    const out = state.formatForMessageInjection()
    expect(out).toContain("Team responses to your proposals")
    expect(out).toContain("✅ accepted")
    expect(out).toContain("use Postgres")
    expect(out).not.toContain("old msg")
  })
})

describe("transfer context", () => {
  test("transferContext defaults to null", () => {
    const state = new CollaboratorState()
    expect(state.getTransferContext()).toBeNull()
  })

  test("setTransferContext / getTransferContext round-trips", () => {
    const state = new CollaboratorState()
    state.setTransferContext("## Goal\nBuild auth module")
    expect(state.getTransferContext()).toBe("## Goal\nBuild auth module")
  })

  test("formatForSystemPrompt prepends transfer context when set", () => {
    const state = new CollaboratorState()
    state.addPresence({ id: "u1", name: "alice", role: "host" })
    state.setTransferContext("## Previous Context\nWorking on auth")
    const result = state.formatForSystemPrompt()
    expect(result).toContain("## Previous Context")
    expect(result).toContain("Working on auth")
    expect(result).toContain("alice (host)")
  })

  test("transfer context is cleared after formatForSystemPrompt reads it", () => {
    const state = new CollaboratorState()
    state.setTransferContext("snapshot")
    state.formatForSystemPrompt()
    expect(state.getTransferContext()).toBeNull()
    expect(state.formatForSystemPrompt()).toBe("")
  })

  test("transfer context takes priority over event history", () => {
    const state = new CollaboratorState()
    state.setTransferContext("SNAPSHOT")
    state.setEventHistory("HISTORY")
    const result = state.formatForSystemPrompt()
    expect(result).toContain("SNAPSHOT")
    expect(result).not.toContain("HISTORY")
  })

  test("event history used when no transfer context", () => {
    const state = new CollaboratorState()
    state.addPresence({ id: "u1", name: "bob", role: "host" })
    state.setEventHistory("## History\n[prompt] alice: fix the bug")
    const result = state.formatForSystemPrompt()
    expect(result).toContain("## History")
    expect(result).toContain("bob (host)")
  })

  test("event history cleared after read", () => {
    const state = new CollaboratorState()
    state.setEventHistory("history")
    state.formatForSystemPrompt()
    expect(state.getEventHistory()).toBeNull()
  })

  test("clear resets transferContext and eventHistory", () => {
    const state = new CollaboratorState()
    state.setTransferContext("snapshot")
    state.setEventHistory("history")
    state.clear()
    expect(state.getTransferContext()).toBeNull()
    expect(state.getEventHistory()).toBeNull()
  })
})

describe("formatEventHistoryForPrompt", () => {
  test("formats events as readable text", () => {
    const state = new CollaboratorState()
    const events = [
      { type: "prompt:sent", payload: { authorName: "alice", content: "fix the bug" } },
      { type: "agent:output", payload: { content: "Looking at the code..." } },
      { type: "agent:complete", payload: { messageId: "m1" } },
    ]
    const result = state.formatEventHistoryForPrompt(events)
    expect(result).toContain("[prompt] alice: fix the bug")
    expect(result).toContain("[agent] Looking at the code...")
    expect(result).toContain("[agent response complete]")
  })

  test("caps output at charCap", () => {
    const state = new CollaboratorState()
    const events = Array.from({ length: 100 }, () => ({
      type: "prompt:sent" as const,
      payload: { authorName: "alice", content: "x".repeat(1000) },
    }))
    const result = state.formatEventHistoryForPrompt(events, 5000)
    expect(result.length).toBeLessThanOrEqual(6000)
  })

  test("returns empty string for empty events", () => {
    const state = new CollaboratorState()
    expect(state.formatEventHistoryForPrompt([])).toBe("")
  })

  test("includes collab messages", () => {
    const state = new CollaboratorState()
    const events = [
      { type: "collab:message", payload: { authorName: "bob", content: "add rate limiting?" } },
    ]
    const result = state.formatEventHistoryForPrompt(events)
    expect(result).toContain("[chat] bob: add rate limiting?")
  })
})
