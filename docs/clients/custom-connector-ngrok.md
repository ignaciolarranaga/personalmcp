# Claude Custom Connector with ngrok

Claude custom connectors are remote MCP connections. Claude connects from Anthropic's cloud infrastructure, so `localhost` URLs do not work there.

To test AIProfile as a custom connector while still running it locally, expose the local HTTP server through ngrok.

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

Add the MCP endpoint path when configuring Claude:

```text
https://abc123.ngrok-free.app/mcp
```

ngrok provides the public HTTPS certificate and forwards traffic to the local HTTP server, so AIProfile does not need built-in HTTPS for this flow.

Public tunnels should use a Bearer token. Anonymous access is intentionally limited to public-safe `ask`. Stop the ngrok process when you are done testing.
