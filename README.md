# AIProfile

AIProfile is a structured, agent-readable identity and context layer for people, companies,
projects, and institutions.

Humans already have websites, blogs, LinkedIn profiles, resumes, emails, and company pages. LLMs
and AI agents need something more explicit: a structured, trustworthy, permission-aware profile they
can read and use. AIProfile fills that gap by giving agents a source of truth for an entity's
identity, context, preferences, principles, capabilities, contact points, policies, and relevant
knowledge.

Feed it transcripts, notes, documents, and other source material. It extracts durable memory locally
using a GGUF model, stores that memory in an encrypted SQLite database, and exposes it through MCP so
compatible clients can ask questions, draft responses, and respect the profile's boundaries.

No cloud API required.

---

## Prerequisites

- Node.js 22 or later
- ~3 GB free disk space (for the default model)
- macOS, Linux, or Windows (Metal/CUDA acceleration detected automatically)
- **C++ build tools** for the SQLite native addon — on macOS, run `xcode-select --install`

---

## Quick Start

```bash
npm install
npm run setup-model   # downloads Qwen3-4B-Instruct (~2.5 GB)
npm run build
npm start             # starts the MCP server on http://localhost:3000/mcp
npm start -- --debug  # optional: logs MCP calls and LLM prompt/output snippets
```

The first `npm start` asks you to create a memory password. AIProfile uses that password to
initialize encrypted storage automatically. Remember it or store it securely; encrypted memory
cannot be recovered if the password is lost.

Once running, connect your MCP client to `http://localhost:3000/mcp` — see the section below for your client.

### NPX usage

After the package is published, you can use the same commands without cloning the repository:

```bash
npx aiprofile setup-model
npx aiprofile serve
npx aiprofile memory export --format jsonl
npx aiprofile memory import memory-backup.md
```

Tip: if `npx aiprofile serve` fails with an error like `Could not locate the bindings file`
for `better-sqlite3`, your npm config may be skipping native dependency install scripts. Retry with
install scripts enabled only for that command:

```bash
npx --yes --ignore-scripts=false aiprofile serve
```

If the same error persists after retrying, clear npm's failed npx install cache and run the command again.

---

## GitHub Codespaces

