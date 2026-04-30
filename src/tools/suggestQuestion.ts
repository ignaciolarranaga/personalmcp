import { buildSuggestSystem, buildSuggestUser } from "../prompts/suggestQuestionPrompt.js";
import { readAllMemory, countMemoryItems } from "../memory/readMemory.js";
import { requireMemoryDatabase } from "../memory/storage.js";
import type { LlmProvider } from "../llm/LlmProvider.js";
import type {
  SuggestQuestionInput,
  SuggestQuestionOutput,
  Config,
  MemoryCategory,
} from "../types.js";

const BOOTSTRAP_QUESTION: SuggestQuestionOutput = {
  question:
    "What should I know about who you are, the kind of work you do, and how you would want me to represent you when someone asks about you?",
  purpose: "Build an initial identity and professional context memory from the owner's own words.",
  expected_memory_categories: ["profile", "fact", "preference", "communication_style"],
  suggested_source_type: "owner_answer",
};

const VALID_CATEGORIES = new Set<string>([
  "profile",
  "fact",
  "preference",
  "principle",
  "opinion",
  "communication_style",
  "private",
]);

export async function handleSuggestQuestion(
  input: SuggestQuestionInput,
  llm: LlmProvider,
  config: Config,
): Promise<SuggestQuestionOutput> {
  const db = requireMemoryDatabase(config);
  const itemCount = countMemoryItems(db);

  // Use hardcoded bootstrap when memory is empty
  if (itemCount === 0 && (!input.goal || input.goal === "build_initial_memory")) {
    return BOOTSTRAP_QUESTION;
  }

  const memory = readAllMemory(db, true);
  const system = buildSuggestSystem(memory);
  const prompt = buildSuggestUser(input.goal, input.topic, input.previous_questions);

  let llmOutput: string;
  try {
    const result = await llm.generate({
      system,
      prompt,
      temperature: 0.4,
      maxTokens: 500,
    });
    llmOutput = result.text;
  } catch {
    return BOOTSTRAP_QUESTION;
  }

  const parsed = parseSuggestOutput(llmOutput);
  if (!parsed) return BOOTSTRAP_QUESTION;

  return parsed;
}

interface RawSuggestOutput {
  question?: string;
  purpose?: string;
  expected_memory_categories?: string[];
  suggested_source_type?: string;
}

function parseSuggestOutput(llmOutput: string): SuggestQuestionOutput | null {
  const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: RawSuggestOutput;
  try {
    parsed = JSON.parse(jsonMatch[0]) as RawSuggestOutput;
  } catch {
    return null;
  }

  if (!parsed.question?.trim() || !parsed.purpose?.trim()) return null;

  const categories = (parsed.expected_memory_categories ?? []).filter(
    (c): c is Exclude<MemoryCategory, "ignore"> => VALID_CATEGORIES.has(c) && c !== "ignore",
  );

  return {
    question: parsed.question.trim(),
    purpose: parsed.purpose.trim(),
    expected_memory_categories: categories.length > 0 ? categories : ["profile"],
    suggested_source_type: "owner_answer",
  };
}
