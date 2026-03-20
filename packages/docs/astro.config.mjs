import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"

export default defineConfig({
  redirects: {
    "/": "/getting-started/introduction/",
  },
  integrations: [
    starlight({
      title: "Qwack",
      description: "Collaborative AI agent steering platform — real-time multiplayer for AI coding agents.",
      favicon: "/favicon.svg",
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:title",
            content: "Qwack — Collaborative AI Agent Steering",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:description",
            content: "Real-time multiplayer for AI coding agents. One agent, shared context, terminal-native.",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:type",
            content: "website",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:card",
            content: "summary_large_image",
          },
        },
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/qwack-ai/qwack" },
      ],
      editLink: {
        baseUrl: "https://github.com/qwack-ai/qwack/edit/main/packages/docs/",
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 3,
      },
      expressiveCode: {
        themes: ["github-dark"],
        useStarlightDarkModeSwitch: true,
        styleOverrides: {
          borderRadius: "0.5rem",
          borderColor: "#555555",
        },
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Commands", slug: "guides/commands" },
            { label: "Architecture", slug: "guides/architecture" },
            { label: "Security", slug: "guides/security" },
          ],
        },
        {
          label: "Reference",
          items: [{ label: "WebSocket Protocol", slug: "reference/protocol" }],
        },
        {
          label: "OpenCode",
          items: [
            { label: "Providers", link: "https://opencode.ai/docs/providers/", attrs: { target: "_blank" } },
            { label: "Configuration", link: "https://opencode.ai/docs/config/", attrs: { target: "_blank" } },
            { label: "MCP Servers", link: "https://opencode.ai/docs/mcp-servers/", attrs: { target: "_blank" } },
            { label: "Plugins", link: "https://opencode.ai/docs/plugins/", attrs: { target: "_blank" } },
            { label: "Models", link: "https://opencode.ai/docs/models/", attrs: { target: "_blank" } },
            { label: "Permissions", link: "https://opencode.ai/docs/permissions/", attrs: { target: "_blank" } },
            { label: "All Docs ↗", link: "https://opencode.ai/docs/", attrs: { target: "_blank" } },
          ],
        },
      ],
    }),
  ],
})
