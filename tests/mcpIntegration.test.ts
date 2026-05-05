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
import type { ServerAccessMode } from "../src/server.js";
import { createMemoryDatabase } from "../src/memory/db.js";
import { initializeMemoryStorage, parseCliOptions } from "../src/memory/unlock.js";
import { unlockOrCreateVault } from "../src/memory/vault.js";
import type { DebugLogger } from "../src/debug.js";
import type {
  Config,
  GenerateInput,
  GenerateOutput,
  MemoryDatabase,
  MemoryKind,
} from "../src/types.js";
import type { LlmProvider } from "../src/llm/LlmProvider.js";

type LlmResponse = string | Error | ((input: GenerateInput) => string);

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
  db: MemoryDatabase;
  close: () => Promise<void>;
}

const runningServers: RunningTestServer[] = [];

afterEach(async () => {
  const servers = runningServers.splice(0);
  await Promise.all(servers.map((server) => server.close()));
});

describe("MCP integration", () => {
  it("advertises the package version through MCP server info", async () => {
    const server = await startTestServer();

    expect(server.client.getServerVersion()).toMatchObject({
      name: "aiprofile",
      version: readPackageVersion(),
    });
  });

  it("exposes the expected tools through MCP listTools", async () => {
    const server = await startTestServer();

    const result = await server.client.listTools();
    const toolNames = result.tools.map((tool) => tool.name).sort();

    expect(toolNames).toEqual(["ask", "ingest", "suggest_question"]);
    expect(result.tools.find((tool) => tool.name === "ingest")?.inputSchema).toBeDefined();
  });

  it("anonymous MCP surface exposes only public-safe tools", async () => {
    const server = await startTestServer({ accessMode: "anonymous" });

    const result = await server.client.listTools();
    const toolNames = result.tools.map((tool) => tool.name).sort();

    expect(toolNames).toEqual(["ask"]);
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
    writeMemoryRecord(server.db, "profile", "Ignacio leads engineering teams", 0.9);

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
    writeMemoryRecord(server.db, "profile", "Ignacio leads engineering teams", 0.9);

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

    const profileRecords = server.db.queryRecords({ status: "active", kind: ["profile"] });
    expect(
      profileRecords.some((r) => r.text.includes("Ignacio leads engineering and product teams.")),
    ).toBe(true);

    const prefRecords = server.db.queryRecords({ status: "active", kind: ["preference"] });
    expect(
      prefRecords.some((r) =>
        r.text.includes("Ignacio prefers concise engineering communication."),
      ),
    ).toBe(true);

    const styleRecords = server.db.queryRecords({
      status: "active",
      kind: ["communication_style"],
    });
    expect(
      styleRecords.some((r) => r.text.includes("Ignacio communicates directly and pragmatically.")),
    ).toBe(true);

    const sources = server.db.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      title: "Initial owner answer",
      type: "owner_answer",
      date: "2026-04-30",
    });
    expect(sources[0].content_hash).toHaveLength(16);
  });

  it("extracts memory from third-person document content instead of silently adding zero items", async () => {
    const documentContent = [
      "Ignacio Larranaga is a software engineer who leads engineering and product teams.",
      "He works on local-first AI profile tooling and prefers concise technical communication.",
    ].join(" ");
    const server = await startTestServer({
      responses: [
        (input) => {
          const promptIncludesDocumentGuidance =
            input.prompt.includes("third person") &&
            input.prompt.includes("refer to the owner by name or pronouns") &&
            input.prompt.includes("memory about the owner");

          if (!promptIncludesDocumentGuidance) return JSON.stringify({ items: [] });

          return JSON.stringify({
            items: [
              memoryItem("profile", "Ignacio Larranaga leads engineering and product teams."),
              memoryItem("fact", "Ignacio Larranaga works on local-first AI profile tooling."),
              memoryItem(
                "preference",
                "Ignacio Larranaga prefers concise technical communication.",
              ),
            ],
          });
        },
      ],
    });

    const result = await callTool(server.client, "ingest", {
      content: documentContent,
      source_type: "document",
      source_title: "Resume PDF",
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      memory_items_added: 3,
      memory_items_updated: 0,
      ignored_items: 0,
    });
    expect(server.llm.calls).toHaveLength(1);
    expect(server.llm.calls[0].prompt).toContain("Extract memory from the following document.");

    const records = server.db.queryRecords({ status: "active" });
    expect(records.map((record) => record.text)).toEqual(
      expect.arrayContaining([
        "Ignacio Larranaga leads engineering and product teams.",
        "Ignacio Larranaga works on local-first AI profile tooling.",
        "Ignacio Larranaga prefers concise technical communication.",
      ]),
    );

    expect(server.db.listSources()).toHaveLength(1);
    expect(server.db.listSources()[0]).toMatchObject({
      title: "Resume PDF",
      type: "document",
    });
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
    expect(server.db.listSources()).toHaveLength(1);

    const prefRecords = server.db.queryRecords({ status: "active", kind: ["preference"] });
    expect(prefRecords).toHaveLength(1);
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
    expect(server.db.listSources()).toHaveLength(0);
  });

  it("rejects oversized ingest content before calling the LLM", async () => {
    const largeResume = Array.from(
      { length: 160 },
      (_, i) =>
        `Experience item ${i}: Ignacio led engineering teams, built local-first AI tools, and worked across product strategy, architecture, delivery, and mentoring.`,
    ).join("\n");
    const server = await startTestServer({
      config: {
        llm: {
          context_tokens: 4096,
          max_tokens: 1200,
        },
      },
      responses: [
        JSON.stringify({
          items: [memoryItem("profile", "This should not be called.")],
        }),
      ],
    });

    const result = await callTool(server.client, "ingest", {
      content: largeResume,
      source_type: "document",
      source_title: "Full resume",
    });

    expect(result.structuredContent).toMatchObject({
      success: false,
      memory_items_added: 0,
      memory_items_updated: 0,
      ignored_items: 0,
      summary: "The provided content is too large for one ingest call.",
    });
    expect(result.structuredContent?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Estimated ingest content size"),
        expect.stringContaining("Split the source into smaller thematic chunks"),
      ]),
    );
    expect(firstText(result)).toContain("too large for one ingest call");
    expect(server.llm.calls).toHaveLength(0);
    expect(server.db.listSources()).toHaveLength(0);
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
    writeMemoryRecord(server.db, "profile", "Ignacio leads engineering teams", 0.9);

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
    writeMemoryRecord(server.db, "profile", "Ignacio leads engineering teams", 0.9);
    writeMemoryRecord(server.db, "fact", "Ignacio works on local-first tools", 0.9);
    writeMemoryRecord(server.db, "preference", "Ignacio prefers direct communication", 0.9);

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
    writeMemoryRecord(server.db, "profile", "Ignacio leads engineering teams", 0.9);
    writeMemoryRecord(server.db, "fact", "Ignacio works on local-first tools", 0.9);
    writeMemoryRecord(
      server.db,
      "private",
      "Ignacio has a private compensation target",
      0.9,
      "secret",
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
    writeMemoryRecord(server.db, "profile", "Ignacio leads engineering teams", 0.9);
    writeMemoryRecord(server.db, "fact", "Ignacio works on local-first tools", 0.9);
    writeMemoryRecord(server.db, "preference", "Ignacio prefers pragmatic technical plans", 0.9);

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

  it("initializes encrypted memory on first startup with an environment password", async () => {
    const memPath = mkdtempSync(join(tmpdir(), "aiprofile-encrypted-start-"));
    const originalPassword = process.env.AIPROFILE_PASSWORD;
    process.env.AIPROFILE_PASSWORD = "correct horse battery staple";
    try {
      const config = makeConfig(memPath, {
        memory: {
          path: memPath,
          mode: "encrypted",
        },
      });

      await initializeMemoryStorage(config, parseCliOptions([]));

      expect(existsSync(join(memPath, "vault.json"))).toBe(true);
      expect(config.memory.storage).toBeDefined();
      expect(config.memory.storage?.countRecords()).toBe(0);
    } finally {
      if (originalPassword === undefined) delete process.env.AIPROFILE_PASSWORD;
      else process.env.AIPROFILE_PASSWORD = originalPassword;
      rmSync(memPath, { recursive: true, force: true });
    }
  });

  it("unlocks encrypted memory with a password file and rejects the wrong password", async () => {
    const memPath = mkdtempSync(join(tmpdir(), "aiprofile-encrypted-unlock-"));
    const passwordFile = join(memPath, "password.txt");
    writeFileSync(passwordFile, "vault password\n", "utf-8");

    try {
      unlockOrCreateVault(memPath, "vault password");
      const config = makeConfig(memPath, {
        memory: {
          path: memPath,
          mode: "encrypted",
        },
      });

      await initializeMemoryStorage(config, parseCliOptions(["--password-file", passwordFile]));
      expect(config.memory.storage).toBeDefined();
      expect(() => unlockOrCreateVault(memPath, "wrong password")).toThrow(
        "Cannot unlock encrypted memory",
      );
    } finally {
      rmSync(memPath, { recursive: true, force: true });
    }
  });

  it("ingests and asks through encrypted memory without storing plaintext on disk", async () => {
    const memPath = mkdtempSync(join(tmpdir(), "aiprofile-encrypted-mcp-"));
    const vault = unlockOrCreateVault(memPath, "vault password");
    const db = createMemoryDatabase({ memPath, key: vault.key, mode: "encrypted" });
    const server = await startTestServer({
      memPath,
      db,
      config: {
        memory: {
          path: memPath,
          mode: "encrypted",
          storage: db,
        },
      },
      responses: [
        JSON.stringify({
          items: [
            memoryItem("profile", "Ignacio leads engineering teams."),
            memoryItem("fact", "Ignacio works on encrypted local memory."),
            memoryItem("preference", "Ignacio prefers direct communication."),
          ],
        }),
        "Encrypted memory was read successfully.",
      ],
    });

    await callTool(server.client, "ingest", {
      content: "I lead engineering teams and work on encrypted local memory.",
      source_type: "owner_answer",
    });

    const rawDb = readFileSync(join(memPath, "memory.db.enc"), "utf-8");
    expect(rawDb).not.toContain("Ignacio leads engineering teams");
    expect(existsSync(join(memPath, "memory.db"))).toBe(false);

    const result = await callTool(server.client, "ask", {
      question: "What does Ignacio work on?",
      audience: "owner",
    });

    expect(result.structuredContent?.answer).toBe("Encrypted memory was read successfully.");
  });
});

