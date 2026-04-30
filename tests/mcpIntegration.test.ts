import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../src/server.js";
import type { DebugLogger } from "../src/debug.js";
import type { Config, GenerateInput, GenerateOutput } from "../src/types.js";
import type { LlmProvider } from "../src/llm/LlmProvider.js";

type LlmResponse = string | Error | ((input: GenerateInput) => string);

const MEMORY_FILES: Record<string, string> = {
  "profile.md": "Profile",
  "facts.md": "Facts",
  "preferences.md": "Preferences",
  "principles.md": "Principles",
  "opinions.md": "Opinions",
  "communication_style.md": "Communication Style",
  "private.md": "Private",
};

class QueueLlmProvider implements LlmProvider {
  readonly calls: GenerateInput[] = [];
  private readonly responses: LlmResponse[];

  constructor(responses: LlmResponse[] = []) {
    this.responses = [...responses];
  }

  async initialize(): Promise<void> {
    return;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    this.calls.push(input);
    const response = this.responses.shift() ?? "";
    if (response instanceof Error) throw response;
    return { text: typeof response === "function" ? response(input) : response };
  }
}

class CapturingDebugLogger implements DebugLogger {
  readonly enabled = true;
  readonly events: Array<{ event: string; details?: Record<string, unknown> }> = [];

  log(event: string, details?: Record<string, unknown>): void {
    this.events.push({ event, details });
  }
}

interface RunningTestServer {
  client: Client;
  llm: QueueLlmProvider;
  memPath: string;
  close: () => Promise<void>;
}

const runningServers: RunningTestServer[] = [];

afterEach(async () => {
  const servers = runningServers.splice(0);
  await Promise.all(servers.map((server) => server.close()));
});

