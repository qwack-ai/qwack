import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { useToast } from "./toast"
import { useQwack } from "../context/qwack"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { onMount } from "solid-js"

function InviteDialog() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()
  const qwack = useQwack()
  const code = () => qwack.shortCode() ?? qwack.sessionId() ?? ""

  const copy = () => Clipboard.copy(code()).then(() => toast.show({ variant: "info", message: "Join code copied" }))

  useKeyboard((evt) => { if (evt.name === "return") copy() })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>Invite to Qwack</text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>esc</text>
      </box>
      <text fg={theme.textMuted}>Join code:</text>
      <box paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundHover}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>{code()}</text>
      </box>
      <text fg={theme.textMuted}>Tell your collaborator: /qjoin {code()}</text>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} gap={1}>
        <box paddingLeft={1} paddingRight={1} backgroundColor={theme.primary} onMouseUp={copy}>
          <text fg={theme.selectedListItemText}>Copy</text>
        </box>
        <box paddingLeft={1} paddingRight={1} onMouseUp={() => dialog.clear()}>
          <text fg={theme.textMuted}>Close</text>
        </box>
      </box>
    </box>
  )
}

function JoinDialog(props: { onJoin?: (id: string) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()
  const qwack = useQwack()
  let textarea: TextareaRenderable

  const submit = async () => {
    const val = textarea.plainText.trim()
    if (!val) return
    toast.show({ variant: "info", message: "Resolving..." })
    const resolved = await qwack.resolveShortCode(val)
    if (!resolved) {
      toast.show({ variant: "error", message: "Session not found" })
      return
    }
    qwack.connect(resolved)
    toast.show({ variant: "info", message: "Joining session\u2026" })
    props.onJoin?.(resolved)
    dialog.clear()
  }

  useKeyboard((evt) => { if (evt.name === "return") submit() })

  onMount(() => {
    setTimeout(() => { if (!textarea || textarea.isDestroyed) return; textarea.focus() }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>Join Qwack Session</text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>esc</text>
      </box>
      <text fg={theme.textMuted}>Enter join code or session ID:</text>
      <textarea
        onSubmit={submit}
        height={3}
        keyBindings={[{ name: "return", action: "submit" }]}
        ref={(val: TextareaRenderable) => (textarea = val)}
        placeholder="e.g. SWIFT-DUCK-42"
        textColor={theme.text}
        focusedTextColor={theme.text}
        cursorColor={theme.text}
      />
      <box paddingBottom={1} flexDirection="row">
        <text fg={theme.text}>enter <span style={{ fg: theme.textMuted }}>join</span></text>
      </box>
    </box>
  )
}

export const DialogQwackInvite = {
  show(dialog: DialogContext) {
    dialog.replace(() => <InviteDialog />)
  },
}

export const DialogQwackJoin = {
  show(dialog: DialogContext, onJoin?: (id: string) => void) {
    dialog.replace(() => <JoinDialog onJoin={onJoin} />)
  },
}
