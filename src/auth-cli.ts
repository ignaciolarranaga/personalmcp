import { loadConfig } from "./config.js";
import {
  defaultAuthResource,
  deriveAuthSigningKey,
  issueLocalAuthToken,
  parseExpiresIn,
} from "./auth.js";
import { hasVault, unlockOrCreateVault } from "./memory/vault.js";
import { resolveMemoryPassword, type MemoryUnlockOptions } from "./memory/unlock.js";

export interface AuthTokenOptions extends MemoryUnlockOptions {
  scopes: string[];
  expiresIn: string;
  resource?: string;
}

export async function issueAuthToken(options: AuthTokenOptions): Promise<void> {
  const config = loadConfig();
  const mode = config.memory.mode ?? "encrypted";
  if (mode !== "encrypted") {
    throw new Error("Local auth token issuance requires encrypted memory mode.");
  }
  if (!hasVault(config.memory.path)) {
    throw new Error("Cannot issue an auth token before the encrypted memory vault exists.");
  }
  if (options.scopes.length === 0) {
    throw new Error("At least one --scope value is required.");
  }

  parseExpiresIn(options.expiresIn);
  const password = await resolveMemoryPassword(config.memory.path, options);
  const vault = unlockOrCreateVault(config.memory.path, password);
  const token = issueLocalAuthToken(deriveAuthSigningKey(vault.key), config, {
    scopes: options.scopes,
    expiresIn: options.expiresIn,
    resource: options.resource ?? defaultAuthResource(config),
  });

  process.stdout.write(`${token}\n`);
}
