import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { SourceRecord, SourceType } from "../types.js";

function sourcesPath(memPath: string): string {
  return join(memPath, "sources.json");
}

export function readSourceIndex(memPath: string): SourceRecord[] {
  const fp = sourcesPath(memPath);
  if (!existsSync(fp)) return [];
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as SourceRecord[];
  } catch {
    return [];
  }
}

export function addSourceRecord(memPath: string, record: SourceRecord): void {
  const records = readSourceIndex(memPath);
  records.push(record);
  writeFileSync(sourcesPath(memPath), JSON.stringify(records, null, 2), "utf-8");
}

export function generateSourceId(memPath: string, date: string): string {
  const records = readSourceIndex(memPath);
  const prefix = `src_${date.replace(/-/g, "_")}`;
  const count = records.filter((r) => r.id.startsWith(prefix)).length + 1;
  return `${prefix}_${String(count).padStart(3, "0")}`;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function isDuplicateSource(memPath: string, contentHash: string): boolean {
  const records = readSourceIndex(memPath);
  return records.some((r) => r.content_hash === contentHash);
}

export function buildSourceRecord(
  memPath: string,
  content: string,
  title: string | undefined,
  type: SourceType | undefined,
  date: string | undefined,
  memoryItemIds: string[]
): SourceRecord {
  const today = new Date().toISOString().slice(0, 10);
  const id = generateSourceId(memPath, today);
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
