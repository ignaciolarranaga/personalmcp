import { createHash } from "crypto";
import type { MemoryStorage, SourceRecord, SourceType } from "../types.js";

const SOURCES_FILENAME = "sources.json";

export function readSourceIndex(storage: MemoryStorage): SourceRecord[] {
  if (!storage.exists(SOURCES_FILENAME)) return [];
  const content = storage.readText(SOURCES_FILENAME);
  try {
    return JSON.parse(content) as SourceRecord[];
  } catch {
    return [];
  }
}

export function addSourceRecord(storage: MemoryStorage, record: SourceRecord): void {
  const records = readSourceIndex(storage);
  records.push(record);
  storage.writeText(SOURCES_FILENAME, JSON.stringify(records, null, 2));
}

export function generateSourceId(storage: MemoryStorage, date: string): string {
  const records = readSourceIndex(storage);
  const prefix = `src_${date.replace(/-/g, "_")}`;
  const count = records.filter((r) => r.id.startsWith(prefix)).length + 1;
  return `${prefix}_${String(count).padStart(3, "0")}`;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function isDuplicateSource(storage: MemoryStorage, contentHash: string): boolean {
  const records = readSourceIndex(storage);
  return records.some((r) => r.content_hash === contentHash);
}

export function buildSourceRecord(
  storage: MemoryStorage,
  content: string,
  title: string | undefined,
  type: SourceType | undefined,
  date: string | undefined,
  memoryItemIds: string[]
): SourceRecord {
  const today = new Date().toISOString().slice(0, 10);
  const id = generateSourceId(storage, today);
  return {
    id,
    title,
    type,
    date,
    created_at: new Date().toISOString(),
    content_hash: hashContent(content),
    memory_items: memoryItemIds,
  };
}
