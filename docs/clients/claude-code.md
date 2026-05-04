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

Unauthenticated access is limited to public-safe `ask`. Configure an `Authorization: Bearer <token>` header where supported for owner-level access.
