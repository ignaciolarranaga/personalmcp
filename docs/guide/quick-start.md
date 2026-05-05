# Quick Start

AIProfile is a structured, agent-readable identity and context layer for people, companies, projects, and institutions.

It extracts durable memory locally using a GGUF model, stores that memory in encrypted SQLite, and exposes it through MCP so compatible clients can ask questions, draft responses, and respect the profile's boundaries.

No cloud API is required.

## Prerequisites

- Node.js 22 or later
- Free disk space for the selected local model. `qwen3-4b` needs about 2.5 GB.
- macOS, Linux, or Windows. Metal and CUDA acceleration are detected automatically.
- C++ build tools for the SQLite native addon. On macOS, run `xcode-select --install`.

## Install from source

```bash
npm install --ignore-scripts=false
npm run setup-model
npm run build
npm start
```

The install command explicitly enables npm install scripts because AIProfile uses native dependencies, including `better-sqlite3` for encrypted SQLite storage and local model runtime packages. If your npm config disables scripts globally, those native bindings may not be installed.

The server starts on:

```text
http://localhost:3000/mcp
```

For MCP call traces and local LLM prompt/output snippets, start with:

```bash
npm start -- --debug
```

## Create the encrypted vault

The first startup asks you to create a memory password. AIProfile uses that password to initialize encrypted storage automatically.

Remember it or store it securely. Encrypted memory cannot be recovered if the password is lost.

## Create an OAuth grant

By default, unauthenticated clients can only use public-safe `ask`. To connect as the owner with permission to read all memory and ingest new content, create an OAuth grant after the first server startup has created the encrypted vault:

```bash
npm run auth -- grant add \
  --subject owner \
  --preset owner-full
```

The command prints a one-time approval code. Add `http://localhost:3000/mcp` in a desktop or terminal MCP client, let the client open the AIProfile authorization page, and approve with that code.

For ChatGPT or another web-hosted client, use an HTTPS tunnel:

```bash
ngrok http 3000
```

If ngrok gives you `https://abc123.ngrok-free.app`, set:

```yaml
auth:
  mode: local
  anonymous_enabled: true
  issuer: https://abc123.ngrok-free.app
  resource: https://abc123.ngrok-free.app/mcp
```

Stop AIProfile, create a grant bound to the public resource, confirm the grant appears, then restart AIProfile. With encrypted memory, the server loads the local database at startup, so the grant should exist before the server restarts.

```bash
npm run auth -- grant add \
  --subject chatgpt-owner \
  --preset owner-full \
  --resource https://abc123.ngrok-free.app/mcp
npm run auth -- grant list
```

Restart AIProfile:

```bash
npm start
```

Then add `https://abc123.ngrok-free.app/mcp` in ChatGPT, Claude, or Codex.

The `subject` is only a local audit label. Possession of the one-time approval code authorizes the connection. See [Authentication](/reference/authentication) for narrower grants, scopes, revocation, and tunnel guidance.

## Basic usage

Start with `suggest_question` if you have no memory yet:

```text
suggest_question -> owner answers -> ingest -> ask
```

Example flow:

```text
User -> Claude Desktop -> suggest_question()
     <- "What should I know about who you are and what kind of work you do?"

User answers: "I'm Ignacio, I lead engineering and product teams..."

User -> Claude Desktop -> ingest(content="I'm Ignacio...", source_type="owner_answer")
     <- "Added 6 memory items."
```

Ask a question using stored memory:

```text
ask(
  question="What would Ignacio think about using guilds in an engineering org?",
  mode="likely_opinion",
  audience="public"
)
```

## Next steps

- Use the package without cloning through [NPX usage](/guide/npx).
- Connect a desktop or CLI client in [MCP Clients](/clients/).
- Review [Model Setup](/guide/model-setup) to choose a local GGUF model.
- Review [Memory](/guide/memory) for import, export, and storage details.
