# MCP Clients

AIProfile accepts unauthenticated MCP connections, but those connections are intentionally limited to public-safe `ask`. Owner-level use requires an OAuth grant created with `aiprofile auth grant add`.

Default local URL:

```text
http://localhost:3000/mcp
```

Transport type:

```text
Streamable HTTP
```

## Compatibility

| Client                   | Runtime                         | Typical URL                 | Notes                                                   |
| ------------------------ | ------------------------------- | --------------------------- | ------------------------------------------------------- |
| Claude Desktop           | Desktop app                     | `http://localhost:3000/mcp` | Can connect directly to a local desktop server.         |
| Claude Code              | Terminal                        | `http://localhost:3000/mcp` | Add with `claude mcp add --transport http`.             |
| Codex CLI                | Terminal                        | `http://localhost:3000/mcp` | Configure as a local terminal MCP server.               |
| ChatGPT connectors       | Web/desktop UI backed by OpenAI | `https://<tunnel>/mcp`      | Requires public HTTPS, usually ngrok for local testing. |
| Claude custom connectors | Web-hosted                      | `https://<tunnel>/mcp`      | Requires public HTTPS, usually ngrok for local testing. |

Client guides:

- [Claude Desktop](/clients/claude-desktop)
- [Claude Code](/clients/claude-code)
- [ChatGPT and Codex](/clients/openai-codex-chatgpt)
- [Local server with ngrok](/clients/custom-connector-ngrok)

For full visual walkthroughs, see [Claude: npm person profile](/tutorials/claude-web-connector-ngrok) and [ChatGPT: npx company profile](/tutorials/chatgpt-npx-company-ngrok).

See [Authentication](/reference/authentication) for OAuth grants, presets, scopes, and revocation.
