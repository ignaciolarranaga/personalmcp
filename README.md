# PersonalMCP

A local-first MCP server that acts as your personal digital twin.

Feed it transcripts, notes, and documents. It extracts durable memory locally using a GGUF model. Any MCP-compatible client can then ask it questions about you or draft responses in your voice.

No cloud API required. No database. All memory stored as plain Markdown files.

---

## Prerequisites

- Node.js 18 or later
- ~3 GB free disk space (for the default model)
- macOS, Linux, or Windows (Metal/CUDA acceleration detected automatically)
- Docker, if you want to run PersonalMCP in a container

---

## Quick Start

```bash
npm install
npm run setup:model   # downloads Qwen3-4B-Instruct (~2.5 GB)
npm run build
npm start             # starts the MCP server on http://localhost:3000/mcp
```

Once running, connect your MCP client to `http://localhost:3000/mcp` — see the section below for your client.

---

## Docker

The Docker image is intentionally slim. It does not include GGUF model files or private memory, so mount `./models`, `./memory`, and `./config.yaml` when running the container.

Build the local image:

```bash
docker build -t personalmcp .
```

Download the default model into your local `./models` directory using the container:

```bash
docker run --rm \
  -v "$PWD/models:/app/models" \
  personalmcp npm run setup:model
```

Start PersonalMCP:

```bash
docker run --rm \
  -p 3000:3000 \
  -v "$PWD/models:/app/models" \
  -v "$PWD/memory:/app/memory" \
  -v "$PWD/config.yaml:/app/config.yaml:ro" \
  personalmcp
```

Once running, connect your MCP client to `http://localhost:3000/mcp`.

### Docker Compose

Build and start the service:

```bash
docker compose up --build
```

Run model setup through Compose:

```bash
docker compose run --rm personalmcp npm run setup:model
```

Stop the service:

```bash
docker compose down
```

---

## Connecting MCP Clients

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "personalmcp": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Save and restart Claude Desktop. The `personalmcp` server will appear in the tools panel.

### Claude Code (CLI)

```bash
claude mcp add personalmcp --transport http http://localhost:3000/mcp
```

The server is now available in all Claude Code sessions. Run `claude mcp list` to confirm.

### OpenAI Codex / ChatGPT Desktop

1. Open **Settings → Tools → Add MCP Server**
2. Enter the URL: `http://localhost:3000/mcp`
3. Save — the three PersonalMCP tools will appear immediately

### Any other MCP-compatible client

Use URL `http://localhost:3000/mcp` with transport type **Streamable HTTP**.

---

## Debugging with MCP Inspector

The Anthropic / Model Context Protocol debugging tool is **MCP Inspector**. It gives you a browser UI for connecting to an MCP server, listing tools, inspecting schemas, and calling tools with test inputs.

Start PersonalMCP in one terminal:

```bash
npm run build
npm start
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

Use the Inspector to call a tool directly and inspect the raw response. If a call fails, check both terminals: the Inspector terminal shows client/proxy connection issues, and the PersonalMCP terminal shows server-side errors such as model loading, config, or tool execution failures.

If `npx` reports an unsupported Node.js version for the Inspector, use Node.js 22 or later for the Inspector process. PersonalMCP itself only requires Node.js 18 or later.

---

## Tools

### `ingest`

Processes personal content and updates local memory.

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

Answers a question about or as the owner using stored memory.

```
ask(
  question: string,
  context?: string,          // extra context for the question
  mode?: string,             // about_owner | as_owner | likely_opinion | draft_response
  audience?: string          // owner | public | trusted | unknown
)
```

### `suggest_question`

Generates one useful question for the owner to answer, to help build memory.
Pass the owner's answer back to `ingest` with `source_type: "owner_answer"`.

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

## Memory Files

Memory is stored as plain Markdown files in `./memory/`:

```
memory/
  profile.md           — identity, name, role
  facts.md             — work history, projects, skills
  preferences.md       — communication, work, technology preferences
  principles.md        — decision-making heuristics, beliefs
  opinions.md          — views on specific topics
  communication_style.md — how the owner writes and communicates
  private.md           — sensitive information (gitignored)
  sources.json         — index of ingested sources
```

You can inspect and edit these files directly. They are human-readable.

---

## Configuration

Edit `config.yaml` to change settings:

```yaml
server:
  port: 3000           # HTTP port the MCP server listens on

owner:
  name: null           # learned through ingestion
  preferred_language: null

llm:
  provider: node-llama-cpp
  model_path: ./models/qwen3-4b-instruct-q4_k_m.gguf
  temperature: 0.2
  max_tokens: 1200

memory:
  path: ./memory

safety:
  allow_first_person: true
  public_can_access_private_memory: false
  require_disclaimer_for_inferred_answers: true
```

---

## Model Setup

### Default model (recommended)

**Qwen3-4B-Instruct Q4_K_M** — ~2.5 GB, strong instruction following, multilingual.

```bash
npm run setup:model
```

Manual download: https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF  
Save as: `./models/qwen3-4b-instruct-q4_k_m.gguf`

### Fallback model (weaker machines)

**Llama-3.2-3B-Instruct Q4_K_M** — ~2 GB, lower RAM requirement.

```bash
npm run setup:model -- --fallback
```

Manual download: https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF  
Save as: `./models/llama-3.2-3b-instruct-q4_k_m.gguf`  
Then update `config.yaml`: set `llm.model_path` to `./models/llama-3.2-3b-instruct-q4_k_m.gguf`

---

## Utility Commands

```bash
npm run memory:show      # print all memory files
npm run memory:reset     # clear all memory (keeps file structure)
npm run memory:backup    # copy memory/ to a timestamped backup folder
```

---

## Manual Release

DockerHub publishing is manual. No GitHub Actions publishing workflow or DockerHub secret is required.

1. Verify the local state:

```bash
git status
npm test
npm run build
docker build -t personalmcp .
```

2. Choose and apply a version bump:

```bash
npm version patch
# or:
npm version minor
# or:
npm version major
```

3. Push the version commit and git tag:

```bash
git push
git push --tags
```

4. Build and tag the release image:

```bash
VERSION=$(node -p "require('./package.json').version")
docker build -t personalmcp .
docker tag personalmcp ignaciolarranaga/personalmcp:$VERSION
docker tag personalmcp ignaciolarranaga/personalmcp:latest
```

5. Publish to DockerHub:

```bash
docker login
docker push ignaciolarranaga/personalmcp:$VERSION
docker push ignaciolarranaga/personalmcp:latest
```

6. Create a GitHub release manually:

- Use the tag `v$VERSION`.
- Include release notes with Docker image changes, usage notes, and any breaking changes.

7. Smoke test the published image:

```bash
docker pull ignaciolarranaga/personalmcp:$VERSION
docker run --rm \
  -p 3000:3000 \
  -v "$PWD/models:/app/models" \
  -v "$PWD/memory:/app/memory" \
  -v "$PWD/config.yaml:/app/config.yaml:ro" \
  ignaciolarranaga/personalmcp:$VERSION
```

Confirm the MCP endpoint works at `http://localhost:3000/mcp` with MCP Inspector or another MCP client.

---

## Example Usage

**Build initial memory:**

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

- The server listens on `localhost` only — not exposed to the network by default.
- `private.md` is gitignored. Sensitive memory stays local.
- Private memory is not exposed when `audience` is `public` or `unknown`.
- No shell execution tools are exposed through MCP.

---

## License

MIT
