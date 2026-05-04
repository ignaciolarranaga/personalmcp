# Development

Install dependencies:

```bash
npm install --ignore-scripts=false
```

Build TypeScript:

```bash
npm run build
```

Run local checks:

```bash
npm run lint
npm run format:check
npm test
```

Run the server from the built output:

```bash
npm start
```

Run the VitePress documentation site locally:

```bash
npm run docs:dev
```

Build the documentation site:

```bash
npm run docs:build
```

Preview the built documentation site:

```bash
npm run docs:preview
```

## Project structure

```text
src/        TypeScript source
tests/      Vitest tests
docs/       VitePress documentation site
dist/       Built JavaScript output
models/     Local GGUF models, ignored by Git
memory/     Local memory vault and database, ignored by Git
```

## Additional guides

- [MCP Inspector](/development/mcp-inspector)
- [Release](/development/release)
