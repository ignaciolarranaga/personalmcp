# ChatGPT And Codex

## ChatGPT Web Or Desktop Connector

ChatGPT connects from OpenAI infrastructure, so a local `localhost` URL is not reachable. For local desktop hosting, expose AIProfile with ngrok:

```bash
ngrok http 3000
```

Configure `config.yaml` with the public URL and restart AIProfile:

```yaml
auth:
  mode: local
  anonymous_enabled: true
  issuer: https://abc123.ngrok-free.app
  resource: https://abc123.ngrok-free.app/mcp
```

Create a grant:

```bash
npm run auth -- grant add \
  --subject chatgpt-owner \
  --preset owner-full \
  --resource https://abc123.ngrok-free.app/mcp
```

In ChatGPT, add an MCP server or connector with:

```text
https://abc123.ngrok-free.app/mcp
```

ChatGPT discovers OAuth metadata, registers itself, and opens the AIProfile authorization page. Enter the one-time approval code printed by the grant command.

## Codex Terminal Or CLI

For terminal clients running on the same machine, use the local URL:

```text
http://localhost:3000/mcp
```

Create a local grant:

```bash
npm run auth -- grant add --subject codex-cli --preset owner-full
```

When Codex opens the OAuth authorization page, enter the printed one-time approval code. If your Codex environment runs remotely, use the ngrok flow above instead of `localhost`.
