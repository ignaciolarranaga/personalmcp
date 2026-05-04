# MCP Clients

AIProfile accepts unauthenticated MCP connections, but those connections are intentionally limited to public-safe `ask`.

Owner-level use requires a Bearer token generated with `aiprofile auth token`. Use the token as an `Authorization: Bearer <token>` header in MCP clients that support custom headers.

Use URL:

```text
http://localhost:3000/mcp
```

Transport type:

```text
Streamable HTTP
```

Client guides:

- [Claude Desktop](/clients/claude-desktop)
- [Claude Code](/clients/claude-code)
- [OpenAI Codex and ChatGPT Desktop](/clients/openai-codex-chatgpt)
- [Claude Custom Connector with ngrok](/clients/custom-connector-ngrok)

See [Authentication](/reference/authentication) for examples and supported scopes.