describe("MCP integration", () => {
  it("exposes the expected tools through MCP listTools", async () => {
    const server = await startTestServer();

    const result = await server.client.listTools();
    const toolNames = result.tools.map((tool) => tool.name).sort();

    expect(toolNames).toEqual(["ask", "ingest", "suggest_question"]);
    expect(result.tools.find((tool) => tool.name === "ingest")?.inputSchema).toBeDefined();
  });

  it("returns the bootstrap question when memory is empty", async () => {
    const server = await startTestServer();

    const result = await callTool(server.client, "suggest_question", {
      goal: "build_initial_memory",
    });

    expect(result.structuredContent?.suggested_source_type).toBe("owner_answer");
    expect(result.structuredContent?.expected_memory_categories).toContain("profile");
    expect(firstText(result)).toContain("Question:");
    expect(server.llm.calls).toHaveLength(0);
  });

  it("uses the LLM for suggest_question when memory exists and returns parsed content", async () => {
    const server = await startTestServer({
      responses: [
        JSON.stringify({
          question: "Which engineering principles guide your technical decisions?",
          purpose: "Learn durable decision-making principles.",
          expected_memory_categories: ["principle", "communication_style"],
          suggested_source_type: "owner_answer",
        }),
      ],
    });
    writeMemoryFile(
      server.memPath,
      "profile.md",
      "- Ignacio leads engineering teams [confidence: high]",
    );

    const result = await callTool(server.client, "suggest_question", {
      goal: "learn_principles",
      topic: "technical leadership",
      previous_questions: ["What do you do?"],
    });

    expect(result.structuredContent).toMatchObject({
      question: "Which engineering principles guide your technical decisions?",
      purpose: "Learn durable decision-making principles.",
      expected_memory_categories: ["principle", "communication_style"],
      suggested_source_type: "owner_answer",
    });
    expect(server.llm.calls).toHaveLength(1);
    expect(server.llm.calls[0].prompt).toContain("technical leadership");
  });

  it("falls back to the bootstrap question when suggest_question receives invalid LLM output", async () => {
    const server = await startTestServer({ responses: ["not json"] });
    writeMemoryFile(
      server.memPath,
      "profile.md",
      "- Ignacio leads engineering teams [confidence: high]",
    );

    const result = await callTool(server.client, "suggest_question", {
      goal: "fill_gaps",
    });

    expect(result.structuredContent?.suggested_source_type).toBe("owner_answer");
    expect(firstText(result)).toContain("Build an initial identity");
    expect(server.llm.calls).toHaveLength(1);
  });

  it("ingests content through MCP, writes memory, and records source metadata", async () => {
    const extraction = {
      items: [
        memoryItem("profile", "Ignacio leads engineering and product teams."),
        memoryItem("preference", "Ignacio prefers concise engineering communication."),
        memoryItem("communication_style", "Ignacio communicates directly and pragmatically."),
      ],
    };
    const server = await startTestServer({ responses: [JSON.stringify(extraction)] });

    const result = await callTool(server.client, "ingest", {
      content: "I lead engineering and product teams. I prefer concise communication.",
      source_type: "owner_answer",
      source_title: "Initial owner answer",
      source_date: "2026-04-30",
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      memory_items_added: 3,
      memory_items_updated: 0,
      ignored_items: 0,
    });
    expect(readMemoryFile(server.memPath, "profile.md")).toContain(
      "- Ignacio leads engineering and product teams. [confidence: high]",
    );
    expect(readMemoryFile(server.memPath, "preferences.md")).toContain(
      "- Ignacio prefers concise engineering communication. [confidence: high]",
    );
    expect(readMemoryFile(server.memPath, "communication_style.md")).toContain(
      "- Ignacio communicates directly and pragmatically. [confidence: high]",
    );

    const sources = readSources(server.memPath);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      title: "Initial owner answer",
      type: "owner_answer",
      date: "2026-04-30",
    });
    expect(sources[0].content_hash).toHaveLength(16);
  });

  it("detects duplicate ingested content through MCP without calling the LLM again", async () => {
    const content = "I prefer async written updates and direct technical discussion.";
    const server = await startTestServer({
      responses: [
        JSON.stringify({
          items: [memoryItem("preference", "Ignacio prefers async written updates.")],
        }),
      ],
    });

    const first = await callTool(server.client, "ingest", {
      content,
      source_type: "owner_answer",
      source_title: "Preference answer",
    });
    const second = await callTool(server.client, "ingest", {
      content,
      source_type: "owner_answer",
      source_title: "Duplicate preference answer",
    });

    expect(first.structuredContent?.memory_items_added).toBe(1);
    expect(second.structuredContent).toMatchObject({
      success: true,
      memory_items_added: 0,
      memory_items_updated: 0,
      ignored_items: 0,
    });
    expect(firstText(second)).toContain("duplicate content hash");
    expect(server.llm.calls).toHaveLength(1);
    expect(readSources(server.memPath)).toHaveLength(1);
    expect(readMemoryFile(server.memPath, "preferences.md").match(/^- /gm)).toHaveLength(1);
  });

  it("returns a successful no-op with warnings when ingest extraction output is malformed", async () => {
    const server = await startTestServer({ responses: ["not json"] });

    const result = await callTool(server.client, "ingest", {
      content: "This should not produce parseable extraction output.",
      source_type: "note",
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      memory_items_added: 0,
      memory_items_updated: 0,
      ignored_items: 0,
    });
    expect(result.structuredContent?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("did not return valid memory items")]),
    );
    expect(existsSync(join(server.memPath, "sources.json"))).toBe(false);
  });

  it("returns an ingest failure response when the LLM fails", async () => {
    const server = await startTestServer({ responses: [new Error("model unavailable")] });

    const result = await callTool(server.client, "ingest", {
      content: "I lead engineering teams.",
      source_type: "owner_answer",
    });

    expect(result.structuredContent).toMatchObject({
      success: false,
      memory_items_added: 0,
      memory_items_updated: 0,
      ignored_items: 0,
      summary: "LLM inference failed during memory extraction.",
    });
    expect(result.structuredContent?.warnings).toEqual(["LLM error: model unavailable"]);
    expect(result.isError).toBeUndefined();
  });

  it("returns insufficient memory from ask without calling the LLM", async () => {
    const server = await startTestServer();
    writeMemoryFile(
      server.memPath,
      "profile.md",
      "- Ignacio leads engineering teams [confidence: high]",
    );

    const result = await callTool(server.client, "ask", {
      question: "What does Ignacio do?",
      audience: "owner",
    });

    expect(result.structuredContent).toMatchObject({
      confidence: "low",
      authority: "insufficient_memory",
    });
    expect(firstText(result)).toContain("I do not have enough memory");
    expect(server.llm.calls).toHaveLength(0);
  });

  it("answers through MCP after enough memory exists and returns structured content", async () => {
    const server = await startTestServer({
      responses: ["Ignacio leads engineering teams and prefers direct communication."],
    });
    writeMemoryFile(
      server.memPath,
      "profile.md",
      "- Ignacio leads engineering teams [confidence: high]",
    );
    writeMemoryFile(
      server.memPath,
      "facts.md",
      "- Ignacio works on local-first tools [confidence: high]",
    );
    writeMemoryFile(
      server.memPath,
      "preferences.md",
      "- Ignacio prefers direct communication [confidence: high]",
    );

    const result = await callTool(server.client, "ask", {
      question: "How should I describe Ignacio?",
      audience: "owner",
    });

    expect(result.structuredContent).toMatchObject({
      answer: "Ignacio leads engineering teams and prefers direct communication.",
      confidence: "medium",
      authority: "memory_backed",
    });
    expect(result.structuredContent?.used_memory).toEqual(
      expect.arrayContaining([
        "Ignacio leads engineering teams",
        "Ignacio prefers direct communication",
      ]),
    );
    expect(server.llm.calls).toHaveLength(1);
  });

  it("excludes private memory for public and unknown audiences when configured", async () => {
    const server = await startTestServer({
      responses: ["Only public-safe memory was used."],
    });
    writeMemoryFile(
      server.memPath,
      "profile.md",
      "- Ignacio leads engineering teams [confidence: high]",
    );
    writeMemoryFile(
      server.memPath,
      "facts.md",
      "- Ignacio works on local-first tools [confidence: high]",
    );
    writeMemoryFile(
      server.memPath,
      "private.md",
      "- Ignacio has a private compensation target [confidence: high]",
    );

    await callTool(server.client, "ask", {
      question: "What should the public know?",
      audience: "public",
    });

    expect(server.llm.calls).toHaveLength(1);
    expect(server.llm.calls[0].system).toContain("Ignacio leads engineering teams");
    expect(server.llm.calls[0].system).not.toContain("private compensation target");
  });

  it("adds inference warnings for likely_opinion answers when configured", async () => {
    const server = await startTestServer({
      responses: ["Inferred: Ignacio would likely prefer a pragmatic technical plan."],
    });
    writeMemoryFile(
      server.memPath,
      "profile.md",
      "- Ignacio leads engineering teams [confidence: high]",
    );
    writeMemoryFile(
      server.memPath,
      "facts.md",
      "- Ignacio works on local-first tools [confidence: high]",
    );
    writeMemoryFile(
      server.memPath,
      "preferences.md",
      "- Ignacio prefers pragmatic technical plans [confidence: high]",
    );

    const result = await callTool(server.client, "ask", {
      question: "What would Ignacio think about this plan?",
      mode: "likely_opinion",
      audience: "owner",
    });

    expect(result.structuredContent).toMatchObject({
      confidence: "medium",
      authority: "inferred",
    });
    expect(result.structuredContent?.warnings).toEqual([
      "This is an inferred answer based on stored memory, not a direct statement from the owner.",
    ]);
    expect(firstText(result)).toContain("Note:");
  });

  it("logs MCP tool calls when debug logging is enabled", async () => {
    const debugLogger = new CapturingDebugLogger();
    const server = await startTestServer({ debugLogger });

    await callTool(server.client, "suggest_question", {
      goal: "build_initial_memory",
    });

    expect(debugLogger.events).toHaveLength(2);
    expect(debugLogger.events[0]).toEqual({
      event: "mcp.tool.start",
      details: {
        tool: "suggest_question",
        input: { goal: "build_initial_memory" },
      },
    });
    expect(debugLogger.events[1].event).toBe("mcp.tool.end");
    expect(debugLogger.events[1].details).toMatchObject({
      tool: "suggest_question",
      status: "ok",
      isError: false,
      structuredContent: {
        suggested_source_type: "owner_answer",
      },
    });
    expect(debugLogger.events[1].details?.durationMs).toEqual(expect.any(Number));
  });
});

