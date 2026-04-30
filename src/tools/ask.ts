import { buildChatSystem, buildChatUser } from "../prompts/chatPrompt.js";
import { readAllMemory, countMemoryItems } from "../memory/readMemory.js";
import { requireMemoryStorage } from "../memory/storage.js";
import type { LlmProvider } from "../llm/LlmProvider.js";
import type { AskInput, AskOutput, Config, Confidence, Authority } from "../types.js";

const INSUFFICIENT_MEMORY_THRESHOLD = 3;

export async function handleAsk(
  input: AskInput,
  llm: LlmProvider,
  config: Config,
): Promise<AskOutput> {
  const storage = requireMemoryStorage(config);
  const mode = input.mode ?? "about_owner";
  const audience = input.audience ?? "unknown";
  const excludePrivate =
    !config.safety.public_can_access_private_memory &&
    (audience === "public" || audience === "unknown");

  const itemCount = countMemoryItems(storage);
  if (itemCount < INSUFFICIENT_MEMORY_THRESHOLD) {
    return {
      answer:
        "I do not have enough memory about the owner yet to answer that reliably. " +
        "Try ingesting some personal content first, or use suggest_question to get a question to ask the owner.",
      confidence: "low",
      authority: "insufficient_memory",
      warnings: ["Memory is empty or minimal. Ingest content first to enable meaningful answers."],
    };
  }

  const memory = readAllMemory(storage, excludePrivate);
  const system = buildChatSystem(memory, mode, config.safety);
  const prompt = buildChatUser(input.question, input.context);

  let llmOutput: string;
  try {
    const result = await llm.generate({
      system,
      prompt,
      temperature: config.llm.temperature,
      maxTokens: config.llm.max_tokens,
    });
    llmOutput = result.text;
  } catch (err) {
    return {
      answer: "LLM inference failed. The local model may not be loaded.",
      confidence: "low",
      authority: "insufficient_memory",
      warnings: [`LLM error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const answer = llmOutput.trim();
  const authority = inferAuthority(answer, mode);
  const confidence = inferConfidence(itemCount, mode);
  const warnings: string[] = [];

  if (
    config.safety.require_disclaimer_for_inferred_answers &&
    (authority === "inferred" || mode === "likely_opinion")
  ) {
    warnings.push(
      "This is an inferred answer based on stored memory, not a direct statement from the owner.",
    );
  }

  return {
    answer,
    confidence,
    authority,
    used_memory: summarizeUsedMemory(memory),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function inferAuthority(answer: string, mode: string): Authority {
  const lower = answer.toLowerCase();
  if (
    lower.includes("insufficient") ||
    lower.includes("no memory") ||
    lower.includes("don't have")
  ) {
    return "insufficient_memory";
  }
  if (mode === "likely_opinion" || lower.includes("would likely") || lower.includes("inferred")) {
    return "inferred";
  }
  if (mode === "draft_response" || mode === "as_owner") {
    return "style_only";
  }
  return "memory_backed";
}

function inferConfidence(itemCount: number, mode: string): Confidence {
  if (itemCount < INSUFFICIENT_MEMORY_THRESHOLD) return "low";
  if (mode === "likely_opinion") return "medium";
  if (itemCount >= 10) return "high";
  return "medium";
}

function summarizeUsedMemory(memory: string): string[] {
  return memory
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .map((l) =>
      l
        .trim()
        .replace(/^- /, "")
        .replace(/\s*\[confidence:.*\]$/, ""),
    )
    .slice(0, 5);
}
