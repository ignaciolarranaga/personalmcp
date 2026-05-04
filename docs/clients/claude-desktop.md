# Claude Desktop

Edit the Claude Desktop MCP configuration file.

macOS:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Windows:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

Add AIProfile:

```json
{
  "mcpServers": {
    "aiprofile": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Save and restart Claude Desktop. The `aiprofile` server will appear in the tools panel.

Create an OAuth grant:

```bash
npm run auth -- grant add --subject claude-desktop --preset owner-full
```

When Claude Desktop opens the AIProfile authorization page, enter the printed one-time approval code. Desktop-local use can normally keep `http://localhost:3000/mcp`; use ngrok only when the client connects from a remote service instead of the desktop app.
