# Authentication

AIProfile uses OAuth 2.1 for HTTP MCP authentication. The server acts as both the MCP resource server and a local authorization server. Grants are stored in the encrypted AIProfile database, and clients receive OAuth access tokens through authorization code + PKCE.

This is local-first auth. Grant subjects and labels are for audit and revocation only; they do not prove email or account ownership. The one-time approval code printed by `aiprofile auth grant add` is the credential that authorizes a client connection.

## Overview

By default, `auth.mode` is `local`.

- Anonymous clients can call only public-safe `ask`.
- OAuth clients get tools and memory access according to grant scopes.
- Access tokens are audience-bound to `auth.resource`.
- Refresh tokens and grants can be revoked server-side.
- Encrypted memory mode is required for local OAuth in normal use.

## Expected flow

1. Start AIProfile locally on `http://localhost:3000/mcp`.
2. For ChatGPT or another web-hosted client, start an HTTPS tunnel such as `ngrok http 3000`.
3. Set `auth.issuer` to the public origin and `auth.resource` to the public MCP URL, then restart AIProfile.
4. Create a grant:

```bash
npm run auth -- grant add \
  --subject ignaciolarranaga \
  --preset owner-full \
  --resource https://abc123.ngrok-free.app/mcp
```

5. Add the MCP server URL in the client.
6. The client discovers OAuth metadata, registers itself, and opens the AIProfile authorization page.
7. Enter the one-time approval code, review the requested scopes, and approve.
8. Revoke access later:

```bash
npm run auth -- grant revoke <grant-id>
```

## Local HTTPS tunnels

ChatGPT and browser-hosted clients need a public HTTPS URL. For local desktop hosting, use ngrok or an equivalent tunnel:

```bash
ngrok http 3000
```

If ngrok prints `https://abc123.ngrok-free.app`, configure:

```yaml
auth:
  mode: local
  anonymous_enabled: true
  issuer: https://abc123.ngrok-free.app
  resource: https://abc123.ngrok-free.app/mcp
```

Restart AIProfile whenever the tunnel URL changes. Create grants bound to the public `resource` URL. Keep tunnels short-lived, grant narrow scopes, and never expose `auth.mode: off` through a tunnel.

## Grant commands

Create a grant with explicit scopes:

```bash
npm run auth -- grant add \
  --subject claude-desktop \
  --scope aiprofile:ask \
  --scope memory:read:public \
  --scope memory:read:kind:profile
```

Create a grant with a preset:

```bash
npm run auth -- grant add --subject owner --preset owner-full
```

List grants:

```bash
npm run auth -- grant list
```

Revoke a grant:

```bash
npm run auth -- grant revoke grant_abc123
```

## Presets

- `public-read`: ask plus public profile, fact, and summary memory.
- `owner-read`: ask plus all memory visibility and all memory kinds.
- `maintainer`: ask, ingest, suggest, and common profile-building memory scopes.
- `owner-full`: ask, ingest, suggest, all memory visibility, and all memory kinds.

## Scopes

Operation scopes:

- `aiprofile:ask`: call `ask` with authenticated memory access.
- `aiprofile:ingest`: call `ingest` to write new memory.
- `aiprofile:suggest`: call `suggest_question`.

Memory sensitivity scopes:

- `memory:read:public`: read records with `visibility: "normal"`.
- `memory:read:personal`: read records with `visibility: "sensitive"`.
- `memory:read:secret`: read records with `visibility: "secret"`.

Memory category scopes:

- `memory:read:kind:profile`
- `memory:read:kind:fact`
- `memory:read:kind:preference`
- `memory:read:kind:principle`
- `memory:read:kind:opinion`
- `memory:read:kind:communication_style`
- `memory:read:kind:relationship`
- `memory:read:kind:decision`
- `memory:read:kind:instruction`
- `memory:read:kind:summary`
- `memory:read:kind:private`
- `memory:read:kind:*`

## Client notes

- Desktop and terminal clients that run on the same machine can usually use `http://localhost:3000/mcp`.
- ChatGPT and other web-hosted clients must use HTTPS, usually through ngrok while testing locally.
- If OAuth fails after restarting ngrok, update `auth.issuer`, `auth.resource`, restart AIProfile, and create a new grant for the new resource URL.
- If a client reports insufficient scope, revoke the old grant and create a new grant with the needed preset or explicit scopes.
