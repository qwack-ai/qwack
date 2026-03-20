export default function Privacy() {
  return (
    <main
      style={{ "max-width": "640px", margin: "80px auto", padding: "0 24px", "font-family": "system-ui, sans-serif" }}
    >
      <h1 style={{ "font-size": "24px", "margin-bottom": "8px" }}>Privacy Policy</h1>
      <p style={{ color: "#888", "font-size": "14px", "margin-bottom": "24px" }}>Effective March 2026</p>

      <h2 style={{ "font-size": "18px", "margin-top": "24px", color: "#e8a317" }}>What stays on your machine</h2>
      <p style={{ "line-height": "1.7", color: "#c2c2b0" }}>
        API keys, credentials, environment variables, and secrets never leave the host's machine. Tools (file reads,
        shell commands, code edits) execute locally on the host.
      </p>

      <h2 style={{ "font-size": "18px", "margin-top": "24px", color: "#e8a317" }}>What flows through the server</h2>
      <p style={{ "line-height": "1.7", color: "#c2c2b0" }}>
        Conversation content — prompts, agent responses, tool output (which may include file contents, diffs, and shell
        results), and chat messages — is relayed through our server so collaborators can see it. This data is protected
        by TLS in transit and encrypted at rest.
      </p>

      <h2 style={{ "font-size": "18px", "margin-top": "24px", color: "#e8a317" }}>What we store</h2>
      <p style={{ "line-height": "1.7", color: "#c2c2b0" }}>
        We store your account info (email, display name, GitHub ID) and session events for collaboration relay and
        session continuity. Session events are automatically deleted after 30 days.
      </p>

      <h2 style={{ "font-size": "18px", "margin-top": "24px", color: "#e8a317" }}>What we don't do</h2>
      <p style={{ "line-height": "1.7", color: "#c2c2b0" }}>
        We do not sell your data, serve ads, or use session content to train AI models. The server is a relay — no AI
        compute, no persistent code storage, no analytics.
      </p>

      <h2 style={{ "font-size": "18px", "margin-top": "24px", color: "#e8a317" }}>Data deletion</h2>
      <p style={{ "line-height": "1.7", color: "#c2c2b0" }}>
        Session events auto-expire after 30 days. To request account deletion, email{" "}
        <a href="mailto:hello@qwack.ai" style={{ color: "#e8a317" }}>
          hello@qwack.ai
        </a>
        .
      </p>
    </main>
  )
}
