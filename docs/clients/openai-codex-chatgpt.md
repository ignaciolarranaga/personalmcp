# OpenAI Codex and ChatGPT Desktop

1. Open **Settings -> Tools -> Add MCP Server**.
2. Enter the URL:

```text
http://localhost:3000/mcp
```

3. Save the server.

Unauthenticated access is limited to public-safe `ask`. Add the Bearer token header for owner access where supported:

```http
Authorization: Bearer <token>
```
