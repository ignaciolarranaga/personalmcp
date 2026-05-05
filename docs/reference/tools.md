# Tools

AIProfile exposes three MCP tools.

## Core loop

```text
suggest_question -> owner answers -> ingest -> ask
```

Start with `suggest_question` if you have no memory yet. The tool will suggest what to ask first.

## `ingest`

Processes profile source material and updates local memory.

Large documents should be split into thematic chunks before ingestion. The server estimates each ingest prompt against the configured `llm.context_tokens` budget and rejects oversized single calls with chunking guidance instead of sending content that is likely to produce zero extracted memory.

```text
ingest(
  content: string,           // transcript, note, article, answer, etc.
  source_type?: string,      // chat_transcript | document | note | owner_answer | ...
  source_title?: string,     // human-readable label
  source_date?: string,      // YYYY-MM-DD
  instructions?: string      // optional focus: "extract opinions only"
)
```

## `ask`

Answers a question about the profile entity, or drafts from that entity's perspective, using stored memory.

```text
ask(
  question: string,
  context?: string,          // extra context for the question
  mode?: string,             // about_owner | as_owner | likely_opinion | draft_response
  audience?: string          // owner | public | trusted | unknown
)
```

## `suggest_question`

Generates one useful question for the profile owner or maintainer to answer, to help build memory. Pass the answer back to `ingest` with `source_type: "owner_answer"`.

```text
suggest_question(
  goal?: string,             // build_initial_memory | fill_gaps | learn_opinions | ...
  topic?: string,
  previous_questions?: string[]
)
```

## Example usage

Build initial memory for a person profile:

```text
User -> Claude Desktop -> suggest_question()
     <- "What should I know about who you are and what kind of work you do?"

User answers: "I'm Ignacio, I lead engineering and product teams..."

User -> Claude Desktop -> ingest(content="I'm Ignacio...", source_type="owner_answer")
     <- "Added 6 memory items."
```

Ask a question:

```text
User -> Claude Desktop -> ask(
  question="What would Ignacio think about using guilds in an engineering org?",
  mode="likely_opinion",
  audience="public"
)
```
