import { createHash } from "node:crypto";
import type { MemoryDatabase, SourceRecord, SourceType } from "../types.js";

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function isDuplicateSource(db: MemoryDatabase, contentHash: string): boolean {
  return db.getSourceByHash(contentHash) !== null;
}

export function addSourceRecord(db: MemoryDatabase, record: SourceRecord): void {
  db.insertSource(record);
  db.persist();
}

export function buildSourceRecord(
  db: MemoryDatabase,
  content: string,
  title: string | undefined,
  type: SourceType | undefined,
  date: string | undefined,
  memoryItemIds: string[],
): SourceRecord {
  const today = new Date().toISOString().slice(0, 10);
  const prefix = `src_${today.replace(/-/g, "_")}`;
  const sources = db.listSources();
  const count = sources.filter((s) => s.id.startsWith(prefix)).length + 1;
  const id = `${prefix}_${String(count).padStart(3, "0")}`;

  return {
    id,
    title,
    type,
    date,
    created_at: new Date().toISOString(),
    content_hash: hashContent(content),
    memory_item_ids: memoryItemIds,
  };
}
