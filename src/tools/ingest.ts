import { buildExtractionSystem, buildExtractionUser } from "../prompts/extractMemoryPrompt.js";
import { parseExtractedMemory } from "../memory/extractMemory.js";
import { mergeMemoryItems } from "../memory/mergeMemory.js";
import {
  buildSourceRecord,
  addSourceRecord,
  isDuplicateSource,
  hashContent,
} from "../memory/sourceIndex.js";
import { requireMemoryDatabase } from "../memory/storage.js";
import type { LlmProvider } from "../llm/LlmProvider.js";
import type { IngestInput, IngestOutput, Config } from "../types.js";

const DEFAULT_CONTEXT_TOKENS = 4096;
const INGEST_CONTEXT_SAFETY_TOKENS = 256;
const APPROX_CHARS_PER_TOKEN = 4;

export async function handleIngest(
  input: IngestInput,
  llm: LlmProvider,
  config: Config,
): Promise<IngestOutput> {
  const warnings: string[] = [];
  const db = requireMemoryDatabase(config);

  // Dedup check
  const contentHash = hashContent(input.content);
  if (isDuplicateSource(db, contentHash)) {
    return {
      success: true,
      memory_items_added: 0,
      memory_items_updated: 0,
      ignored_items: 0,
      summary: "This content has already been ingested (duplicate content hash). No changes made.",
      warnings: ["Duplicate content detected. Skipped."],
    };
  }

  const system = buildExtractionSystem();
  const sizeCheck = checkIngestSize(input, system, config);
  if (!sizeCheck.ok) {
    return {
      success: false,
      memory_items_added: 0,
      memory_items_updated: 0,
      ignored_items: 0,
      summary: "The provided content is too large for one ingest call.",
      warnings: [
        sizeCheck.reason,
        "Split the source into smaller thematic chunks such as contact info, work experience, education, skills, projects, and preferences, then ingest each chunk separately.",
      ],
    };
  }
  const prompt = buildExtractionUser(input.content, input.source_type, input.instructions);

  let llmOutput: string;
  try {
    const result = await llm.generate({
      system,
      prompt,
      temperature: 0.1,
      maxTokens: config.llm.max_tokens,
    });
    llmOutput = result.text;
  } catch (err) {
    return {
      success: false,
      memory_items_added: 0,
      memory_items_updated: 0,
      ignored_items: 0,
      summary: "LLM inference failed during memory extraction.",
      warnings: [`LLM error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const items = parseExtractedMemory(llmOutput);

  if (items.length === 0) {
    warnings.push(
      "The LLM did not return valid memory items. The content may not contain extractable personal information, or the model output could not be parsed.",
    );
    return {
      success: true,
      memory_items_added: 0,
      memory_items_updated: 0,
      ignored_items: 0,
      summary: "No memory items were extracted from the provided content.",
      warnings,
    };
  }

  // Check for sensitive items and add warnings
  const sensitiveItems = items.filter(
    (i) => i.sensitivity === "private" || i.sensitivity === "sensitive",
  );
  if (sensitiveItems.length > 0) {
    warnings.push(`${sensitiveItems.length} sensitive item(s) were stored in private memory.`);
  }

  const { added, updated, ignored } = mergeMemoryItems(db, items);

  // Record the source
  const record = buildSourceRecord(
    db,
    input.content,
    input.source_title,
    input.source_type,
    input.source_date,
    items.map((_, i) => `mem_${contentHash}_${i}`),
  );
  addSourceRecord(db, record);

  const summary = buildIngestSummary(added, updated, ignored, input.source_title);

  return {
    success: true,
    memory_items_added: added,
    memory_items_updated: updated,
    ignored_items: ignored,
    summary,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function checkIngestSize(
  input: IngestInput,
  systemPrompt: string,
  config: Config,
): { ok: true } | { ok: false; reason: string } {
  const contextTokens = config.llm.context_tokens ?? DEFAULT_CONTEXT_TOKENS;
  const outputTokens = config.llm.max_tokens;
  const promptWithoutContent = buildExtractionUser("", input.source_type, input.instructions);
  const fixedPromptTokens =
    estimateTokens(systemPrompt) +
    estimateTokens(promptWithoutContent) +
    INGEST_CONTEXT_SAFETY_TOKENS;
  const availableContentTokens = contextTokens - outputTokens - fixedPromptTokens;
  const estimatedContentTokens = estimateTokens(input.content);

  if (availableContentTokens <= 0) {
    return {
      ok: false,
      reason:
        `The configured LLM budget leaves no room for ingest content ` +
        `(${contextTokens} context tokens, ${outputTokens} reserved output tokens).`,
    };
  }

  if (estimatedContentTokens <= availableContentTokens) return { ok: true };

  return {
    ok: false,
    reason:
      `Estimated ingest content size is ${estimatedContentTokens} tokens, which exceeds the ` +
      `${availableContentTokens}-token safe input budget for this model configuration. ` +
      `Keep each chunk under about ${availableContentTokens * APPROX_CHARS_PER_TOKEN} characters.`,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

function buildIngestSummary(
  added: number,
  updated: number,
  ignored: number,
  title?: string,
): string {
  const source = title ? `"${title}"` : "the provided content";
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} new memory item${added !== 1 ? "s" : ""} added`);
  if (updated > 0) parts.push(`${updated} item${updated !== 1 ? "s" : ""} updated`);
  if (ignored > 0) parts.push(`${ignored} item${ignored !== 1 ? "s" : ""} ignored`);

  if (parts.length === 0) return `Processed ${source}. No new memory was extracted.`;
  return `Processed ${source}. ${parts.join(", ")}.`;
}
