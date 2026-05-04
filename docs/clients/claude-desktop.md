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

Unauthenticated access is limited to public-safe `ask`. Configure an `Authorization: Bearer <token>` header where supported for owner-level access.
