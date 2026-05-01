#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(distDir, "index.js");
const result = spawnSync(process.execPath, [indexPath, "setup-model", ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
