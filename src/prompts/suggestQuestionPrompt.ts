import type { MemoryGoal } from "../types.js";

const GOAL_INSTRUCTIONS: Record<MemoryGoal, string> = {
  build_initial_memory: "Ask a broad identity-building question since memory is empty or minimal.",
  improve_profile: "Focus on professional identity, current role, or public bio.",
  learn_preferences: "Focus on work, communication, or technology preferences.",
  learn_principles: "Focus on decision-making heuristics, leadership beliefs, or engineering principles.",
  learn_opinions: "Focus on views on specific topics, technologies, or practices.",
  learn_communication_style: "Focus on how the owner writes, communicates, or prefers to be represented.",
  fill_gaps: "Inspect the existing memory and ask about the most notable gap or underrepresented category.",
  general: "Generate a high-signal question that will build useful memory.",
};

export function buildSuggestSystem(memory: string): string {
  const memoryBlock = memory
    ? `\nExisting memory:\n---\n${memory}\n---\n`
    : "\nExisting memory: [empty — no memory stored yet]\n";

  return `You are PersonalMCP, a local digital twin assistant.

Your job is to generate one high-signal question for the owner to answer.

The owner's answer will later be ingested as memory to help you represent them better.
${memoryBlock}
Question selection rules:
- Choose questions that reveal durable memory: identity, preferences, principles, opinions, communication style.
- Avoid yes/no questions. Prefer open-ended questions.
- Avoid invasive or sensitive questions unless the goal specifically requires them.
- Avoid repeating questions already listed in previous_questions.
- When memory is empty, prefer broad identity-building questions.
- When memory exists, inspect it and ask about notable gaps or underrepresented categories.

Output ONLY a valid JSON object in this exact format, with no other text:
{
  "question": "the question to ask the owner",
  "purpose": "brief explanation of what memory this will produce",
  "expected_memory_categories": ["profile", "fact", "preference", "principle", "opinion", "communication_style"],
  "suggested_source_type": "owner_answer"
}`;
}

export function buildSuggestUser(
  goal?: MemoryGoal,
  topic?: string,
  previousQuestions?: string[]
): string {
  const goalInstruction = goal ? GOAL_INSTRUCTIONS[goal] : GOAL_INSTRUCTIONS["general"];
  const topicLine = topic ? `\nFocus topic: ${topic}` : "";
  const prevBlock =
    previousQuestions && previousQuestions.length > 0
      ? `\nAvoid repeating these previous questions:\n${previousQuestions.map((q) => `- ${q}`).join("\n")}`
      : "";

  return `Goal: ${goalInstruction}${topicLine}${prevBlock}

Generate one question for the owner and return it as JSON.`;
}
