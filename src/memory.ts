import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import {
  exportAsJsonl,
  exportAsMarkdown,
  importFromJsonl,
  importFromMarkdown,
} from "./memory/export.js";
import { requireMemoryDatabase } from "./memory/storage.js";
import { initializeMemoryStorage, type MemoryUnlockOptions } from "./memory/unlock.js";

export type MemoryFormat = "markdown" | "jsonl";

export interface MemoryOperationOptions extends MemoryUnlockOptions {
  format: MemoryFormat;
}

export async function exportMemory(options: MemoryOperationOptions): Promise<void> {
  const db = await initializeMemoryDatabase(options);
  const output = options.format === "jsonl" ? exportAsJsonl(db) : exportAsMarkdown(db);
  process.stdout.write(output);
}

export async function importMemory(
  filePath: string,
  options: MemoryOperationOptions,
): Promise<void> {
  const db = await initializeMemoryDatabase(options);
  const input = readFileSync(filePath, "utf-8");
  const count =
    options.format === "jsonl" ? importFromJsonl(db, input) : importFromMarkdown(db, input);

  console.error(`Imported ${count} records.`);
}

async function initializeMemoryDatabase(options: MemoryUnlockOptions) {
  const config = loadConfig();
  await initializeMemoryStorage(config, options);
  return requireMemoryDatabase(config);
}
