import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { SplitBorder } from "./border"
import { RGBA } from "@opentui/core"
import { AGENT_ACCENT_COLOR, AGENT_DISPLAY_NAME } from "@qwack/shared"

const QWACK_ACCENT = RGBA.fromHex(AGENT_ACCENT_COLOR)

export interface CollabMessageProps {
  authorName: string
  content: string
  timestamp: number
  streaming?: boolean
  thinking?: boolean
  toolEvent?: {
    tool: string
    status: "running" | "completed" | "error"
    input?: string
    output?: string
    error?: string
    partId: string
  }
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
  return `${Math.floor(diff / 86400)} days ago`
}

export function CollabMessage(props: CollabMessageProps) {
  const { theme } = useTheme()
  const timeAgo = createMemo(() => relativeTime(props.timestamp))
  const isAgent = createMemo(() => props.authorName.startsWith(AGENT_DISPLAY_NAME))
  const accent = createMemo(() => {
    if (props.toolEvent) {
      if (props.toolEvent.status === "running") return RGBA.fromHex("#e8a317")
      if (props.toolEvent.status === "completed") return RGBA.fromHex("#50c878")
      if (props.toolEvent.status === "error") return RGBA.fromHex("#e84040")
    }
    if (isAgent()) return QWACK_ACCENT
    if (props.thinking) return theme.textMuted
    return theme.text
  })
  const DUCK = "●▸"
  const DUCK_THINKING = "◉▸"
  const prefix = createMemo(() => isAgent() ? (props.thinking ? DUCK_THINKING : DUCK) : props.thinking ? "\u{1F4AD}" : "\u{1F464}")

  return (
    <box
      marginTop={1}
      flexShrink={0}
      border={["left"]}
      borderColor={accent()}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box paddingTop={1} paddingBottom={1} paddingLeft={2}>
        <text fg={props.thinking ? theme.textMuted : theme.text} wrapMode="word">
          <span style={{ fg: accent() }}>
            <b>{prefix()} {props.authorName}</b>
          </span>
          : {props.content}
          <Show when={props.streaming}>
            <span style={{ fg: theme.textMuted }}>{props.toolEvent ? " ⏳" : " ▍"}</span>
          </Show>
        </text>
        <text fg={theme.textMuted}>
          {props.streaming ? "streaming..." : timeAgo()}
        </text>
      </box>
    </box>
  )
}
