import { createSignal, For, Show } from "solid-js"
import { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useQwack } from "../context/qwack"
import { AGENT_ACCENT_COLOR } from "@qwack/shared"

const QWACK_ACCENT = RGBA.fromHex(AGENT_ACCENT_COLOR)

export function PresencePanel() {
  const { theme } = useTheme()
  const qwack = useQwack()
  const [expanded, setExpanded] = createSignal(true)

  return (
    <Show when={qwack.status() !== "disconnected"}>
      <box>
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => setExpanded(!expanded())}
        >
          <text fg={theme.text}>{expanded() ? "▼" : "▶"}</text>
          <text fg={theme.text}>
            <b>🦆 Qwack</b>
            <Show when={!expanded()}>
              <span style={{ fg: theme.textMuted }}>
                {" "}
                ({qwack.onlineCount()} online)
              </span>
            </Show>
          </text>
        </box>
        <Show when={expanded()}>
          <Show when={qwack.sessionId()}>
            <text fg={theme.textMuted}>Session: {qwack.sessionId()!.slice(0, 8)}</text>
          </Show>
          <For each={qwack.presence()}>
            {(entry) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg:
                      entry.role === "host"
                        ? theme.success
                        : entry.role === "agent"
                          ? QWACK_ACCENT
                          : theme.text,
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  {entry.name}{" "}
                  <span style={{ fg: theme.textMuted }}>({entry.role})</span>
                </text>
              </box>
            )}
          </For>
          <Show when={!qwack.presence().some((p: any) => p.role === "host")}>
            <box flexDirection="row" gap={1}>
              <text style={{ fg: theme.warning }}>⚠ Host offline</text>
            </box>
          </Show>
          <text fg={theme.textMuted}>
            <span
              style={{
                fg: qwack.status() === "connected" ? theme.success : theme.warning,
              }}
            >
              ●
            </span>{" "}
            {qwack.status() === "connected" ? `${qwack.onlineCount()} online` : "connecting…"}
          </text>
        </Show>
      </box>
    </Show>
  )
}