async function startTestServer(
  options: {
    responses?: LlmResponse[];
    config?: Partial<Config>;
    debugLogger?: DebugLogger;
  } = {},
): Promise<RunningTestServer> {
  const memPath = createMemoryDir();
  const llm = new QueueLlmProvider(options.responses);
  const config = makeConfig(memPath, options.config);
  const mcpServer = createServer(llm, config, options.debugLogger);
  const serverTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(serverTransport);

  const httpServer = createHttpServer(async (req, res) => {
    if (req.url === "/mcp") {
      await serverTransport.handleRequest(req, res);
      return;
    }
    res.writeHead(404).end("Not found");
  });
  await listen(httpServer);

  const address = httpServer.address() as AddressInfo;
  const client = new Client({ name: "personalmcp-test", version: "1.0.0" });
  const clientTransport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`),
  );
  await client.connect(clientTransport);

  const runningServer: RunningTestServer = {
    client,
    llm,
    memPath,
    close: async () => {
      await client.close();
      await mcpServer.close();
      await closeHttpServer(httpServer);
      rmSync(memPath, { recursive: true, force: true });
    },
  };
  runningServers.push(runningServer);
  return runningServer;
}

function createMemoryDir(): string {
  const memPath = mkdtempSync(join(tmpdir(), "personalmcp-test-"));
  for (const [filename, heading] of Object.entries(MEMORY_FILES)) {
    writeFileSync(join(memPath, filename), `# ${heading}\n`, "utf-8");
  }
  return memPath;
}

