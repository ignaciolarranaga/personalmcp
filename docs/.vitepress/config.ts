import { defineConfig } from "vitepress";

export default defineConfig({
  title: "AIProfile",
  description:
    "A local-first MCP server for structured, agent-readable identity and context profiles",
  base: "/aiprofile/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    siteTitle: "AIProfile",
    nav: [
      { text: "Guide", link: "/guide/quick-start" },
      { text: "Tutorials", link: "/tutorials/" },
      { text: "Clients", link: "/clients/" },
      { text: "Reference", link: "/reference/tools" },
      { text: "Development", link: "/development/" },
      { text: "GitHub", link: "https://github.com/ignaciolarranaga/aiprofile" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Quick Start", link: "/guide/quick-start" },
          { text: "NPX Usage", link: "/guide/npx" },
          { text: "Configuration", link: "/guide/configuration" },
          { text: "Model Setup", link: "/guide/model-setup" },
          { text: "Memory", link: "/guide/memory" },
          { text: "Codespaces", link: "/guide/codespaces" },
        ],
      },
      {
        text: "Tutorials",
        items: [
          { text: "Overview", link: "/tutorials/" },
          {
            text: "Claude: npm person profile",
            link: "/tutorials/claude-web-connector-ngrok",
          },
          {
            text: "ChatGPT: npx company profile",
            link: "/tutorials/chatgpt-npx-company-ngrok",
          },
        ],
      },
      {
        text: "MCP Clients",
        items: [
          { text: "Overview", link: "/clients/" },
          { text: "Claude Desktop", link: "/clients/claude-desktop" },
          { text: "Claude Code", link: "/clients/claude-code" },
          { text: "OpenAI Codex and ChatGPT Desktop", link: "/clients/openai-codex-chatgpt" },
          { text: "Claude Custom Connector with ngrok", link: "/clients/custom-connector-ngrok" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Tools", link: "/reference/tools" },
          { text: "Authentication", link: "/reference/authentication" },
          { text: "CLI", link: "/reference/cli" },
          { text: "Security", link: "/security" },
        ],
      },
      {
        text: "Development",
        items: [
          { text: "Development", link: "/development/" },
          { text: "MCP Inspector", link: "/development/mcp-inspector" },
          { text: "Release", link: "/development/release" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/ignaciolarranaga/aiprofile" }],
    search: {
      provider: "local",
    },
  },
});
