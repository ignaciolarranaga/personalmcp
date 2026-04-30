import { randomBytes } from "node:crypto";
import type { MemoryItem, MemoryRecord, MemoryDatabase, MemoryKind, Sensitivity } from "../types.js";

const CONFIDENCE_MAP: Record<string, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.9,
};

const VISIBILITY_MAP: Record<Sensitivity, MemoryRecord["visibility"]> = {
  public: "normal",
  personal: "sensitive",
  private: "secret",
  sensitive: "secret",
};

function generateId(): string {
  return `mem_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

function itemToRecord(item: MemoryItem, sourceId?: string): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: item.id ?? generateId(),
    kind: item.category as MemoryKind,
    text: item.content,
    tags: [],
    confidence: CONFIDENCE_MAP[item.confidence] ?? 0.5,
    importance: 0.5,
    source_id: sourceId,
    status: "active",
    visibility: VISIBILITY_MAP[item.sensitivity] ?? "normal",
    created_at: now,
    updated_at: now,
  };
}

export function writeMemoryItems(
  db: MemoryDatabase,
  items: MemoryItem[],
  sourceId?: string,
): { written: number } {
  let written = 0;

  for (const item of items) {
    if (item.update_type === "ignore" || item.category === "ignore") continue;

    if (item.update_type === "update") {
      const key = item.content.toLowerCase().slice(0, 60);
      const existing = db.queryRecords({ status: "active", kind: [item.category as MemoryKind] });
      const match = existing.find((r) => {
        const t = r.text.toLowerCase();
        return t.includes(key) || key.includes(t.slice(0, 60));
      });

      if (match) {
        db.updateRecord(match.id, {
          text: item.content,
          confidence: CONFIDENCE_MAP[item.confidence] ?? match.confidence,
          updated_at: new Date().toISOString(),
        });
      } else {
        db.insertRecord(itemToRecord(item, sourceId));
      }
    } else {
      db.insertRecord(itemToRecord(item, sourceId));
    }

    written++;
  }

  db.persist();
  return { written };
}
