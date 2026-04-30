import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleIngest } from "./tools/ingest.js";
import { handleAsk } from "./tools/ask.js";
import { handleSuggestQuestion } from "./tools/suggestQuestion.js";
import type { LlmProvider } from "./llm/LlmProvider.js";
import type { Config } from "./types.js";

export function createServer(llm: LlmProvider, config: Config): McpServer {
  const server = new McpServer({
    name: "personalmcp",
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
    async (args) => {
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
    },
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
    async (args) => {
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
    },
  );

  // ── suggest_question ─────────────────────────────────────────────────────────
  server.registerTool(
    "suggest_question",
    {
      title: "Suggest a Memory-Building Question",
      description:
        "Generate one useful question for the owner to answer, to help PersonalMCP build or improve its memory. " +
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
    async (args) => {
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
    },
  );

  return server;
}
