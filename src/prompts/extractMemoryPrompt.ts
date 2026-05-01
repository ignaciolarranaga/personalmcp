import type { SourceType } from "../types.js";

export function buildExtractionSystem(): string {
  return `You are a memory extraction system for AIProfile, a local digital twin server.

Your job is to extract durable memory items from personal content provided by the owner.

The memory you extract will be stored and used to answer questions about the owner later.

Extract only durable, meaningful information. Avoid temporary details, small talk, or irrelevant context.

Classify each memory item as one of:
- profile: high-level identity, name, role, bio
- fact: stable facts like work history, projects, skills, education
- preference: preferences about communication, work, technology, collaboration
- principle: decision-making heuristics, beliefs, leadership or engineering principles
- opinion: views on specific topics, technologies, or practices
- communication_style: how the owner tends to write and communicate
- private: sensitive information like compensation, personal matters, health
- ignore: temporary context, unimportant details, things not about the owner

Output ONLY a valid JSON object in this exact format, with no other text before or after:
{
  "items": [
    {
      "category": "profile|fact|preference|principle|opinion|communication_style|private|ignore",
      "content": "concise memory statement about the owner",
      "confidence": "low|medium|high",
      "evidence": "short quote or paraphrase from source",
      "sensitivity": "public|personal|private|sensitive",
      "update_type": "add|update|ignore"
    }
  ]
}

Rules:
- Do not invent information not present in the content.
- Prefer concise, factual memory statements.
- Separate facts from inferred opinions.
- Mark compensation, health, and very personal details as private.
- Use update_type "ignore" for items that should not be stored.
- Use update_type "update" only when the content explicitly supersedes something previously known.
- Output only the JSON object. No markdown, no commentary.`;
}

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  owner_answer: "direct answer from the owner",
  chat_transcript: "chat conversation transcript",
  document: "document",
  note: "personal note",
  article: "article written by the owner",
  video_transcript: "video transcript",
  audio_transcript: "audio transcript",
  other: "personal content",
};

export function buildExtractionUser(
  content: string,
  sourceType?: SourceType,
  instructions?: string,
): string {
  const sourceLabel = sourceType ? SOURCE_TYPE_LABELS[sourceType] : "personal content";
  const instructionBlock = instructions
    ? `\nAdditional instructions from the owner: ${instructions}\n`
    : "";

  return `Extract memory from the following ${sourceLabel}.${instructionBlock}

Content:
---
${content}
---

Extract all durable memory items and return them as JSON.`;
}
