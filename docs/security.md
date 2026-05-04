# Security

- The local server uses HTTP on `localhost`. Use a tunnel such as ngrok when a public HTTPS URL is required.
- Local auth is enabled by default. Unauthenticated clients can only use public-safe `ask`; owner access requires an OAuth grant.
- Do not keep a public tunnel open longer than needed, and use narrow grants or tunnel-level access control.
- Memory files and OAuth grants are stored in the encrypted local database by default and ignored by Git.
- Keep your memory password safe. If it is lost, encrypted memory cannot be recovered.
- Private memory is not exposed when `audience` is `public` or `unknown`.
- Grant subjects and labels are not identity proof. Possession of the one-time approval code authorizes a connection.
- See [Authentication](/reference/authentication) for scopes, grant examples, revocation, and tunnel guidance.
- No shell execution tools are exposed through MCP.

## Public tunnels

Public tunnels expose your local MCP endpoint to the internet. Anonymous access remains limited, but owner-level use should always require an OAuth grant bound to the public MCP URL.

When using ngrok or another public HTTPS tunnel:

```bash
ngrok http 3000
```

Configure the public URL:

```yaml
auth:
  mode: local
  anonymous_enabled: true
  issuer: https://abc123.ngrok-free.app
  resource: https://abc123.ngrok-free.app/mcp
```

Then create a grant:

```bash
npm run auth -- grant add \
  --subject chatgpt-owner \
  --preset owner-full \
  --resource https://abc123.ngrok-free.app/mcp
```

Stop the tunnel and revoke grants when you are done testing.
