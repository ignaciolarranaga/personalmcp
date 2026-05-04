import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { createMemoryDatabase } from "./db.js";
import { hasVault, unlockOrCreateVault } from "./vault.js";
import type { Config } from "../types.js";

export interface MemoryUnlockOptions {
  debugEnabled: boolean;
  passwordFile?: string;
}

export interface MemoryStorageInitialization {
  vaultKey?: Buffer;
  vaultCreated: boolean;
}

export type CliOptions = MemoryUnlockOptions;

export function parseCliOptions(argv: string[]): MemoryUnlockOptions {
  const options: MemoryUnlockOptions = {
    debugEnabled: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--debug") {
      options.debugEnabled = true;
      continue;
    }
    if (arg === "--password-file") {
      const value = argv[i + 1];
      if (!value) throw new Error("--password-file requires a file path.");
      options.passwordFile = value;
      i++;
      continue;
    }
    if (arg.startsWith("--password-file=")) {
      options.passwordFile = arg.slice("--password-file=".length);
      if (!options.passwordFile) throw new Error("--password-file requires a file path.");
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export async function initializeMemoryStorage(
  config: Config,
  options: MemoryUnlockOptions,
): Promise<MemoryStorageInitialization> {
  const mode = config.memory.mode ?? "encrypted";

  if (mode === "plain") {
    config.memory.storage = createMemoryDatabase({ memPath: config.memory.path, mode: "plain" });
    return { vaultCreated: false };
  }

  const password = await resolveMemoryPassword(config.memory.path, options);
  const vault = unlockOrCreateVault(config.memory.path, password);
  config.memory.storage = createMemoryDatabase({
    memPath: config.memory.path,
    key: vault.key,
    mode: "encrypted",
  });

  if (vault.created) {
    console.error(`[AIProfile] Initialized encrypted memory vault at ${vault.metadataPath}`);
  }

  return { vaultKey: vault.key, vaultCreated: vault.created };
}

export async function resolveMemoryPassword(
  memPath: string,
  options: MemoryUnlockOptions,
): Promise<string> {
  if (process.env.AIPROFILE_PASSWORD) return process.env.AIPROFILE_PASSWORD;

  if (options.passwordFile) {
    return readFileSync(options.passwordFile, "utf-8").trimEnd();
  }

  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      "Encrypted memory requires a password. Set AIPROFILE_PASSWORD or use --password-file.",
    );
  }

  if (hasVault(memPath)) return promptPassword("Memory password: ");

  const password = await promptPassword("Create memory password: ");
  const confirmation = await promptPassword("Confirm memory password: ");
  if (password !== confirmation) {
    throw new Error("Memory passwords did not match.");
  }
  if (!password) {
    throw new Error("Memory password cannot be empty.");
  }
  return password;
}

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const mutedOutput = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const rl = createInterface({
      input: process.stdin,
      output: mutedOutput,
      terminal: true,
    });
    process.stderr.write(prompt);
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}
