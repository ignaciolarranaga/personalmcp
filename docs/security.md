# Security

- The local server uses HTTP on `localhost`. Use a tunnel such as ngrok when a public HTTPS URL is required.
- Local auth is enabled by default. Unauthenticated clients can only use public-safe `ask`; owner access requires a Bearer token.
- Do not keep a public tunnel open longer than needed, and use a Bearer token or tunnel-level access control.
- Memory files are encrypted on disk by default and ignored by Git.
- Keep your memory password safe. If it is lost, encrypted memory cannot be recovered.
- Private memory is not exposed when `audience` is `public` or `unknown`.
- See [Authentication](/reference/authentication) for scopes, token examples, and rotation guidance.
- No shell execution tools are exposed through MCP.

## Public tunnels

Public tunnels expose your local MCP endpoint to the internet. Anonymous access remains limited, but owner-level use should always require a Bearer token.

When using ngrok or another public HTTPS tunnel, generate a token bound to the public MCP URL:

```bash
npm run auth -- token \
  --resource https://abc123.ngrok-free.app/mcp \
  --scope aiprofile:ask \
  --scope aiprofile:ingest \
  --scope aiprofile:suggest \
  --scope memory:read:public \
  --scope memory:read:personal \
  --scope memory:read:secret \
  --scope memory:read:kind:*
```
