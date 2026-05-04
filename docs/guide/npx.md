# NPX Usage

After the package is published, you can use AIProfile without cloning the repository:

```bash
npx --yes --ignore-scripts=false aiprofile setup-model
npx --yes --ignore-scripts=false aiprofile serve
```

The `--ignore-scripts=false` flag is intentional. It avoids missing native bindings when your user or environment npm config disables install scripts.

## Generate an owner token

```bash
npx --yes --ignore-scripts=false aiprofile auth token \
  --scope aiprofile:ask \
  --scope aiprofile:ingest \
  --scope aiprofile:suggest \
  --scope memory:read:public \
  --scope memory:read:personal \
  --scope memory:read:secret \
  --scope memory:read:kind:*
```

## Export and import memory

```bash
npx --yes --ignore-scripts=false aiprofile memory export --format jsonl
npx --yes --ignore-scripts=false aiprofile memory import memory-backup.md
```

If `npx` reports an unsupported Node.js version, use Node.js 22 or later.
