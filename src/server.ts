import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

type ToolHandler<TArgs> = (args: TArgs) => Promise<ToolResponse>;

export function createServer(
  llm: LlmProvider,
  config: Config,
  debugLogger: DebugLogger = noopDebugLogger,
): McpServer {
  const server = new McpServer({
    name: "aiprofile",
    version: "0.1.0",
  });

  // ── ingest ──────────────────────────────────────────────────────────────────
  server.registerTool(
    "ingest",
    {
      title: "Ingest Content",
      description:
        "Process personal content and update the owner's local memory. " +
        "Use this when you have a transcript, note, document, or answer to feed into memory.",
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
    withDebug(debugLogger, "ingest", async (args) => {
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

  // ── ask ──────────────────────────────────────────────────────────────────────
  server.registerTool(
    "ask",
    {
      title: "Ask the Digital Twin",
      description:
        "Ask a question about or as the owner. Returns an answer based on stored memory. " +
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
            "How to answer: about the owner, as the owner, as likely opinion, or as a draft",
          ),
        audience: z
          .enum(["owner", "public", "trusted", "unknown"])
          .optional()
          .default("unknown")
          .describe("Intended audience — affects whether private memory is included"),
      }),
    },
    withDebug(debugLogger, "ask", async (args) => {
      try {
        const result = await handleAsk(args, llm, config);
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
  server.registerTool(
    "suggest_question",
    {
      title: "Suggest a Memory-Building Question",
      description:
        "Generate one useful question for the owner to answer, to help AIProfile build or improve its memory. " +
        "The owner's answer should be passed to ingest afterward.",
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
    withDebug(debugLogger, "suggest_question", async (args) => {
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

  return server;
}

function withDebug<TArgs>(
  logger: DebugLogger,
  toolName: string,
  handler: ToolHandler<TArgs>,
): ToolHandler<TArgs> {
  return async (args) => {
    if (!logger.enabled) return handler(args);

    const startedAt = Date.now();
    logger.log("mcp.tool.start", {
      tool: toolName,
      input: args,
    });

    try {
      const result = await handler(args);
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
