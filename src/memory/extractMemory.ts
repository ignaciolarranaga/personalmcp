import type { MemoryItem, MemoryCategory, Confidence, Sensitivity, UpdateType } from "../types.js";

interface RawMemoryItem {
  category?: string;
  content?: string;
  confidence?: string;
  evidence?: string;
  sensitivity?: string;
  update_type?: string;
}

const VALID_CATEGORIES = new Set<MemoryCategory>([
  "profile", "fact", "preference", "principle", "opinion",
  "communication_style", "private", "ignore",
]);

const VALID_CONFIDENCE = new Set<Confidence>(["low", "medium", "high"]);
const VALID_SENSITIVITY = new Set<Sensitivity>(["public", "personal", "private", "sensitive"]);
const VALID_UPDATE_TYPE = new Set<UpdateType>(["add", "update", "ignore"]);

function normalizeCategory(raw?: string): MemoryCategory {
  if (raw && VALID_CATEGORIES.has(raw as MemoryCategory)) return raw as MemoryCategory;
  // map plural forms
  if (raw === "facts") return "fact";
  if (raw === "preferences") return "preference";
  if (raw === "principles") return "principle";
  if (raw === "opinions") return "opinion";
  if (raw === "profiles") return "profile";
  return "ignore";
}

export function parseExtractedMemory(llmOutput: string): MemoryItem[] {
  // Strip markdown code fences if present
  const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  let parsed: { items?: RawMemoryItem[] };
  try {
    parsed = JSON.parse(jsonMatch[0]) as { items?: RawMemoryItem[] };
  } catch {
    return [];
  }

  if (!Array.isArray(parsed?.items)) return [];

  const items: MemoryItem[] = [];

  for (const raw of parsed.items) {
    const category = normalizeCategory(raw.category);
    if (category === "ignore") continue;

    const update_type = VALID_UPDATE_TYPE.has(raw.update_type as UpdateType)
      ? (raw.update_type as UpdateType)
      : "add";
    if (update_type === "ignore") continue;

    if (!raw.content?.trim()) continue;

    items.push({
      category,
      content: raw.content.trim(),
      confidence: VALID_CONFIDENCE.has(raw.confidence as Confidence)
        ? (raw.confidence as Confidence)
        : "medium",
      evidence: raw.evidence?.trim(),
      sensitivity: VALID_SENSITIVITY.has(raw.sensitivity as Sensitivity)
        ? (raw.sensitivity as Sensitivity)
        : "personal",
      update_type,
    });
  }

  return items;
}
