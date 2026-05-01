#!/usr/bin/env node
import { createCliProgram, runCliProgram } from "./cli.js";
import { exportMemory, importMemory } from "./memory.js";
import { startServer } from "./serve.js";
import { setupModel } from "./setup-model.js";

const program = createCliProgram({
  serve: startServer,
  exportMemory,
  importMemory,
  setupModel,
});

runCliProgram(program, process.argv.slice(2)).catch((err) => {
  console.error(`[AIProfile] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
