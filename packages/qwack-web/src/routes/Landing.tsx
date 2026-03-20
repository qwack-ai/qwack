import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  Show,
  For,
} from "solid-js"
import "../styles/landing.css"

const DUCK = [
  "    __       ",
  "  <(o )___   ",
  "   ( ._> /   ",
  "    `---'    ",
]

const LOGO = [
  "                          ",
  "\u2588\u2580\u2580\u2588 \u2588   \u2588 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2580 \u2588  \u2588",
  "\u2588\u2584\u2584\u2588 \u2588 \u2588 \u2588 \u2588\u2584\u2584\u2588 \u2588\u2584\u2584\u2584 \u2588\u2580\u2580\u2584",
  "\u2580\u2580\u2580\u2588 \u2580\u2580 \u2580\u2580 \u2580  \u2580 \u2580\u2580\u2580\u2580 \u2588  \u2580",
]

type Line =
  | { t: "p"; c: string }
  | { t: "n"; n: number; c: string }
  | { t: "c"; c: string }
  | { t: "b" }
  | { t: "pre"; c: string[] }
  | { t: "bullet"; c: string; em?: string }
  | { t: "video"; c: string }

interface Command {
  cmd: string
  label: string
  desc: string
  prompt: string
  thinking: string
  tool?: string
  href?: string
  lines: Line[]
  time: string
}

const COMMANDS: Command[] = [
  {
    cmd: "install",
    label: "/qwack install",
    desc: "How to install Qwack",
    prompt: "How do I install Qwack?",
    thinking: "Looking up installation methods and platform support...",
    tool: "read_file",
    lines: [
      { t: "p", c: "Install Qwack with a single command:" },
      { t: "b" },
      { t: "n", n: 1, c: "Mac / Linux:" },
      { t: "c", c: "   curl -fsSL https://qwack.ai/install | sh" },
      { t: "b" },
      { t: "n", n: 2, c: "Windows:" },
      { t: "c", c: "   irm https://qwack.ai/install.ps1 | iex" },
      { t: "b" },
      { t: "p", c: "Or download from GitHub Releases:" },
      { t: "c", c: "   github.com/qwack-ai/qwack/releases" },
      { t: "b" },
      { t: "p", c: "Then launch and authenticate:" },
      { t: "c", c: "   qwack" },
      { t: "c", c: "   /qwack login" },
    ],
    time: "2.4s",
  },
  {
    cmd: "privacy",
    label: "/qwack privacy",
    desc: "Privacy & security",
    prompt: "How does Qwack handle privacy and security?",
    thinking: "Reviewing security architecture and data flow...",
    tool: "read_docs",
    lines: [
      {
        t: "p",
        c: "API keys, credentials, and environment variables never leave your machine. Tools execute locally. Output is relayed so collaborators can follow along.",
      },
      { t: "b" },
      { t: "p", c: "What stays on your machine:" },
      { t: "bullet", c: "API keys & credentials", em: "\u274C never sent" },
      { t: "bullet", c: "Environment variables", em: "\u274C never sent" },
      { t: "bullet", c: "Tool execution", em: "\u274C local only" },
      { t: "b" },
      { t: "p", c: "What flows through the relay (TLS protected):" },
      { t: "bullet", c: "Prompt text", em: "(your questions)" },
      { t: "bullet", c: "Agent output", em: "(responses, code snippets)" },
      { t: "bullet", c: "Tool output", em: "(file contents, diffs, shell results)" },
      { t: "bullet", c: "Chat messages", em: "(team comms)" },
      { t: "b" },
      {
        t: "p",
        c: "The server is a relay. No AI compute, no persistent code storage, no analytics.",
      },
    ],
    time: "3.1s",
  },

  {
    cmd: "demo",
    label: "/qwack demo",
    desc: "Watch it in action",
    prompt: "Show me how Qwack works.",
    thinking: "Loading demo...",
    lines: [
      { t: "video", c: "/demo.mp4" },
    ],
    time: "1.2s",
  },
  {
    cmd: "about",
    label: "/qwack about",
    desc: "About Qwack",
    prompt: "Tell me about Qwack.",
    thinking: "Fetching project information...",
    lines: [
      { t: "p", c: "Qwack is a collaborative AI agent steering platform built on OpenCode." },
      { t: "b" },
      { t: "bullet", c: "Real-time collaboration", em: "\u2014 share one AI agent session, same context" },
      { t: "bullet", c: "Credentials stay local", em: "— API keys and secrets never leave the host" },
      { t: "bullet", c: "Built on OpenCode", em: "\u2014 75+ LLM providers, MCP tools, plugins" },
      { t: "bullet", c: "Full view parity", em: "\u2014 collaborators see identical output" },
      { t: "bullet", c: "Auto-failover", em: "\u2014 host disconnects, next person promoted" },
      { t: "bullet", c: "Offline sync", em: "\u2014 events queue and replay on reconnect" },
      { t: "bullet", c: "Short join codes", em: "\u2014 share SWIFT-DUCK-42 instead of UUIDs" },
      { t: "b" },
      { t: "p", c: "MIT licensed (TUI, plugin, SDK). AGPL-3.0 (server)." },
      { t: "c", c: "   github.com/qwack-ai/qwack" },
    ],
    time: "1.4s",
  },
  {
    cmd: "docs",
    label: "/qwack docs",
    desc: "Documentation",
    prompt: "Where can I find the docs?",
    thinking: "Looking up documentation...",
    tool: "read_docs",
    lines: [
      {
        t: "p",
        c: "Full documentation is available at docs.qwack.ai:",
      },
      { t: "b" },
      { t: "bullet", c: "Getting Started", em: "\u2014 install, login, first session" },
      { t: "bullet", c: "Commands Reference", em: "\u2014 every /qwack command" },
      { t: "bullet", c: "Architecture", em: "\u2014 host model, data flow, what stays local" },
      { t: "bullet", c: "Security", em: "— credentials stay local, TLS in transit" },
      { t: "bullet", c: "WebSocket Protocol", em: "\u2014 event types, payloads, integration" },
      { t: "b" },
      { t: "c", c: "   https://docs.qwack.ai" },
    ],
    time: "0.6s",
  },

]

