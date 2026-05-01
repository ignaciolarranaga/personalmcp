#!/usr/bin/env node
import { createCliProgram, runCliProgram } from "./cli.js";
import { exportMemory, importMemory } from "./memory.js";

const program = createCliProgram({
  serve: async () => {
    throw new Error("Use `aiprofile serve` to start the server.");
  },
  exportMemory,
  importMemory,
  setupModel: async () => {
    throw new Error("Use `aiprofile setup-model` to download a model.");
  },
});

await runCliProgram(program, ["memory", ...process.argv.slice(2)]).catch((err) => {
  console.error(`[AIProfile] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