function makeConfig(memPath: string, overrides: Partial<Config> = {}): Config {
  return {
    server: { port: 0 },
    owner: {
      name: null,
      preferred_language: null,
      ...overrides.owner,
    },
    llm: {
      provider: "test",
      model: "test",
      model_path: "/tmp/test-model.gguf",
      temperature: 0.2,
      max_tokens: 1200,
      ...overrides.llm,
    },
    memory: {
      path: memPath,
      ...overrides.memory,
    },
    safety: {
      allow_first_person: true,
      public_can_access_private_memory: false,
      require_disclaimer_for_inferred_answers: true,
      ...overrides.safety,
    },
  };
}

function listen(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  return (await client.callTool({
    name,
    arguments: args,
  })) as {
    content: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

function memoryItem(category: string, content: string) {
  return {
    category,
    content,
    confidence: "high",
    evidence: content,
    sensitivity: "personal",
    update_type: "add",
  };
}

function writeMemoryFile(memPath: string, filename: string, body: string): void {
  const heading = MEMORY_FILES[filename] ?? filename.replace(/\.md$/, "");
  writeFileSync(join(memPath, filename), `# ${heading}\n${body}\n`, "utf-8");
}

function readMemoryFile(memPath: string, filename: string): string {
  return readFileSync(join(memPath, filename), "utf-8");
}

function readSources(memPath: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(join(memPath, "sources.json"), "utf-8")) as Array<
    Record<string, unknown>
  >;
}
