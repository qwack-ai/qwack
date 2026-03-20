import { createSignal, createMemo, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import type { QwackSessionListItem } from "@qwack/shared"

export interface SessionListProps {
  sessions: QwackSessionListItem[]
  activeSessionId: string | null
  onlineCount: number
  focused: () => boolean
  onSelect: (sessionId: string) => void
  onStartNew: () => void
  onJoinSession: () => void
  onToggleFocus: () => void
  onDelete?: (sessionId: string) => void
}

function timeAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function SessionList(props: SessionListProps) {
  const { theme } = useTheme()
  const [sel, setSel] = createSignal(0)
  const total = createMemo(() => props.sessions.length + 2)

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      props.onToggleFocus()
      return
    }
    if (!props.focused()) return
    if (evt.name === "up") setSel((i) => Math.max(0, i - 1))
    else if (evt.name === "down") setSel((i) => Math.min(total() - 1, i + 1))
    else if (evt.name === "return") {
      const i = sel()
      if (i < props.sessions.length) props.onSelect(props.sessions[i].id)
      else if (i === props.sessions.length) props.onStartNew()
      else props.onJoinSession()
    }
    else if (evt.name === "d" && props.onDelete) {
      const i = sel()
      if (i < props.sessions.length) props.onDelete(props.sessions[i].id)
    }
  })

  return (
    <box width="100%" maxWidth={75} paddingTop={1}>
      <text fg={theme.textMuted}>
        <b>Recent Sessions</b>
        <span style={{ fg: theme.textMuted }}>
          {props.focused() ? "  ↑↓ navigate  enter select  esc → prompt" : "  esc → sessions"}
        </span>
      </text>
      <Show when={props.sessions.length > 0} fallback={<text fg={theme.textMuted}> No recent sessions</text>}>
        <For each={props.sessions}>
          {(session, index) => {
            const active = () => session.id === props.activeSessionId
            const selected = () => props.focused() && sel() === index()
            const title = () => (session.title.length > 38 ? session.title.slice(0, 35) + "…" : session.title)
            return (
              <box flexDirection="row" gap={1} onMouseDown={() => props.onSelect(session.id)}>
                <text fg={selected() ? theme.text : theme.textMuted}>{selected() ? "▸" : " "}</text>
                <text fg={selected() ? theme.text : theme.textMuted}>{title()}</text>
                <box flexGrow={1} />
                <text fg={active() ? theme.success : theme.textMuted}>{active() ? "●" : "○"}</text>
                <Show when={session.hasActiveHost}>
                  <text fg={theme.success}> 🎯</text>
                </Show>
                <text fg={theme.textMuted}> {session.participantCount}p</text>
                <text fg={theme.textMuted}> {timeAgo(session.updatedAt)}</text>
              </box>
            )
          }}
        </For>
      </Show>
      <box height={1} />
      <box flexDirection="row" gap={1} onMouseDown={() => props.onStartNew()}>
        <text fg={props.focused() && sel() === props.sessions.length ? theme.text : theme.textMuted}>
          {props.focused() && sel() === props.sessions.length ? "▸" : " "} + Start new session
        </text>
      </box>
      <box flexDirection="row" gap={1} onMouseDown={() => props.onJoinSession()}>
        <text fg={props.focused() && sel() === props.sessions.length + 1 ? theme.text : theme.textMuted}>
          {props.focused() && sel() === props.sessions.length + 1 ? "▸" : " "} + Join session
        </text>
      </box>
    </box>
  )
}
