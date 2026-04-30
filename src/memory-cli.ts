import { loadConfig } from "./config.js";
import { initializeMemoryStorage, parseCliOptions } from "./memory/unlock.js";
import { requireMemoryDatabase } from "./memory/storage.js";
import { exportAsMarkdown, exportAsJsonl, importFromMarkdown, importFromJsonl } from "./memory/export.js";
import { readFileSync } from "node:fs";

async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    process.exit(0);
  }

  if (subcommand !== "export" && subcommand !== "import") {
    console.error(`Unknown subcommand: ${subcommand}`);
    printHelp();
    process.exit(1);
  }

  // Parse options after subcommand
  const rest = args.slice(1);
  const cliOptions = parseCliOptions(
    rest.filter((a) => a.startsWith("--debug") || a.startsWith("--password")),
  );

  const config = loadConfig();
  await initializeMemoryStorage(config, cliOptions);
  const db = requireMemoryDatabase(config);

  if (subcommand === "export") {
    const formatArg = rest.find((a) => a.startsWith("--format="))?.split("=")[1];
    const format = formatArg === "jsonl" ? "jsonl" : "markdown";

    const output = format === "jsonl" ? exportAsJsonl(db) : exportAsMarkdown(db);
    process.stdout.write(output);

  } else if (subcommand === "import") {
    const formatArg = rest.find((a) => a.startsWith("--format="))?.split("=")[1];
    const filePath = rest.find((a) => !a.startsWith("--"));

    if (!filePath) {
      console.error("Error: import requires a file path.");
      process.exit(1);
    }

    const input = readFileSync(filePath, "utf-8");
    const format = formatArg === "jsonl" ? "jsonl" : "markdown";
    const count = format === "jsonl"
      ? importFromJsonl(db, input)
      : importFromMarkdown(db, input);

    console.error(`Imported ${count} records.`);
  }
}

function printHelp() {
  console.error(`
PersonalMCP Memory CLI

Usage:
  node dist/memory-cli.js <subcommand> [options]

Subcommands:
  export              Export memory to stdout
    --format=markdown  (default) Export as Markdown
    --format=jsonl     Export as JSON Lines

  import <file>       Import memory from a file
    --format=markdown  (default) Import from Markdown
    --format=jsonl     Import from JSON Lines

Global options:
  --password-file=<path>  Read memory password from file
  --debug                 Enable debug logging
`);
}

main().catch((err) => {
  console.error("[memory-cli] Fatal error:", err);
  process.exit(1);
});
