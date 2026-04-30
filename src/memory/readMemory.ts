import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const MEMORY_FILES: Record<string, string> = {
  "profile.md": "Profile",
  "facts.md": "Facts",
  "preferences.md": "Preferences",
  "principles.md": "Principles",
  "opinions.md": "Opinions",
  "communication_style.md": "Communication Style",
  "private.md": "Private",
};

export function readAllMemory(memPath: string, excludePrivate = false): string {
  const parts: string[] = [];

  for (const [filename, label] of Object.entries(MEMORY_FILES)) {
    if (excludePrivate && filename === "private.md") continue;

    const filePath = join(memPath, filename);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8").trim();
    const lines = content.split("\n").filter((l) => l.trim().startsWith("-"));
    if (lines.length === 0) continue;

    parts.push(`## ${label}\n${lines.join("\n")}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

export function countMemoryItems(memPath: string): number {
  let count = 0;
  for (const filename of Object.keys(MEMORY_FILES)) {
    const filePath = join(memPath, filename);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf-8");
    count += content.split("\n").filter((l) => l.trim().startsWith("-")).length;
  }
  return count;
}