async function startTestServer(
  options: {
    responses?: LlmResponse[];
    config?: Partial<Config>;
    debugLogger?: DebugLogger;
    memPath?: string;
    db?: MemoryDatabase;
    accessMode?: ServerAccessMode;
  } = {},
): Promise<RunningTestServer> {
  const memPath = options.memPath ?? mkdtempSync(join(tmpdir(), "aiprofile-test-"));
  const db = options.db ?? createMemoryDatabase({ memPath, mode: "plain" });
  const llm = new QueueLlmProvider(options.responses);
  const config = makeConfig(memPath, {
    ...options.config,
    memory: { path: memPath, mode: "plain", storage: db, ...options.config?.memory },
  });
  const mcpServer = createServer(llm, config, options.debugLogger, {
    accessMode: options.accessMode,
  });
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
  const client = new Client({ name: "aiprofile-test", version: "1.0.0" });
  const clientTransport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`),
  );
  await client.connect(clientTransport);

  const runningServer: RunningTestServer = {
    client,
    llm,
    memPath,
    db,
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

function makeConfig(memPath: string, overrides: Partial<Config> = {}): Config {
  const db = overrides.memory?.storage ?? createMemoryDatabase({ memPath, mode: "plain" });
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
      mode: "plain",
      storage: db,
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

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json must define a string version.");
  }
  return packageJson.version;
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

function writeMemoryRecord(
  db: MemoryDatabase,
  kind: MemoryKind,
  text: string,
  confidence: number,
  visibility: "normal" | "sensitive" | "secret" = "normal",
): void {
  const now = new Date().toISOString();
  db.insertRecord({
    id: `mem_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind,
    text,
    tags: [],
    confidence,
    importance: 0.5,
    status: "active",
    visibility,
    created_at: now,
    updated_at: now,
  });
}
