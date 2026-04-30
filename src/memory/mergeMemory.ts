import { writeMemoryItems } from "./writeMemory.js";
import type { MemoryItem, MergeResult, MemoryDatabase } from "../types.js";

function isDuplicate(db: MemoryDatabase, item: MemoryItem): boolean {
  const key = item.content.toLowerCase().slice(0, 80);
  const results = db.searchRecords(item.content.slice(0, 80), 5);
  return results.some((r) => {
    const existing = r.text.toLowerCase();
    return existing.includes(key) || key.includes(existing.slice(0, 80));
  });
}

export function mergeMemoryItems(
  db: MemoryDatabase,
  newItems: MemoryItem[],
  sourceId?: string,
): MergeResult {
  const toWrite: MemoryItem[] = [];
  let added = 0;
  let updated = 0;
  let ignored = 0;

  for (const item of newItems) {
    if (item.update_type === "ignore" || item.category === "ignore") {
      ignored++;
      continue;
    }

    if (item.update_type === "update") {
      toWrite.push(item);
      updated++;
    } else if (isDuplicate(db, item)) {
      ignored++;
    } else {
      toWrite.push({ ...item, update_type: "add" });
      added++;
    }
  }

  writeMemoryItems(db, toWrite, sourceId);
  return { added, updated, ignored };
}
