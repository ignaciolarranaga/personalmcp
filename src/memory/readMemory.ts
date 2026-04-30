import type { MemoryDatabase, MemoryKind } from "../types.js";

const KIND_LABEL: Record<MemoryKind, string> = {
  profile: "Profile",
  fact: "Facts",
  preference: "Preferences",
  principle: "Principles",
  opinion: "Opinions",
  communication_style: "Communication Style",
  private: "Private",
  decision: "Decisions",
  instruction: "Instructions",
  summary: "Summaries",
  relationship: "Relationships",
};

const KIND_ORDER: MemoryKind[] = [
  "profile",
  "fact",
  "preference",
  "principle",
  "opinion",
  "communication_style",
  "decision",
  "instruction",
  "relationship",
  "summary",
  "private",
];

function confidenceLabel(score: number): string {
  if (score >= 0.75) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

export function readAllMemory(db: MemoryDatabase, excludePrivate = false): string {
  const excludeVisibility: string[] = excludePrivate ? ["secret"] : [];
  const records = db.queryRecords({ status: "active", excludeVisibility });

  const byKind = new Map<MemoryKind, string[]>();
  for (const record of records) {
    if (!byKind.has(record.kind)) byKind.set(record.kind, []);
    byKind.get(record.kind)!.push(
      `- ${record.text} [confidence: ${confidenceLabel(record.confidence)}]`,
    );
  }

  const parts: string[] = [];
  for (const kind of KIND_ORDER) {
    if (excludePrivate && kind === "private") continue;
    const lines = byKind.get(kind);
    if (!lines || lines.length === 0) continue;
    parts.push(`## ${KIND_LABEL[kind]}\n${lines.join("\n")}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

export function countMemoryItems(db: MemoryDatabase): number {
  return db.countRecords("active");
}
