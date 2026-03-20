import { describe, it, expect } from "bun:test"
import {
  QWACK_SYSTEM_PROMPT,
  QWACK_AGENT_DESCRIPTION,
  QWACK_AGENT_COLOR,
  DEFAULT_AGENT_MODEL,
  createQwackAgentConfig,
} from "./agent-config"

describe("QWACK_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof QWACK_SYSTEM_PROMPT).toBe("string")
    expect(QWACK_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })

  it("contains key concepts in natural prose", () => {
    expect(QWACK_SYSTEM_PROMPT).toContain("You're Qwack")
    expect(QWACK_SYSTEM_PROMPT).toContain("peer team member")
    expect(QWACK_SYSTEM_PROMPT).toContain("shared session")
    expect(QWACK_SYSTEM_PROMPT).toContain("host")
  })

  it("mentions qwack_propose and qwack_disagree tools", () => {
    expect(QWACK_SYSTEM_PROMPT).toContain("qwack_propose")
    expect(QWACK_SYSTEM_PROMPT).toContain("qwack_disagree")
  })

  it("explains how to handle collaborator messages", () => {
    expect(QWACK_SYSTEM_PROMPT).toContain("[From")
    expect(QWACK_SYSTEM_PROMPT).toContain("acknowledge them by name")
  })

  it("does not use markdown headers", () => {
    expect(QWACK_SYSTEM_PROMPT).not.toContain("##")
    expect(QWACK_SYSTEM_PROMPT).not.toContain("###")
  })
})

describe("QWACK_AGENT_DESCRIPTION", () => {
  it("is a non-empty string", () => {
    expect(typeof QWACK_AGENT_DESCRIPTION).toBe("string")
    expect(QWACK_AGENT_DESCRIPTION.length).toBeGreaterThan(0)
  })
})

describe("QWACK_AGENT_COLOR", () => {
  it("is #E8A317", () => {
    expect(QWACK_AGENT_COLOR).toBe("#E8A317")
  })
})

describe("DEFAULT_AGENT_MODEL", () => {
  it("is anthropic/claude-opus-4-6", () => {
    expect(DEFAULT_AGENT_MODEL).toBe("anthropic/claude-opus-4-6")
  })
})

describe("createQwackAgentConfig", () => {
  it("returns default model when none provided", () => {
    const config = createQwackAgentConfig()
    expect(config.model).toBe(DEFAULT_AGENT_MODEL)
  })

  it("uses provided model when specified", () => {
    const config = createQwackAgentConfig("anthropic/claude-opus-4-20250514")
    expect(config.model).toBe("anthropic/claude-opus-4-20250514")
  })

  it("sets mode to primary", () => {
    const config = createQwackAgentConfig()
    expect(config.mode).toBe("primary")
  })

  it("uses QWACK_AGENT_COLOR for color", () => {
    const config = createQwackAgentConfig()
    expect(config.color).toBe(QWACK_AGENT_COLOR)
  })

  it("uses QWACK_SYSTEM_PROMPT for prompt", () => {
    const config = createQwackAgentConfig()
    expect(config.prompt).toBe(QWACK_SYSTEM_PROMPT)
  })

  it("uses QWACK_AGENT_DESCRIPTION for description", () => {
    const config = createQwackAgentConfig()
    expect(config.description).toBe(QWACK_AGENT_DESCRIPTION)
  })
})
