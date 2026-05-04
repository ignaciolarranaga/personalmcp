import type { MemoryDatabase, MemoryKind, MemoryRecord } from "../types.js";

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

export interface MemoryReadAccess {
  includeVisibility?: MemoryRecord["visibility"][];
  kind?: MemoryKind[];
}

function confidenceLabel(score: number): string {
  if (score >= 0.75) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

export function readMemoryRecords(
  db: MemoryDatabase,
  access: boolean | MemoryReadAccess = false,
): MemoryRecord[] {
  if (typeof access === "boolean") {
    const excludeVisibility = access ? ["secret"] : [];
    return db.queryRecords({ status: "active", excludeVisibility });
  }

  return db.queryRecords({
    status: "active",
    includeVisibility: access.includeVisibility,
    kind: access.kind,
  });
}

export function readAllMemory(db: MemoryDatabase, access: boolean | MemoryReadAccess = false): string {
  const records = readMemoryRecords(db, access);

  const byKind = new Map<MemoryKind, string[]>();
  for (const record of records) {
    if (!byKind.has(record.kind)) byKind.set(record.kind, []);
    byKind.get(record.kind)!.push(
      `- ${record.text} [confidence: ${confidenceLabel(record.confidence)}]`,
    );
  }

  const parts: string[] = [];
  for (const kind of KIND_ORDER) {
    const lines = byKind.get(kind);
    if (!lines || lines.length === 0) continue;
    parts.push(`## ${KIND_LABEL[kind]}\n${lines.join("\n")}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

export function countMemoryItems(db: MemoryDatabase, access?: MemoryReadAccess): number {
  if (access) return readMemoryRecords(db, access).length;
  return db.countRecords("active");
}
