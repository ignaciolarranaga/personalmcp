# AIProfile Authentication

AIProfile uses local Bearer tokens for HTTP MCP authentication. Tokens are issued by the local CLI
after verifying the encrypted memory master password, and the server validates them on every MCP
request.

This is a local-first security model rather than a hosted OAuth authorization server. It follows the
MCP transport pattern of sending:

```http
Authorization: Bearer <token>
```

## Overview

By default, `auth.mode` is `local`. The server accepts both anonymous and token-authenticated MCP
connections:

- Anonymous clients get a limited public surface.
- Authenticated clients get tools and memory access according to token scopes.
- Tokens are signed from the encrypted memory vault key, so token issuance requires the memory
  master password.
- Tokens expire after 30 days by default.

## Anonymous Access

Unauthenticated clients can only call `ask` in public-safe mode. Anonymous answers read only memory
records with `visibility: "normal"` from generic categories:

- `profile`
- `fact`
- `summary`

Anonymous clients cannot call `ingest` or `suggest_question`, and they cannot read personal,
private, or sensitive memory.

## Creating Tokens

Create tokens after the encrypted memory vault exists. The first `npm start` or
`npx aiprofile serve` creates the vault and asks for the memory password.

Owner token with broad local permissions:

```bash
node dist/index.js auth token \
  --scope aiprofile:ask \
  --scope aiprofile:ingest \
  --scope aiprofile:suggest \
  --scope memory:read:public \
  --scope memory:read:personal \
  --scope memory:read:secret \
  --scope memory:read:kind:*
```

Published package form:

```bash
npx aiprofile auth token \
  --scope aiprofile:ask \
  --scope aiprofile:ingest \
  --scope aiprofile:suggest \
  --scope memory:read:public \
  --scope memory:read:personal \
  --scope memory:read:secret \
  --scope memory:read:kind:*
```

The default expiration is `30d`. Override it with `--expires-in`:

```bash
node dist/index.js auth token --scope aiprofile:ask --expires-in 24h
```

If the MCP endpoint resource URL differs from the default `http://localhost:3000/mcp`, bind the
token to that URL:

```bash
node dist/index.js auth token \
  --resource https://abc123.ngrok-free.app/mcp \
  --scope aiprofile:ask
```

Bearer tokens are credentials. Treat them like passwords and avoid committing them to source
control.

## Configuring MCP Clients

Use URL `http://localhost:3000/mcp` with Streamable HTTP transport.

For owner-level access, configure the client to send this header on every request:

```http
Authorization: Bearer <token>
```

If a client cannot send custom headers, it can still connect anonymously, but it will only have
public-safe `ask`.

## Configuration

The default auth configuration is:

```yaml
auth:
  mode: local
  anonymous_enabled: true
```

`auth.mode: local` enables local Bearer tokens signed from the encrypted memory vault. In this mode,
encrypted memory is required.

`auth.mode: off` disables token checks and exposes the full MCP tool surface without authentication.
Use it only for isolated local testing.

`auth.anonymous_enabled: true` documents the intended anonymous access behavior. Anonymous access is
limited to public-safe `ask`.

`auth.resource` may be set when the externally visible MCP URL is not
`http://localhost:<port>/mcp`, such as when using a public HTTPS tunnel. Tokens are audience-bound to
the resource URL.

## Operation Scopes

- `aiprofile:ask`: call `ask` with authenticated memory access.
- `aiprofile:ingest`: call `ingest` to write new memory.
- `aiprofile:suggest`: call `suggest_question`.

## Memory Sensitivity Scopes

- `memory:read:public`: read records with `visibility: "normal"`.
- `memory:read:personal`: read records with `visibility: "sensitive"`.
- `memory:read:secret`: read records with `visibility: "secret"`.

## Memory Category Scopes

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

## Recommended Token Bundles

Read-only public profile:

```bash
node dist/index.js auth token \
  --scope aiprofile:ask \
  --scope memory:read:public \
  --scope memory:read:kind:profile \
  --scope memory:read:kind:fact \
  --scope memory:read:kind:summary
```

Owner read access:

```bash
node dist/index.js auth token \
  --scope aiprofile:ask \
  --scope memory:read:public \
  --scope memory:read:personal \
  --scope memory:read:secret \
  --scope memory:read:kind:*
```

Ingest-capable client:

```bash
node dist/index.js auth token \
  --scope aiprofile:ask \
  --scope aiprofile:ingest \
  --scope aiprofile:suggest \
  --scope memory:read:public \
  --scope memory:read:personal \
  --scope memory:read:kind:profile \
  --scope memory:read:kind:preference \
  --scope memory:read:kind:principle \
  --scope memory:read:kind:communication_style
```

## Expiration and Rotation

Tokens expire after 30 days by default. Generate a new token before expiry and update the MCP client
configuration.

Local JWTs are self-contained, so v1 does not support server-side revocation for a single token. If
a token is exposed, remove it from the affected client/config, issue a narrower replacement, and stop
any publicly reachable tunnel until exposed clients are under control.

## Public Tunnel Guidance

When using ngrok or another public HTTPS tunnel, generate a token bound to the public MCP URL:

```bash
node dist/index.js auth token \
  --resource https://abc123.ngrok-free.app/mcp \
  --scope aiprofile:ask \
  --scope aiprofile:ingest \
  --scope aiprofile:suggest \
  --scope memory:read:public \
  --scope memory:read:personal \
  --scope memory:read:secret \
  --scope memory:read:kind:*
```

Do not keep public tunnels open longer than needed. Anonymous access remains limited, but a public
tunnel still exposes your local MCP endpoint to the internet.
