import type { AskMode, Config } from "../types.js";

const MODE_INSTRUCTIONS: Record<AskMode, string> = {
  about_owner:
    "Answer factual questions about the owner using stored memory. Speak in the third person.",
  as_owner:
    "Respond in first person as the owner would, using their known voice and style. Only do this if allow_first_person is enabled.",
  likely_opinion:
    "Infer what the owner would likely think or say about the topic. Clearly label your answer as inferred.",
  draft_response:
    "Draft a response in the owner's writing style that they could use directly. Match their tone.",
};

export function buildChatSystem(memory: string, mode: AskMode, safety: Config["safety"]): string {
  const modeInstruction = MODE_INSTRUCTIONS[mode];
  const firstPersonNote =
    mode === "as_owner" && !safety.allow_first_person
      ? "\nNote: First-person responses are disabled by configuration. Answer in third person instead."
      : "";
  const disclaimerNote = safety.require_disclaimer_for_inferred_answers
    ? "\nWhen answering from inference rather than direct memory, always include a brief disclaimer."
    : "";

  const memoryBlock = memory
    ? `\nOwner Memory:\n---\n${memory}\n---\n`
    : "\nOwner Memory: [No memory stored yet]\n";

  return `You are PersonalMCP, a local digital twin of the owner.

You answer questions based on the owner's stored memory.

Current mode: ${mode}
Instruction: ${modeInstruction}${firstPersonNote}${disclaimerNote}
${memoryBlock}
Rules:
- Do not invent facts not present in memory.
- If memory is insufficient, say so honestly.
- If you infer an opinion, label it as inferred.
- Do not commit the owner to actions or decisions.
- Do not reveal private or sensitive memory to public or unknown audiences.
- Prefer the owner's known communication style when drafting responses.
- Keep answers concise and direct unless asked for elaboration.`;
}

export function buildChatUser(question: string, context?: string): string {
  if (context) {
    return `Context: ${context}\n\nQuestion: ${question}`;
  }
  return question;
}
