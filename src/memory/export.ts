import type { MemoryDatabase, MemoryRecord, MemoryKind } from "../types.js";

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

function confidenceLabel(score: number): string {
  if (score >= 0.75) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

export function exportAsMarkdown(db: MemoryDatabase): string {
  const records = db.queryRecords({ status: "active" });
  const byKind = new Map<MemoryKind, MemoryRecord[]>();

  for (const record of records) {
    if (!byKind.has(record.kind)) byKind.set(record.kind, []);
    byKind.get(record.kind)!.push(record);
  }

  const parts: string[] = [`# PersonalMCP Memory Export`, `_Exported: ${new Date().toISOString()}_`, ""];

  for (const [kind, recs] of byKind) {
    parts.push(`## ${KIND_LABEL[kind]}`);
    for (const r of recs) {
      parts.push(`- ${r.text} [confidence: ${confidenceLabel(r.confidence)}]`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

export function exportAsJsonl(db: MemoryDatabase): string {
  const records = db.queryRecords({ status: "active" });
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

const BULLET_RE = /^-\s+(.+?)\s*(?:\[confidence:\s*(low|medium|high)\])?$/i;
const HEADING_RE = /^##\s+(.+)$/;

const LABEL_TO_KIND: Record<string, MemoryKind> = {
  profile: "profile",
  facts: "fact",
  fact: "fact",
  preferences: "preference",
  preference: "preference",
  principles: "principle",
  principle: "principle",
  opinions: "opinion",
  opinion: "opinion",
  "communication style": "communication_style",
  private: "private",
  decisions: "decision",
  decision: "decision",
  instructions: "instruction",
  instruction: "instruction",
  summaries: "summary",
  summary: "summary",
  relationships: "relationship",
  relationship: "relationship",
};

const CONFIDENCE_MAP: Record<string, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.9,
};

export function importFromMarkdown(db: MemoryDatabase, input: string): number {
  const lines = input.split("\n");
  let currentKind: MemoryKind = "fact";
  let imported = 0;

  for (const line of lines) {
    const headingMatch = HEADING_RE.exec(line.trim());
    if (headingMatch) {
      const label = headingMatch[1].toLowerCase().trim();
      currentKind = LABEL_TO_KIND[label] ?? "fact";
      continue;
    }

    const bulletMatch = BULLET_RE.exec(line.trim());
    if (!bulletMatch) continue;

    const text = bulletMatch[1].trim();
    const confidenceStr = bulletMatch[2]?.toLowerCase() ?? "medium";
    const confidence = CONFIDENCE_MAP[confidenceStr] ?? 0.5;
    const now = new Date().toISOString();

    db.insertRecord({
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: currentKind,
      text,
      tags: [],
      confidence,
      importance: 0.5,
      status: "active",
      visibility: currentKind === "private" ? "secret" : "normal",
      created_at: now,
      updated_at: now,
    });
    imported++;
  }

  db.persist();
  return imported;
}

export function importFromJsonl(db: MemoryDatabase, input: string): number {
  const lines = input.split("\n").filter((l) => l.trim());
  let imported = 0;

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as MemoryRecord;
      db.insertRecord(record);
      imported++;
    } catch {
      // skip malformed lines
    }
  }

  db.persist();
  return imported;
}
