#!/usr/bin/env node
import { createCliProgram, runCliProgram } from "./cli.js";
import { issueAuthToken } from "./commands/auth-token.js";
import { startServer } from "./commands/serve.js";
import { setupModel } from "./commands/setup-model.js";
import { exportMemory, importMemory } from "./memory.js";

const program = createCliProgram({
  serve: startServer,
  issueAuthToken,
  exportMemory,
  importMemory,
  setupModel,
});

runCliProgram(program, process.argv.slice(2)).catch((err) => {
  console.error(`[AIProfile] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
