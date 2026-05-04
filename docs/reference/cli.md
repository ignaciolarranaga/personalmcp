# CLI

AIProfile exposes the `aiprofile` CLI from the package binary.

From source, run commands through npm scripts:

```bash
npm start
npm run auth -- grant add --subject owner --preset owner-full
npm run auth -- grant list
npm run setup-model
npm run memory -- export
```

From the published package, run commands through `npx`:

```bash
npx --yes --ignore-scripts=false aiprofile serve
npx --yes --ignore-scripts=false aiprofile auth grant add --subject owner --preset owner-full
npx --yes --ignore-scripts=false aiprofile setup-model
npx --yes --ignore-scripts=false aiprofile memory export
```

## Commands

### `serve`

Starts the MCP server.

```bash
npm start
npx --yes --ignore-scripts=false aiprofile serve
```

Useful options:

```bash
npm start -- --debug
npm start -- --password-file ./local-password-file
```

### `auth grant`

Creates, lists, and revokes local OAuth grants.

```bash
npm run auth -- grant add --subject owner --preset owner-full
npm run auth -- grant add --subject public-reader --preset public-read
npm run auth -- grant list
npm run auth -- grant revoke grant_abc123
```

`auth grant add` prints a one-time approval code for the OAuth authorization page. See [Authentication](/reference/authentication) for scope and ngrok examples.

### `setup-model`

Downloads a curated model or configures a custom GGUF model.

```bash
npm run setup-model
npm run setup-model -- --list-models
npm run setup-model -- --model qwen3-8b --write-config
```

See [Model Setup](/guide/model-setup) for model selection guidance.

### `memory`

Exports or imports memory.

```bash
npm run memory -- export
npm run memory -- export --format=jsonl
npm run memory -- import memory-backup.md
```

See [Memory](/guide/memory) for storage and import/export details.
