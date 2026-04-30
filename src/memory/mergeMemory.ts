import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { writeMemoryItems } from "./writeMemory.js";
import type { MemoryItem, MergeResult } from "../types.js";

function readExistingLines(memPath: string): string[] {
  const filenames = [
    "profile.md", "facts.md", "preferences.md", "principles.md",
    "opinions.md", "communication_style.md", "private.md",
  ];
  const lines: string[] = [];
  for (const f of filenames) {
    const fp = join(memPath, f);
    if (!existsSync(fp)) continue;
    const content = readFileSync(fp, "utf-8");
    for (const line of content.split("\n")) {
      if (line.trim().startsWith("- ")) {
        lines.push(line.trim().replace(/^- /, "").replace(/\s*\[confidence:.*\]$/, "").toLowerCase());
      }
    }
  }
  return lines;
}

function isDuplicate(item: MemoryItem, existingLines: string[]): boolean {
  const key = item.content.toLowerCase().slice(0, 80);
  return existingLines.some(
    (line) => line.includes(key) || key.includes(line.slice(0, 80))
  );
}

export function mergeMemoryItems(memPath: string, newItems: MemoryItem[]): MergeResult {
  const existing = readExistingLines(memPath);
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
    } else if (isDuplicate(item, existing)) {
      ignored++;
    } else {
      toWrite.push({ ...item, update_type: "add" });
      added++;
    }
  }

  writeMemoryItems(memPath, toWrite);
  return { added, updated, ignored };
}
