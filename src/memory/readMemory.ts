import type { MemoryStorage } from "../types.js";

const MEMORY_FILES: Record<string, string> = {
  "profile.md": "Profile",
  "facts.md": "Facts",
  "preferences.md": "Preferences",
  "principles.md": "Principles",
  "opinions.md": "Opinions",
  "communication_style.md": "Communication Style",
  "private.md": "Private",
};

export function readAllMemory(storage: MemoryStorage, excludePrivate = false): string {
  const parts: string[] = [];

  for (const [filename, label] of Object.entries(MEMORY_FILES)) {
    if (excludePrivate && filename === "private.md") continue;

    if (!storage.exists(filename)) continue;

    const content = storage.readText(filename).trim();
    const lines = content.split("\n").filter((l) => l.trim().startsWith("-"));
    if (lines.length === 0) continue;

    parts.push(`## ${label}\n${lines.join("\n")}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

export function countMemoryItems(storage: MemoryStorage): number {
  let count = 0;
  for (const filename of Object.keys(MEMORY_FILES)) {
    if (!storage.exists(filename)) continue;
    const content = storage.readText(filename);
    count += content.split("\n").filter((l) => l.trim().startsWith("-")).length;
  }
  return count;
}
