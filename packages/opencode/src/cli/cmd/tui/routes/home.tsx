import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, createSignal, Match, on, onMount, Show, Switch } from "solid-js"
import type { QwackSessionListItem } from "@qwack/shared"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { Logo } from "../component/logo"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useLocal } from "../context/local"
import { useQwack } from "@tui/context/qwack"
import { useSDK } from "@tui/context/sdk"
import { SessionList } from "../component/session-list"
import { useDialog } from "../ui/dialog"
import { DialogQwackInvite, DialogQwackJoin } from "../ui/dialog-qwack-invite"
import { getLocalSessionForQwack, setLocalSessionForQwack } from "@tui/context/qwack-types"

let once = false

export function Home() {
  const sdk = useSDK()
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const routeCtx = useRoute()
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const qwack = useQwack()
  const dialog = useDialog()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })
  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })
  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const showTips = createMemo(() => {
    // Don't show tips for first-time users
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })
  const [qwackSessions, setQwackSessions] = createSignal<QwackSessionListItem[]>([])
  createEffect(on(() => qwack.hasToken(), async (hasToken) => {
    if (hasToken) {
      const sessions = await qwack.fetchSessions()
      setQwackSessions(sessions)
      prompt.set({ input: "", parts: [] })
    }
  }, { defer: true }))
  // Focus management: Escape toggles between session list and prompt.
  // Start with prompt focused (matches solo behavior). Escape switches to list,
  // which calls prompt.blur() so the textarea stops intercepting arrow keys.
  // Tab is reserved for agent_cycle (OpenCode default keybind).
  const [listFocused, setListFocused] = createSignal(false)
  const toggleFocus = () => {
    const next = !listFocused()
    setListFocused(next)
    if (next) prompt.blur()
    else prompt.focus()
  }
  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])
  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )
  let prompt: PromptRef
  const args = useArgs()
  const local = useLocal()
  onMount(async () => {
    // Fetch Qwack sessions from server
    if (qwack.serverUrl()) {
      if (qwack.hasToken()) {
        const sessions = await qwack.fetchSessions()
        setQwackSessions(sessions)
        prompt.set({ input: "", parts: [] })
      } else {
        prompt.set({ input: "/qwack login", parts: [] })
      }
    }
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
    }
  })
  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(
    on(
      () => sync.ready && local.model.ready,
      (ready) => {
        if (!ready) return
        if (!args.prompt) return
        if (prompt.current?.input !== args.prompt) return
        prompt.submit()
      },
    ),
  )
  const directory = useDirectory()
  const keybind = useKeybind()
  return (
    <>
      <Show
        when={qwack.serverUrl()}
        fallback={
          <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
            <box flexGrow={1} minHeight={0} />
            <box height={4} minHeight={0} flexShrink={1} />
            <box flexShrink={0}>
              <Logo />
            </box>
            <box height={1} minHeight={0} flexShrink={1} />
            <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0}>
              <Prompt
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                }}
                hint={Hint}
                workspaceID={route.workspaceID}
              />
            </box>
            <box height={4} minHeight={0} width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
              <Show when={showTips()}>
                <Tips />
              </Show>
            </box>
            <box flexGrow={1} minHeight={0} />
            <Toast />
          </box>
        }
      >
        <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
          <box flexGrow={1} minHeight={0} />
          <box flexShrink={0}>
            <Logo />
          </box>
          <Show when={qwack.hasToken()}>
          <SessionList
            sessions={qwackSessions()}
            activeSessionId={qwack.sessionId()}
            onlineCount={qwack.onlineCount()}
            focused={listFocused}
            onSelect={async (sid) => {
              // Reuse existing local session if we've been in this Qwack session before
              const existingLocal = getLocalSessionForQwack(sid)
              if (existingLocal) {
                routeCtx.navigate({ type: "session", sessionID: existingLocal })
                const role = await qwack.connectAndJoin(sid)
                if (role !== "host") {
                  qwack.setCollabOnly(true)
                  qwack.setCollabRouteId(sid)
                }
                return
              }
              // First time entering this Qwack session — create local session
              const res = await sdk.client.session.create({ workspaceID: route.workspaceID })
              if (res.error) {
                console.error("Failed to create local session:", res.error)
                return
              }
              const { qwackSessionName } = await import("@tui/component/qwack-session-name")
              sdk.client.session.update({ sessionID: res.data.id, title: `🦆 ${qwackSessionName(sid)}` }).catch(() => {})
              setLocalSessionForQwack(sid, res.data.id)
              routeCtx.navigate({ type: "session", sessionID: res.data.id })
              const role = await qwack.connectAndJoin(sid)
              if (role !== "host") {
                qwack.setCollabOnly(true)
                qwack.setCollabRouteId(sid)
              }
            }}
            onStartNew={async () => {
              const sid = crypto.randomUUID()
              const res = await sdk.client.session.create({ workspaceID: route.workspaceID })
              if (res.error) {
                console.error("Failed to create local session:", res.error)
                return
              }
              const { qwackSessionName } = await import("@tui/component/qwack-session-name")
              sdk.client.session.update({ sessionID: res.data.id, title: `🦆 ${qwackSessionName(sid)}` }).catch(() => {})
              setLocalSessionForQwack(sid, res.data.id)
              routeCtx.navigate({ type: "session", sessionID: res.data.id })
              qwack.connect(sid)
              DialogQwackInvite.show(dialog)
            }}
            onJoinSession={() => {
              DialogQwackJoin.show(dialog, async (sid) => {
                // Create a real local OpenCode session so the route validator accepts it
                const res = await sdk.client.session.create({ workspaceID: route.workspaceID })
                if (res.error) {
                  console.error("Failed to create local session for join:", res.error)
                  return
                }
                const { qwackSessionName } = await import("@tui/component/qwack-session-name")
                sdk.client.session.update({ sessionID: res.data.id, title: `🦆 ${qwackSessionName(sid)}` }).catch(() => {})
                qwack.setCollabOnly(true)
                qwack.setCollabRouteId(sid)
                routeCtx.navigate({ type: "session", sessionID: res.data.id })
              })
            }}
            onDelete={async (sid) => {
              const ok = await qwack.deleteSession(sid)
              if (ok) {
                setQwackSessions(prev => prev.filter(s => s.id !== sid))
              }
            }}
            onToggleFocus={toggleFocus}
          />
          </Show>
          <Show when={qwack.status() === "connected" || qwack.userName()}>
            <box flexDirection="row" gap={1} paddingTop={1}>
              <text fg={qwack.status() === "connected" ? theme.success : theme.brand}>●</text>
              <text fg={theme.textMuted}>
                {qwack.status() === "connected" ? `Connected to ${qwack.serverUrl() ?? "qwack.ai"}` : `${qwack.userName()}`}
              </text>
            </box>
          </Show>
          <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0}>
            <Prompt
              ref={(r) => {
                prompt = r
                promptRef.set(r)
              }}
              hint={Hint}
              workspaceID={route.workspaceID}
            />
          </box>
          <box flexGrow={1} minHeight={0} />
          <Toast />
        </box>
      </Show>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}
