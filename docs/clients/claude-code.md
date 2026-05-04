# Claude Code

Add AIProfile as an HTTP MCP server:

```bash
claude mcp add aiprofile --transport http http://localhost:3000/mcp
```

The server is now available in all Claude Code sessions.

Confirm the configuration:

```bash
claude mcp list
```

Create an OAuth grant:

```bash
npm run auth -- grant add --subject claude-code --preset owner-full
```

When Claude Code starts the OAuth flow, enter the printed one-time approval code in the AIProfile authorization page.

If Claude Code is running in a remote environment that cannot reach your desktop `localhost`, expose AIProfile with ngrok and add the public `https://.../mcp` URL instead.
