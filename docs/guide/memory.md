# Memory

Memory is stored in an encrypted SQLite database in `./memory/`. The first startup creates:

```text
memory/
  vault.json
  memory.db.enc
```

`vault.json` stores vault metadata and password verification data. It does not store the password itself.

`memory.db.enc` stores the AES-256-GCM encrypted SQLite database.

The database holds structured records with fields for kind, text, tags, confidence, importance, status, and visibility. An FTS5 index enables fast full-text search for deduplication and future retrieval ranking. A `sources` table tracks every ingested document to prevent duplicate ingestion.

In plain mode, configured with `memory.mode: plain`, the database is stored as `memory.db` and is not encrypted. Use plain mode only for local testing and debugging.

Encrypted vaults created before the AIProfile rename are not compatible with this release. Export memory before upgrading, or start with a fresh `./memory/` directory and import the backup afterward.

## Export memory

Because memory lives in a binary database rather than readable files, use the `aiprofile memory` subcommand.

Export all active records to Markdown:

```bash
npm run memory -- export
npx --yes --ignore-scripts=false aiprofile memory export
```

Export as JSON Lines:

```bash
npm run memory -- export --format=jsonl
npx --yes --ignore-scripts=false aiprofile memory export --format jsonl
```

Supply the memory password non-interactively:

```bash
npm run memory -- export --password-file ./local-password-file
npx --yes --ignore-scripts=false aiprofile memory export --password-file ./local-password-file
```

## Import memory

Import from a previously exported Markdown file:

```bash
npm run memory -- import memory-backup.md
npx --yes --ignore-scripts=false aiprofile memory import memory-backup.md
```
