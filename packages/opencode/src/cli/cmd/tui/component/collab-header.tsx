import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useQwack } from "../context/qwack"
import { SplitBorder } from "./border"
import { RGBA } from "@opentui/core"
import { AGENT_ACCENT_COLOR } from "@qwack/shared"

const QWACK_ACCENT = RGBA.fromHex(AGENT_ACCENT_COLOR)

// ── Deterministic session name from UUID ──────────────────────────
// All clients compute the same name for the same session ID.
import { qwackSessionName } from "./qwack-session-name"

// ── Component ─────────────────────────────────────────────────────
export function CollabHeader() {
  const { theme } = useTheme()
  const qwack = useQwack()

  const name = createMemo(() => {
    const sid = qwack.sessionId()
    return sid ? qwackSessionName(sid) : "Qwack Session"
  })

  const hostName = createMemo(() => {
    const host = qwack.presence().find((p) => p.role === "host")
    return host?.name ?? null
  })

  const onlineCount = createMemo(() => qwack.onlineCount())

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={QWACK_ACCENT}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} wrapMode="none">
            <span style={{ fg: QWACK_ACCENT, bold: true }}>🦆 {name()}</span>
          </text>
          <box flexDirection="row" gap={2} flexShrink={0}>
            <text fg={theme.textMuted} wrapMode="none">
              {onlineCount()} online
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              Host:{" "}
              <Show when={hostName() !== null} fallback={<span style={{ fg: theme.warning }}>⚠ offline</span>}>
                <span style={{ fg: theme.text }}>{hostName()}</span>
              </Show>
            </text>
            <Show when={qwack.offlineQueueSize() > 0}>
              <text fg="yellow" wrapMode="none">
                ⏳ {qwack.offlineQueueSize()} queued
              </text>
            </Show>
            <Show when={qwack.connectionMessage()}>
              <text fg="yellow" wrapMode="none">
                {qwack.connectionMessage()}
              </text>
            </Show>
          </box>
        </box>
      </box>
    </box>
  )
}