# AIProfile

AIProfile is a structured, agent-readable identity and context layer for people, companies, projects, and institutions.

Humans already have websites, blogs, LinkedIn profiles, resumes, emails, and company pages. LLMs and AI agents need something more explicit: a structured, trustworthy, permission-aware profile they can read and use. AIProfile fills that gap by giving agents a source of truth for an entity's identity, context, preferences, principles, capabilities, contact points, policies, and relevant knowledge.

Feed it transcripts, notes, documents, and other source material. It extracts durable memory locally using a GGUF model, stores that memory in an encrypted SQLite database, and exposes it through MCP so compatible clients can ask questions, draft responses, and respect the profile's boundaries.

No cloud API required.

## Documentation

Full documentation lives at <https://ignaciolarranaga.github.io/aiprofile/>.

Useful starting points:

- [Quick Start](https://ignaciolarranaga.github.io/aiprofile/guide/quick-start)
- [Authentication](https://ignaciolarranaga.github.io/aiprofile/reference/authentication)
- [MCP Clients](https://ignaciolarranaga.github.io/aiprofile/clients/)
- [Model Setup](https://ignaciolarranaga.github.io/aiprofile/guide/model-setup)
- [Memory](https://ignaciolarranaga.github.io/aiprofile/guide/memory)
- [Security](https://ignaciolarranaga.github.io/aiprofile/security)

## Prerequisites

- Node.js 22 or later
- Free disk space for the selected local model. `qwen3-4b` needs about 2.5 GB.
- macOS, Linux, or Windows. Metal and CUDA acceleration are detected automatically.
- C++ build tools for the SQLite native addon. On macOS, run `xcode-select --install`.

## Quick Start

```bash
npm install --ignore-scripts=false
npm run setup-model
npm run build
npm start
```

The `--ignore-scripts=false` flag is intentional. AIProfile uses native dependencies such as
`better-sqlite3` and local model runtime packages; if your npm config disables install scripts,
those native bindings may not be installed.

The MCP server starts at:

```text
http://localhost:3000/mcp
```

The first `npm start` asks you to create a memory password. AIProfile uses that password to initialize encrypted storage automatically. Remember it or store it securely; encrypted memory cannot be recovered if the password is lost.

By default, clients without a token can only use public-safe `ask`. To connect as the owner, generate a Bearer token after the encrypted vault exists:

```bash
npm run auth -- token \
  --scope aiprofile:ask \
  --scope aiprofile:ingest \
  --scope aiprofile:suggest \
  --scope memory:read:public \
  --scope memory:read:personal \
  --scope memory:read:secret \
  --scope memory:read:kind:*
```

Configure your MCP client to send:

```http
Authorization: Bearer <token>
```

## Basic Usage

Start with `suggest_question` if you have no memory yet:

```text
suggest_question -> owner answers -> ingest -> ask
```

The main tools are:

- `ingest`: processes source material and updates local memory.
- `ask`: answers or drafts from the profile's perspective using stored memory.
- `suggest_question`: generates a useful question for the profile owner or maintainer to answer.

See the [tool reference](https://ignaciolarranaga.github.io/aiprofile/reference/tools) for schemas and examples.

## Development

```bash
npm install --ignore-scripts=false
npm run build
npm run lint
npm run format:check
npm test
```

Run the documentation site locally:

```bash
npm run docs:dev
```

Build the documentation site:

```bash
npm run docs:build
```

## Security

AIProfile is local-first. Memory files are encrypted on disk by default, local auth is enabled by default, unauthenticated clients can only use public-safe `ask`, and no shell execution tools are exposed through MCP.

See [Security](https://ignaciolarranaga.github.io/aiprofile/security) and [Authentication](https://ignaciolarranaga.github.io/aiprofile/reference/authentication) for the full security model.