[Create a Codespace for AIProfile](https://codespaces.new/ignaciolarranaga/aiprofile)

The repository includes a `.devcontainer` setup for Codespaces. It uses Node.js 22 and installs the
native build tools needed by `better-sqlite3` and `node-llama-cpp` (`build-essential`, Python,
CMake, Ninja, and related compiler tooling). When the Codespace is created it runs:

```bash
npm ci
npm run build
```

After the Codespace is ready, download the local model explicitly:

```bash
npm run setup-model
```

The model is about 2.5 GB and is stored in `./models/`, which is ignored by Git. Codespaces should
compile and run the project on CPU; GPU acceleration such as Metal is not available there, and CUDA
depends on the Codespaces machine type.

Start the server with:

```bash
npm start
```

Port `3000` is forwarded automatically for the MCP endpoint at `/mcp`.

---

## Connecting MCP Clients

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "aiprofile": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Save and restart Claude Desktop. The `aiprofile` server will appear in the tools panel.

### Claude Code (CLI)

```bash
claude mcp add aiprofile --transport http http://localhost:3000/mcp
```

The server is now available in all Claude Code sessions. Run `claude mcp list` to confirm.

### OpenAI Codex / ChatGPT Desktop

1. Open **Settings → Tools → Add MCP Server**
2. Enter the URL: `http://localhost:3000/mcp`
3. Save — the three AIProfile tools will appear immediately

### Any other MCP-compatible client

Use URL `http://localhost:3000/mcp` with transport type **Streamable HTTP**.

### Claude Custom Connector with ngrok

Claude custom connectors are remote MCP connections. Claude connects from Anthropic's cloud infrastructure, so `localhost` URLs do not work there. To test AIProfile as a custom connector while still running it locally, expose the local HTTP server through ngrok:

```bash
npm run build
npm start
```

In another terminal:

```bash
ngrok http 3000
```

ngrok prints a public HTTPS forwarding URL, for example:

```text
https://abc123.ngrok-free.app -> http://localhost:3000
```

Add the MCP endpoint path when configuring Claude:

```text
https://abc123.ngrok-free.app/mcp
```

ngrok provides the public HTTPS certificate and forwards traffic to the local HTTP server, so AIProfile does not need built-in HTTPS for this flow. Stop the ngrok process when you are done testing.

---

## Debugging with MCP Inspector

The Anthropic / Model Context Protocol debugging tool is **MCP Inspector**. It gives you a browser UI for connecting to an MCP server, listing tools, inspecting schemas, and calling tools with test inputs.

Start AIProfile in one terminal:

```bash
npm run build
npm start
```

To include server-side MCP call traces and local LLM prompt/output snippets, start with:

```bash
npm start -- --debug
```

Start the Inspector in another terminal:

```bash
npx @modelcontextprotocol/inspector
```

The Inspector terminal prints a proxy session token. If the UI shows **Proxy Authentication Required**, copy that token, open **Configuration** in the Inspector UI, paste it into the proxy/session token field, and save.

Open the Inspector UI, usually `http://localhost:6274`, then connect with:

- **Transport type:** `Streamable HTTP`
- **URL:** `http://localhost:3000/mcp`

After connecting, open the **Tools** tab and run **List Tools**. You should see:

- `ingest`
- `ask`
- `suggest_question`

Use the Inspector to call a tool directly and inspect the raw response. If a call fails, check both terminals: the Inspector terminal shows client/proxy connection issues, and the AIProfile terminal shows server-side errors such as model loading, config, or tool execution failures.

If `npx` reports an unsupported Node.js version, use Node.js 22 or later.

---

## Tools

### `ingest`

Processes profile source material and updates local memory.

```
ingest(
  content: string,           // transcript, note, article, answer, etc.
  source_type?: string,      // chat_transcript | document | note | owner_answer | ...
  source_title?: string,     // human-readable label
  source_date?: string,      // YYYY-MM-DD
  instructions?: string      // optional focus: "extract opinions only"
)
```

### `ask`

Answers a question about the profile entity, or drafts from that entity's perspective, using stored
memory.

```
ask(
  question: string,
  context?: string,          // extra context for the question
  mode?: string,             // about_owner | as_owner | likely_opinion | draft_response
  audience?: string          // owner | public | trusted | unknown
)
```

### `suggest_question`

Generates one useful question for the profile owner or maintainer to answer, to help build memory.
Pass the answer back to `ingest` with `source_type: "owner_answer"`.

```
suggest_question(
  goal?: string,             // build_initial_memory | fill_gaps | learn_opinions | ...
  topic?: string,
  previous_questions?: string[]
)
```

---

## Core Loop

```
suggest_question → owner answers → ingest → ask
```

Start with `suggest_question` if you have no memory yet. The tool will suggest what to ask first.

---

## Memory Storage

Memory is stored in an encrypted SQLite database in `./memory/`. The first startup creates
`vault.json` and `memory.db.enc`:

```
memory/
  vault.json      — vault metadata and password verification data (not the password itself)
  memory.db.enc   — AES-256-GCM encrypted SQLite database
```

The database holds structured records with fields for kind, text, tags, confidence, importance,
status, and visibility. An FTS5 index enables fast full-text search for deduplication and future
retrieval ranking. A `sources` table tracks every ingested document to prevent duplicate ingestion.

In plain mode (`memory.mode: plain`), the database is stored as `memory.db` (unencrypted, on-disk
SQLite). Use plain mode only for local testing and debugging.

Encrypted vaults created before the AIProfile rename are not compatible with this release. Export
memory before upgrading, or start with a fresh `./memory/` directory and import the backup afterward.

### Inspecting and exporting memory

Because memory lives in a binary database rather than readable files, use the memory CLI:

```bash
# Export all active records to Markdown (stdout)
npm run memory -- export
npx aiprofile memory export

# Export as JSON Lines
npm run memory -- export --format=jsonl
npx aiprofile memory export --format jsonl

# Import from a previously exported Markdown file
npm run memory -- import memory-backup.md
npx aiprofile memory import memory-backup.md

# Supply the memory password non-interactively when exporting
npm run memory -- export --password-file ./local-password-file
npx aiprofile memory export --password-file ./local-password-file
```

---

## Configuration

AIProfile uses these defaults when no `config.yaml` is present. Create or edit `config.yaml` to
change settings:

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

safety:
  allow_first_person: true
  public_can_access_private_memory: false
  require_disclaimer_for_inferred_answers: true
```

---

## Model Setup

### Default model selection

By default, setup detects your machine and downloads the strongest curated model that is comfortably
recommended for the available RAM/VRAM:

```bash
npm run setup-model
npx aiprofile setup-model
```

Use an explicit model ID when you want to override automatic selection:

```bash
npm run setup-model -- --model qwen3-4b
npx aiprofile setup-model --model qwen3-4b
```

`qwen3-4b` is the safe fallback model if no curated model is recommended for the detected machine.

### Choose a model

List curated GGUF models with RAM/VRAM-aware recommendations:

```bash
npm run setup-model -- --list-models
npx aiprofile setup-model --list-models
```

Install a curated model by ID:

```bash
npm run setup-model -- --model qwen3-14b --write-config
npx aiprofile setup-model --model qwen3-14b --write-config
```

`--write-config` updates only `llm.model` and `llm.model_path` in `config.yaml`. Without it, the
command prints the exact config values to set manually.

### Mac RAM guide

The curated list uses GGUF files compatible with `node-llama-cpp`. Most options use Q4_K_M because
it is a good balance of quality, size, and speed on Apple Silicon. A few tiny models use Q8_0 where
the file is still small.

Recommended starting points:

| Mac memory | Try first                                | Notes                                                           |
| ---------: | ---------------------------------------- | --------------------------------------------------------------- |
|       8 GB | `llama-3.2-3b`                           | `qwen3-4b` remains a good explicit fallback.                    |
|      16 GB | `qwen3-8b`                               | Good laptop tier for stronger local answers.                    |
|      32 GB | `mistral-small-3.2-24b`                  | Better quality, slower startup and generation.                  |
|      64 GB | `deepseek-r1-qwen-32b`                   | Avoids 70B models unless they are comfortably recommended.      |
|      96 GB | `llama-3.3-70b`, `deepseek-r1-llama-70b` | High-end dense 70B-class models.                                |
|     128 GB | `mistral-large-2411`                     | Split GGUF top-end curated option for Mac Studio-class systems. |

For 192 GB, 256 GB, or 512 GB Mac Studio machines, use custom Hugging Face GGUF URIs for larger
models or higher-quality quantizations. The curated catalogue intentionally stops at models that are
practical on 128 GB RAM; for example, Qwen3-235B-A22B Q4_K_M is about 142 GB before runtime overhead
and is not included as a curated option.

### Smaller model (weaker machines)

**Llama-3.2-3B-Instruct Q4_K_M** - ~2 GB, lower RAM requirement.

```bash
npm run setup-model -- --model llama-3.2-3b
npx aiprofile setup-model --model llama-3.2-3b
```

Manual download: https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF  
Save as: `./models/llama-3.2-3b-instruct-q4_k_m.gguf`

### Custom Hugging Face or HTTP GGUF model

```bash
npx aiprofile setup-model --model hf:Qwen/Qwen3-8B-GGUF:Q4_K_M --write-config
npx aiprofile setup-model --model hf:Qwen/Qwen3-235B-A22B-GGUF:Q4_K_M
npx aiprofile setup-model --model https://huggingface.co/user/repo/resolve/main/model.gguf
```

Only GGUF models supported by `node-llama-cpp` can be loaded by AIProfile. Split GGUF models are
supported when the model URI resolves to the first `-00001-of-000NN.gguf` part; all downloaded parts
must remain in the same directory.

---

## Non-Interactive Startup

For service managers or MCP clients that start the server without an interactive terminal, provide
the memory password through an environment variable:

```bash
AIPROFILE_PASSWORD='your memory password' npm start
AIPROFILE_PASSWORD='your memory password' npx aiprofile serve
```

Or store the password in a local file and pass the file path:

```bash
npm start -- --password-file ./local-password-file
npx aiprofile serve --password-file ./local-password-file
```

Keep password files outside version control.

---

## Manual Release

1. Verify the local state and npm access:

```bash
git status --short --branch
npm whoami --registry https://registry.npmjs.org/
npm view aiprofile version --registry https://registry.npmjs.org/
```

For the first public release, `npm view` should return a 404 because the package name has not been
claimed yet.

2. Run the release gates:

```bash
npm run build
npm run lint
npm run format:check
npm test
```

3. Choose and apply a version bump:

```bash
npm version patch
# or:
npm version minor
# or:
npm version major
```

Keep the Commander version in `src/cli.ts` in sync with `package.json` when changing versions. For
the initial package-name reservation release, use the existing `0.1.0` version and skip this step.

4. Validate the npm package:

```bash
npm publish --dry-run --registry https://registry.npmjs.org/
```

Confirm the tarball contains `dist/`, `README.md`, `config.yaml`, `LICENSE`, and `package.json`, and
does not contain local `models/`, `memory/`, or `node_modules/` directories.

5. Publish to npm:

```bash
npm publish --registry https://registry.npmjs.org/
```

6. Verify npm published the intended version:

```bash
VERSION=$(node -p "require('./package.json').version")
npm view "aiprofile@$VERSION" version --registry https://registry.npmjs.org/
npm view aiprofile dist-tags --registry https://registry.npmjs.org/
```

Confirm `latest` points to the version you just published.

7. Push the version commit and git tag:

```bash
git push
git push --tags
```

8. Create a GitHub release manually:

- Use the tag `v$VERSION`.
- Include release notes with usage notes and any breaking changes.

9. Smoke test from source or npm:

```bash
npm install
npm run setup-model
npm run build
npm start
npx aiprofile --help
```

Confirm the MCP endpoint works at `http://localhost:3000/mcp` with MCP Inspector or another MCP client.

---

## Example Usage

**Build initial memory for a person profile:**

```
User → Claude Desktop → suggest_question()
     ← "What should I know about who you are and what kind of work you do?"

User answers: "I'm Ignacio, I lead engineering and product teams..."

User → Claude Desktop → ingest(content="I'm Ignacio...", source_type="owner_answer")
     ← "Added 6 memory items."
```

**Ask a question:**

```
User → Claude Desktop → ask(
  question="What would Ignacio think about using guilds in an engineering org?",
  mode="likely_opinion",
  audience="public"
)
← "Based on stored memory, Ignacio would likely be cautious about guilds as a substitute
   for ownership. He would support them as lightweight knowledge-sharing spaces but would
   insist that delivery accountability stays within clear team structures."
```

---

## Security Notes

- The local server uses HTTP on `localhost`. Use a tunnel such as ngrok when a public HTTPS URL is required.
- Do not keep a public tunnel open longer than needed without adding authentication or tunnel-level access control.
- Memory files are encrypted on disk by default and ignored by Git.
- Keep your memory password safe. If it is lost, encrypted memory cannot be recovered.
- Private memory is not exposed when `audience` is `public` or `unknown`.
- No shell execution tools are exposed through MCP.
