import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  anonymousMemoryAccess,
  memoryAccessFromScopes,
  OPERATION_SCOPES,
  hasScopes,
} from "./auth.js";
import { handleIngest } from "./tools/ingest.js";
import { handleAsk } from "./tools/ask.js";
import { handleSuggestQuestion } from "./tools/suggestQuestion.js";
import { noopDebugLogger, type DebugLogger } from "./debug.js";
import type { LlmProvider } from "./llm/LlmProvider.js";
import type { Config } from "./types.js";

interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type ServerAccessMode = "full" | "anonymous" | "scoped";

export interface CreateServerOptions {
  accessMode?: ServerAccessMode;
}

export function createServer(
  llm: LlmProvider,
  config: Config,
  debugLogger: DebugLogger = noopDebugLogger,
  options: CreateServerOptions = {},
): McpServer {
  const accessMode = options.accessMode ?? (config.auth?.mode === "local" ? "scoped" : "full");
  const server = new McpServer({
    name: "aiprofile",
    version: "0.1.0",
  });

  registerAboutResource(server, config);

  // ── ingest ──────────────────────────────────────────────────────────────────
  if (accessMode !== "anonymous") {
    server.registerTool(
      "ingest",
      {
        title: "Ingest Content",
        description:
          "Process profile source material and update local memory. " +
          "Use this when you have a transcript, note, document, policy, or answer to feed into memory.",
        inputSchema: z.object({
          content: z.string().describe("The raw text content to ingest"),
          source_type: z
            .enum([
              "owner_answer",
              "chat_transcript",
              "document",
              "note",
              "article",
              "video_transcript",
              "audio_transcript",
              "other",
            ])
            .optional()
            .describe("Type of source content"),
          source_title: z.string().optional().describe("Human-readable title for this source"),
          source_date: z.string().optional().describe("Date of the source (YYYY-MM-DD)"),
          instructions: z
            .string()
            .optional()
            .describe("Optional instructions for memory extraction, e.g. 'focus on opinions'"),
        }),
      },
      withDebug(debugLogger, "ingest", async (args, extra) => {
        if (!isAuthorized(accessMode, extra, [OPERATION_SCOPES.ingest])) {
          return insufficientScope([OPERATION_SCOPES.ingest]);
        }
        try {
          const result = await handleIngest(args, llm, config);
          const text = [
            result.summary,
            result.warnings?.length ? `Warnings: ${result.warnings.join(" | ")}` : null,
            `Added: ${result.memory_items_added} | Updated: ${result.memory_items_updated} | Ignored: ${result.ignored_items}`,
          ]
            .filter(Boolean)
            .join("\n");
          return {
            content: [{ type: "text", text }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        } catch (err) {
          return {
            content: [
              { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
            ],
            isError: true,
          };
        }
      }),
    );
  }

  // ── ask ──────────────────────────────────────────────────────────────────────
  server.registerTool(
    "ask",
    {
      title: "Ask AIProfile",
      description:
        "Ask a question about the profile entity, or draft from that entity's perspective. " +
        "Returns an answer based on stored memory. " +
        "Use mode 'about_owner' for facts, 'likely_opinion' for inferred views, " +
        "'as_owner' for first-person responses, 'draft_response' to generate a reply.",
      inputSchema: z.object({
        question: z.string().describe("The question or request"),
        context: z.string().optional().describe("Optional extra context for the question"),
        mode: z
          .enum(["about_owner", "as_owner", "likely_opinion", "draft_response"])
          .optional()
          .default("about_owner")
          .describe(
            "How to answer: facts about the profile entity, from its perspective, as a likely opinion, or as a draft",
          ),
        audience: z
          .enum(["owner", "public", "trusted", "unknown"])
          .optional()
          .default("unknown")
          .describe("Intended audience — affects whether private memory is included"),
      }),
    },
    withDebug(debugLogger, "ask", async (args, extra) => {
      if (accessMode === "scoped" && !isAuthorized(accessMode, extra, [OPERATION_SCOPES.ask])) {
        return insufficientScope([OPERATION_SCOPES.ask]);
      }
      try {
        const askArgs =
          accessMode === "anonymous"
            ? { ...args, audience: "public" as const, mode: "about_owner" as const }
            : args;
        const memoryAccess =
          accessMode === "anonymous"
            ? anonymousMemoryAccess()
            : accessMode === "scoped"
              ? memoryAccessFromScopes(extra.authInfo?.scopes ?? [])
              : undefined;
        const result = await handleAsk(askArgs, llm, config, { memoryAccess });
        const text = [
          result.answer,
          result.warnings?.length ? `\nNote: ${result.warnings.join(" | ")}` : null,
          `\n[Confidence: ${result.confidence} | Authority: ${result.authority}]`,
        ]
          .filter(Boolean)
          .join("");
        return {
          content: [{ type: "text", text }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }),
  );

  // ── suggest_question ─────────────────────────────────────────────────────────
  if (accessMode !== "anonymous") {
    server.registerTool(
      "suggest_question",
      {
        title: "Suggest a Memory-Building Question",
        description:
          "Generate one useful question for the profile owner or maintainer to answer, " +
          "to help AIProfile build or improve its memory. The answer should be passed to ingest afterward.",
        inputSchema: z.object({
          goal: z
            .enum([
              "build_initial_memory",
              "improve_profile",
              "learn_preferences",
              "learn_principles",
              "learn_opinions",
              "learn_communication_style",
              "fill_gaps",
              "general",
            ])
            .optional()
            .describe("The kind of memory to improve"),
          topic: z.string().optional().describe("Optional topic to focus the question on"),
          audience: z
            .enum(["owner", "public", "trusted", "unknown"])
            .optional()
            .describe("Intended memory audience"),
          previous_questions: z
            .array(z.string())
            .optional()
            .describe("List of recently asked questions to avoid repetition"),
        }),
      },
      withDebug(debugLogger, "suggest_question", async (args, extra) => {
        if (!isAuthorized(accessMode, extra, [OPERATION_SCOPES.suggest])) {
          return insufficientScope([OPERATION_SCOPES.suggest]);
        }
        try {
          const result = await handleSuggestQuestion(args, llm, config);
          const text = [
            `Question: ${result.question}`,
            `Purpose: ${result.purpose}`,
            `Categories: ${result.expected_memory_categories.join(", ")}`,
            `How to use: Pass your answer to the ingest tool with source_type "owner_answer"`,
          ].join("\n");
          return {
            content: [{ type: "text", text }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        } catch (err) {
          return {
            content: [
              { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
            ],
            isError: true,
          };
        }
      }),
    );
  }

  return server;
}

function withDebug<TArgs>(
  logger: DebugLogger,
  toolName: string,
  handler: (args: TArgs, extra: ToolExtra) => Promise<ToolResponse>,
): (args: TArgs, extra: ToolExtra) => Promise<ToolResponse> {
  return async (args, extra) => {
    if (!logger.enabled) return handler(args, extra);

    const startedAt = Date.now();
    logger.log("mcp.tool.start", {
      tool: toolName,
      input: args,
    });

    try {
      const result = await handler(args, extra);
      logger.log("mcp.tool.end", {
        tool: toolName,
        status: result.isError ? "error" : "ok",
        durationMs: Date.now() - startedAt,
        isError: result.isError ?? false,
        structuredContent: result.structuredContent,
      });
      return result;
    } catch (err) {
      logger.log("mcp.tool.error", {
        tool: toolName,
        status: "error",
        durationMs: Date.now() - startedAt,
        error: err,
      });
      throw err;
    }
  };
}

function registerAboutResource(server: McpServer, config: Config): void {
  server.registerResource(
    "about",
    "aiprofile://about",
    {
      title: "About AIProfile",
      description: "Generic public information about this AIProfile server.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "aiprofile://about",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              name: "AIProfile",
              server: "aiprofile",
              owner: config.owner.name ?? null,
              preferred_language: config.owner.preferred_language ?? null,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}

function isAuthorized(accessMode: ServerAccessMode, extra: ToolExtra, scopes: string[]): boolean {
  if (accessMode === "full") return true;
  if (accessMode === "anonymous") return false;
  return !!extra.authInfo && hasScopes(extra.authInfo, scopes);
}

function insufficientScope(requiredScopes: string[]): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: `Error: insufficient_scope. Required scope: ${requiredScopes.join(" ")}`,
      },
    ],
    structuredContent: {
      error: "insufficient_scope",
      required_scopes: requiredScopes,
    },
    isError: true,
  };
}
