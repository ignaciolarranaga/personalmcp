---
layout: home

hero:
  name: AIProfile
  text: Local-first identity and context for AI agents
  tagline: A structured, permission-aware MCP server for profiles, memory, preferences, principles, capabilities, and policies.
  actions:
    - theme: brand
      text: Quick Start
      link: /guide/quick-start
    - theme: alt
      text: Connect a Client
      link: /clients/

features:
  - title: Agent-readable profiles
    details: Store durable facts, preferences, principles, communication style, and context in a structured local profile.
  - title: Local-first memory
    details: Extract memory with a local GGUF model and store it in encrypted SQLite by default.
  - title: MCP-native access
    details: Expose ask, ingest, and suggestion tools to MCP-compatible clients with scoped OAuth grants.
---

## Start here

Install from source, download a local model, build the server, and connect an MCP client:

```bash
npm install --ignore-scripts=false
npm run setup-model
npm run build
npm start
```

The MCP endpoint runs at `http://localhost:3000/mcp`.

## Documentation

- [Quick Start](/guide/quick-start)
- [Authentication](/reference/authentication)
- [MCP Clients](/clients/)
- [Model Setup](/guide/model-setup)
- [Memory](/guide/memory)
- [Security](/security)