function renderLine(line: Line) {
  switch (line.t) {
    case "p":
      return <span class="resp-text">{line.c}</span>
    case "n":
      return (
        <span class="resp-numbered">
          <span class="resp-num">{line.n}.</span> {line.c}
        </span>
      )
    case "c":
      return <span class="resp-code">{line.c}</span>
    case "b":
      return <div class="resp-blank" />
    case "pre":
      return (
        <pre class="resp-pre">
          <For each={line.c}>{(l) => <div>{l}</div>}</For>
        </pre>
      )
    case "bullet":
      return (
        <span class="resp-bullet">
          <span class="bullet-dot">{"\u2022"}</span> {line.c}
          {line.em && <span class="bullet-em"> {line.em}</span>}
        </span>
      )
    case "video":
      return (
        <video
          src={line.c as string}
          autoplay
          loop
          muted
          playsinline
          class="resp-video"
        />
      )
  }
}

export default function Landing() {
  const [view, setView] = createSignal<"splash" | "session">("splash")
  const [input, setInput] = createSignal("")
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [activeCmd, setActiveCmd] = createSignal<Command | null>(null)
  const [streamPhase, setStreamPhase] = createSignal(-1)
  const [typewriterText, setTypewriterText] = createSignal("")

  let inputRef: HTMLInputElement | undefined
  let contentRef: HTMLDivElement | undefined

  const CYCLE_WORDS = ["install", "demo", "about", "docs", "privacy"]

  onCleanup(() => {})

  {
    let cycleIdx = 0
    let charIdx = 0
    let deleting = false
    let paused = false
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      if (paused) return

      const word = CYCLE_WORDS[cycleIdx]
      if (!deleting) {
        charIdx++
        setTypewriterText(word.slice(0, charIdx))
        if (charIdx >= word.length) {
          paused = true
          setTimeout(() => {
            paused = false
            deleting = true
            schedule()
          }, 2000)
          return
        }
      } else {
        charIdx--
        setTypewriterText(word.slice(0, charIdx))
        if (charIdx <= 0) {
          deleting = false
          cycleIdx = (cycleIdx + 1) % CYCLE_WORDS.length
        }
      }
      schedule()
    }

    const schedule = () => {
      timer = setTimeout(tick, deleting ? 40 : 100)
    }

    schedule()
    onCleanup(() => clearTimeout(timer))
  }

  const filteredCommands = createMemo(() => {
    const val = input().toLowerCase().trim()
    if (!val.startsWith("/")) return []
    if (val === "/") return COMMANDS
    const query = val.replace(/^\/?qwack\s*/i, "")
    if (val.startsWith("/q") && !val.startsWith("/qwack")) {
      return COMMANDS.filter((c) => c.label.toLowerCase().includes(val))
    }
    return COMMANDS.filter(
      (c) => c.cmd.startsWith(query) || c.label.toLowerCase().includes(val),
    )
  })

  const paletteOpen = createMemo(() => filteredCommands().length > 0)

  createEffect(() => {
    filteredCommands()
    setSelectedIdx(0)
  })

  createEffect(() => {
    const cmd = activeCmd()
    if (!cmd || view() !== "session") return

    setStreamPhase(-1)

    const delays: number[] = [
      400,
      ...(cmd.tool ? [600] : []),
      ...cmd.lines.map((_, i) => (i === 0 ? 400 : 60)),
      300,
    ]

    const timers: ReturnType<typeof setTimeout>[] = []
    let cumulative = 0
    delays.forEach((delay, idx) => {
      cumulative += delay
      timers.push(
        setTimeout(() => {
          setStreamPhase(idx)
          if (contentRef) contentRef.scrollTop = contentRef.scrollHeight
        }, cumulative),
      )
    })

    onCleanup(() => timers.forEach(clearTimeout))
  })

  const toolPhaseIdx = createMemo(() => (activeCmd()?.tool ? 1 : -1))
  const lineStartIdx = createMemo(() => (activeCmd()?.tool ? 2 : 1))
  const metaIdx = createMemo(() => {
    const cmd = activeCmd()
    if (!cmd) return 999
    return (cmd.tool ? 2 : 1) + cmd.lines.length
  })

  const selectCommand = (cmd: Command) => {
    if (cmd.href) {
      window.open(cmd.href, "_blank")
      setInput("")
      return
    }
    setActiveCmd(cmd)
    setView("session")
    setInput("")
    setTimeout(() => inputRef?.focus(), 100)
  }

  const goBack = () => {
    setView("splash")
    setActiveCmd(null)
    setStreamPhase(-1)
    setInput("")
    setTimeout(() => inputRef?.focus(), 50)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (view() === "session") {
        goBack()
        return
      }
      if (paletteOpen()) {
        setInput("")
        return
      }
    }

    if (!paletteOpen()) return

    const cmds = filteredCommands()
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, cmds.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const selected = cmds[selectedIdx()]
      if (selected) selectCommand(selected)
    }
  }

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (paletteOpen()) {
      const selected = filteredCommands()[selectedIdx()]
      if (selected) selectCommand(selected)
      return
    }
    const raw = input().trim()
    const cmdStr = raw.replace(/^\/?qwack\s*/i, "").toLowerCase()
    const match = COMMANDS.find((c) => c.cmd === cmdStr)
    if (match) selectCommand(match)
  }

  const PromptBar = () => (
    <div class="prompt-bar">
      <div class="prompt-row">
        <span class="prompt-pipe">{"\u2503"}</span>
        <span class="prompt-fill" />
      </div>
      <div class="prompt-row">
        <span class="prompt-pipe">{"\u2503"}</span>
        <form onSubmit={handleSubmit} class="prompt-form">
          <span class="prompt-prefix">/qwack&nbsp;</span>
          <div class="prompt-input-wrap">
            <input
              ref={inputRef}
              type="text"
              class="prompt-input"
              value={input().replace(/^\/?qwack\s*/i, "")}
              onInput={(e) => setInput("/qwack " + e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              autofocus
            />
            <Show when={!input() || input() === "/qwack "}>
              <span class="prompt-typewriter">{typewriterText()}</span>
            </Show>
          </div>
        </form>
      </div>
      <div class="prompt-row">
        <span class="prompt-pipe">{"\u2503"}</span>
        <span class="prompt-fill" />
      </div>
      <div class="prompt-row">
        <span class="prompt-pipe">{"\u2503"}</span>
        <span class="prompt-model">
          <span class="model-qwack">Qwack</span>
          {"  "}
          <span class="model-name">v0.1.0</span>
        </span>
      </div>
      <div class="prompt-row prompt-bottom-row">
        <span class="prompt-cap">{"\u2579"}</span>
        <span class="prompt-bottom-line">
          {"\u2580".repeat(80)}
        </span>
      </div>
    </div>
  )

  const Palette = () => (
    <Show when={paletteOpen()}>
      <div class="palette">
        <For each={filteredCommands()}>
          {(cmd, i) => (
            <div
              class={`palette-row ${i() === selectedIdx() ? "selected" : ""}`}
              onClick={() => selectCommand(cmd)}
              onMouseEnter={() => setSelectedIdx(i())}
            >
              <span class="palette-pipe">{"\u2503"}</span>
              <span class="palette-cmd">{cmd.label}</span>
              <span class="palette-desc">{cmd.desc}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )

  return (
    <div class="tui" onClick={() => inputRef?.focus()}>
      <Show when={view() === "splash"}>
        <div class="splash">
          <div class="splash-center">
            <div class="logo-block">
              <For each={DUCK}>
                {(line, i) => (
                  <div class="logo-row">
                    <span class="duck-art">{line}</span>
                    <span class="logo-text">{LOGO[i()]}</span>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="splash-bottom">
            <div class="palette-anchor">
              <Palette />
              <PromptBar />
            </div>

            <div class="footer-links">
              <a href="https://docs.qwack.ai" class="footer-link">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 012.5 1h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 019.62 3H13.5A1.5 1.5 0 0115 4.5v1.384l-4.56 2.303a2 2 0 00-1.063 1.456L8.69 13.5H2.5A1.5 1.5 0 011 12V2.5z"/><path d="M15 7.118l-4.56 2.303a.5.5 0 00-.266.364l-.698 3.844A.5.5 0 0010 14h3.5a1.5 1.5 0 001.5-1.5V7.118z"/></svg>
                Docs
              </a>
              <a href="https://github.com/qwack-ai/qwack" class="footer-link">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                GitHub
              </a>
            </div>
          </div>
        </div>
      </Show>

      <Show when={view() === "session"}>
        <div class="session">
          <div class="session-main">
            <div class="session-content" ref={contentRef}>
              <div class="user-prompt">
                <span class="user-prompt-pipe">{"\u2503"}</span>
                <span class="user-prompt-text">{activeCmd()?.prompt}</span>
              </div>

              <Show when={streamPhase() >= 0}>
                <div class="thinking-block">
                  <div class="thinking-label">Thinking:</div>
                  <div class="thinking-text">{activeCmd()?.thinking}</div>
                </div>
              </Show>

              <Show
                when={activeCmd()?.tool && streamPhase() >= toolPhaseIdx()}
              >
                <div class="tool-call">
                  <span class="tool-icon">{"\u2699"}</span>
                  <span class="tool-name">{activeCmd()?.tool}</span>
                </div>
              </Show>

              <div class="response-lines">
                <For each={activeCmd()?.lines || []}>
                  {(line, i) => (
                    <Show when={streamPhase() >= lineStartIdx() + i()}>
                      <div class="response-line">{renderLine(line)}</div>
                    </Show>
                  )}
                </For>
              </div>

              <Show when={streamPhase() >= metaIdx()}>
                <div class="agent-meta">
                  <span class="meta-icon">{"\u25A3"}</span>
                  <span class="meta-name">Qwack</span>
                  <span class="meta-info">
                    {" \u00B7 "}v0.1.0{" \u00B7 "}
                    {activeCmd()?.time}
                  </span>
                </div>
              </Show>

              <div class="back-hint">
                <span class="back-hint-key">esc</span> back
              </div>
            </div>

            <div class="session-prompt">
              <div class="palette-anchor">
                <Palette />
                <PromptBar />
              </div>
            </div>
          </div>

          <div class="session-sidebar">
<div class="sidebar-sections">
<div class="sidebar-section">
<div class="sidebar-heading">About</div>
<div class="sidebar-value">Collaborative AI coding</div>
<div class="sidebar-value">Built on OpenCode</div>
</div>
<div class="sidebar-section">
<div class="sidebar-heading">Security</div>
<div class="sidebar-value">Credentials stay local</div>
<div class="sidebar-value">TLS in transit</div>
<div class="sidebar-value">Server is a relay only</div>
</div>
<div class="sidebar-section">
<div class="sidebar-heading">License</div>
<div class="sidebar-value">MIT (TUI, plugin, SDK)</div>
<div class="sidebar-value">AGPL-3.0 (server)</div>
</div>
<div class="sidebar-section">
<div class="sidebar-heading">Links</div>
<div class="sidebar-value">
  <a href="https://docs.qwack.ai" class="sidebar-link footer-link">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 012.5 1h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 019.62 3H13.5A1.5 1.5 0 0115 4.5v1.384l-4.56 2.303a2 2 0 00-1.063 1.456L8.69 13.5H2.5A1.5 1.5 0 011 12V2.5z"/><path d="M15 7.118l-4.56 2.303a.5.5 0 00-.266.364l-.698 3.844A.5.5 0 0010 14h3.5a1.5 1.5 0 001.5-1.5V7.118z"/></svg>
    Docs
  </a>
</div>
<div class="sidebar-value">
  <a href="https://github.com/qwack-ai/qwack" class="sidebar-link footer-link">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
    GitHub
  </a>
</div>
<div class="sidebar-value">
  <a href="/terms" class="sidebar-link footer-link">Terms</a>
</div>
<div class="sidebar-value">
  <a href="/privacy" class="sidebar-link footer-link">Privacy</a>
</div>
</div>
</div>
<div class="sidebar-footer">
<span class="sidebar-duck">{"\uD83E\uDD86"}</span>
<span class="sidebar-qwack">Qwack</span>
<span class="sidebar-local">v0.1.0</span>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
