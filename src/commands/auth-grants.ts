import { loadConfig } from "../config.js";
import {
  AUTH_SCOPE_PRESETS,
  createAuthGrant,
  revokeAuthGrant,
  type AuthScopePreset,
} from "../oauth.js";
import { initializeMemoryStorage, type MemoryUnlockOptions } from "../memory/unlock.js";

export interface AuthGrantAddOptions extends MemoryUnlockOptions {
  subject: string;
  label?: string;
  scopes: string[];
  presets: AuthScopePreset[];
  expiresIn: string;
  resource?: string;
}

export type AuthGrantListOptions = MemoryUnlockOptions;
export type AuthGrantRevokeOptions = MemoryUnlockOptions;

export async function addAuthGrant(options: AuthGrantAddOptions): Promise<void> {
  const config = loadConfig();
  await initializeMemoryStorage(config, options);
  if (!options.subject.trim()) throw new Error("--subject is required.");
  const db = config.memory.storage;
  if (!db) throw new Error("Memory database has not been initialized.");

  const { grant, approvalCode } = createAuthGrant(db, config, {
    subject: options.subject,
    label: options.label,
    scopes: options.scopes,
    presets: options.presets,
    resource: options.resource,
    expiresIn: options.expiresIn,
  });

  process.stdout.write(
    [
      `Grant: ${grant.id}`,
      `Subject: ${grant.subject}`,
      grant.label ? `Label: ${grant.label}` : null,
      `Code: ${approvalCode}`,
      `Resource: ${grant.resource}`,
      `Scopes: ${grant.scopes.join(" ")}`,
      grant.expires_at ? `Expires: ${grant.expires_at}` : null,
      "",
      "Use this one-time code on the AIProfile OAuth authorization page.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n") + "\n",
  );
}

export async function listAuthGrants(options: AuthGrantListOptions): Promise<void> {
  const config = loadConfig();
  await initializeMemoryStorage(config, options);
  const db = config.memory.storage;
  if (!db) throw new Error("Memory database has not been initialized.");
  const grants = db.listAuthGrants();
  if (grants.length === 0) {
    process.stdout.write("No auth grants.\n");
    return;
  }
  for (const grant of grants) {
    const status = grant.revoked_at
      ? `revoked ${grant.revoked_at}`
      : grant.expires_at && Date.parse(grant.expires_at) <= Date.now()
        ? `expired ${grant.expires_at}`
        : "active";
    process.stdout.write(
      [
        `${grant.id}  ${status}`,
        `  subject: ${grant.subject}`,
        grant.label ? `  label: ${grant.label}` : null,
        `  resource: ${grant.resource}`,
        `  scopes: ${grant.scopes.join(" ")}`,
        grant.expires_at ? `  expires: ${grant.expires_at}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n") + "\n",
    );
  }
}

export async function revokeAuthGrantById(
  grantId: string,
  options: AuthGrantRevokeOptions,
): Promise<void> {
  const config = loadConfig();
  await initializeMemoryStorage(config, options);
  const db = config.memory.storage;
  if (!db) throw new Error("Memory database has not been initialized.");
  const grant = revokeAuthGrant(db, grantId);
  process.stdout.write(`Revoked ${grant.id}\n`);
}

export function parseAuthScopePreset(value: string): AuthScopePreset {
  if (Object.hasOwn(AUTH_SCOPE_PRESETS, value)) return value as AuthScopePreset;
  throw new Error(
    `Unknown preset "${value}". Supported presets: ${Object.keys(AUTH_SCOPE_PRESETS).join(", ")}`,
  );
}
