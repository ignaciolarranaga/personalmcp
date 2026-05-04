# Configuration

AIProfile uses these defaults when no `config.yaml` is present. Create or edit `config.yaml` to change settings:

```yaml
server:
  port: 3000 # HTTP port the MCP server listens on

owner:
  name: null # learned through ingestion
  preferred_language: null

llm:
  provider: node-llama-cpp
  model_path: ./models/qwen3-4b-instruct-q4_k_m.gguf
  temperature: 0.2
  max_tokens: 1200

memory:
  path: ./memory
  mode: encrypted # default; set to plain only for local testing/debugging

auth:
  mode: local # default; local Bearer tokens signed from the encrypted memory vault
  anonymous_enabled: true # unauthenticated clients can only use public-safe ask

safety:
  allow_first_person: true
  public_can_access_private_memory: false
  require_disclaimer_for_inferred_answers: true
```

## Server

`server.port` controls the local HTTP port. The MCP endpoint is:

```text
http://localhost:<port>/mcp
```

## Local model

`llm.model_path` points to the GGUF model file. Use [Model Setup](/guide/model-setup) to download a curated model and optionally update `config.yaml`.

## Memory mode

`memory.mode: encrypted` is the default and recommended setting. It stores memory in an encrypted SQLite database.

`memory.mode: plain` stores memory as an unencrypted on-disk SQLite database. Use plain mode only for local testing and debugging.

## Authentication

`auth.mode: local` enables local Bearer tokens signed from the encrypted memory vault. In this mode, encrypted memory is required.

`auth.mode: off` disables token checks and exposes the full MCP tool surface without authentication. Use it only for isolated local testing.

`auth.anonymous_enabled: true` documents the intended anonymous access behavior. Anonymous access is limited to public-safe `ask`.

`auth.resource` may be set when the externally visible MCP URL is not `http://localhost:<port>/mcp`, such as when using a public HTTPS tunnel. Tokens are audience-bound to the resource URL.

## Non-interactive startup

For service managers or MCP clients that start the server without an interactive terminal, provide the memory password through an environment variable:

```bash
AIPROFILE_PASSWORD='your memory password' npm start
AIPROFILE_PASSWORD='your memory password' npx --yes --ignore-scripts=false aiprofile serve
```

Or store the password in a local file and pass the file path:

```bash
npm start -- --password-file ./local-password-file
npx --yes --ignore-scripts=false aiprofile serve --password-file ./local-password-file
```

Keep password files outside version control.
