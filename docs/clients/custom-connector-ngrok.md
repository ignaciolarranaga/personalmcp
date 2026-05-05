# Local Server With ngrok

Web-hosted MCP clients such as ChatGPT connectors and Claude custom connectors connect from cloud infrastructure, so `localhost` URLs do not work there. Use ngrok or an equivalent tunnel to run AIProfile on your desktop while exposing a public HTTPS endpoint.

For a full visual Claude walkthrough, see [Claude Custom Connector With ngrok](/tutorials/claude-web-connector-ngrok).

Start AIProfile:

```bash
npm run build
npm start
```

In another terminal:

```bash
ngrok http 3000
```

ngrok prints a public HTTPS forwarding URL, for example:

```text
https://abc123.ngrok-free.app -> http://localhost:3000
```

Configure AIProfile:

```yaml
auth:
  mode: local
  anonymous_enabled: true
  issuer: https://abc123.ngrok-free.app
  resource: https://abc123.ngrok-free.app/mcp
```

Restart AIProfile after changing `config.yaml`.

Create a grant bound to the public MCP URL:

```bash
npm run auth -- grant add \
  --subject chatgpt-owner \
  --preset owner-full \
  --resource https://abc123.ngrok-free.app/mcp
```

Use this MCP URL in the remote client:

```text
https://abc123.ngrok-free.app/mcp
```

The client discovers OAuth metadata and opens the AIProfile authorization page. Enter the printed one-time approval code.

Security notes:

- Restart AIProfile and create a new grant whenever the tunnel URL changes.
- Keep public tunnels open only while needed.
- Prefer narrow presets such as `public-read` for testing.
- Revoke grants when testing is done.
- Never expose `auth.mode: off` through a public tunnel.
