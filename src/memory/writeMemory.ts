import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { MemoryItem, MemoryCategory } from "../types.js";

const CATEGORY_FILE: Record<Exclude<MemoryCategory, "ignore">, string> = {
  profile: "profile.md",
  fact: "facts.md",
  preference: "preferences.md",
  principle: "principles.md",
  opinion: "opinions.md",
  communication_style: "communication_style.md",
  private: "private.md",
};

const CATEGORY_HEADING: Record<Exclude<MemoryCategory, "ignore">, string> = {
  profile: "Profile",
  fact: "Facts",
  preference: "Preferences",
  principle: "Principles",
  opinion: "Opinions",
  communication_style: "Communication Style",
  private: "Private",
};

function formatItem(item: MemoryItem): string {
  return `- ${item.content} [confidence: ${item.confidence}]`;
}

export function writeMemoryItems(
  memPath: string,
  items: MemoryItem[]
): { written: number } {
  const byCategory = new Map<Exclude<MemoryCategory, "ignore">, MemoryItem[]>();

  for (const item of items) {
    if (item.category === "ignore") continue;
    const cat = item.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }

  let written = 0;

  for (const [cat, catItems] of byCategory) {
    const filename = CATEGORY_FILE[cat];
    const filePath = join(memPath, filename);
    const heading = `# ${CATEGORY_HEADING[cat]}`;

    let content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : `${heading}\n`;

    for (const item of catItems) {
      if (item.update_type === "ignore") continue;

      const newLine = formatItem(item);

      if (item.update_type === "update") {
        // Replace the first line that contains the same content prefix
        const lines = content.split("\n");
        let replaced = false;
        const updated = lines.map((line) => {
          if (!replaced && line.startsWith("- ") && lineMatchesItem(line, item)) {
            replaced = true;
            return newLine;
          }
          return line;
        });
        if (replaced) {
          content = updated.join("\n");
        } else {
          content = content.trimEnd() + "\n" + newLine + "\n";
        }
      } else {
        content = content.trimEnd() + "\n" + newLine + "\n";
      }

      written++;
    }

    writeFileSync(filePath, content, "utf-8");
  }

  return { written };
}

function lineMatchesItem(line: string, item: MemoryItem): boolean {
  const lineContent = line.replace(/^- /, "").replace(/\s*\[confidence:.*\]$/, "").toLowerCase();
  const itemContent = item.content.toLowerCase();
  // Match if either contains the other (first ~60 chars)
  const key = itemContent.slice(0, 60);
  return lineContent.includes(key) || key.includes(lineContent.slice(0, 60));
}
