#!/usr/bin/env node
import { createCliProgram, runCliProgram } from "./cli.js";
import { addAuthGrant, listAuthGrants, revokeAuthGrantById } from "./commands/auth-grants.js";
import { startServer } from "./commands/serve.js";
import { setupModel } from "./commands/setup-model.js";
import { exportMemory, importMemory } from "./memory.js";

const program = createCliProgram({
  serve: startServer,
  addAuthGrant,
  listAuthGrants,
  revokeAuthGrant: revokeAuthGrantById,
  exportMemory,
  importMemory,
  setupModel,
});

runCliProgram(program, process.argv.slice(2)).catch((err) => {
  console.error(`[AIProfile] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
