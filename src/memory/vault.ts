import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VAULT_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const KDF_NAME = "scrypt";
const KEY_LENGTH = 32;
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
};
const VERIFICATION_TEXT = "aiprofile-vault-verification";

export interface Vault {
  key: Buffer;
  created: boolean;
  metadataPath: string;
}

interface VaultMetadata {
  version: number;
  algorithm: typeof ALGORITHM;
  kdf: {
    name: typeof KDF_NAME;
    salt: string;
    key_length: number;
    N: number;
    r: number;
    p: number;
  };
  verification: {
    iv: string;
    auth_tag: string;
    ciphertext: string;
  };
}

export function vaultMetadataPath(memPath: string): string {
  return join(memPath, "vault.json");
}

export function unlockOrCreateVault(memPath: string, password: string): Vault {
  if (!password) {
    throw new Error("A memory password is required for encrypted memory.");
  }

  const metadataPath = vaultMetadataPath(memPath);
  if (!existsSync(metadataPath)) {
    const metadata = createVaultMetadata(password);
    mkdirSync(memPath, { recursive: true });
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
    return {
      key: deriveKey(password, metadata),
      created: true,
      metadataPath,
    };
  }

  const metadata = readVaultMetadata(metadataPath);
  const key = deriveKey(password, metadata);
  verifyVault(key, metadata);
  return {
    key,
    created: false,
    metadataPath,
  };
}

export function hasVault(memPath: string): boolean {
  return existsSync(vaultMetadataPath(memPath));
}

function createVaultMetadata(password: string): VaultMetadata {
  const salt = randomBytes(16);
  const metadata: VaultMetadata = {
    version: VAULT_VERSION,
    algorithm: ALGORITHM,
    kdf: {
      name: KDF_NAME,
      salt: salt.toString("base64"),
      key_length: KEY_LENGTH,
      ...SCRYPT_PARAMS,
    },
    verification: {
      iv: "",
      auth_tag: "",
      ciphertext: "",
    },
  };
  const key = deriveKey(password, metadata);
  metadata.verification = encryptVerification(key);
  return metadata;
}

function readVaultMetadata(metadataPath: string): VaultMetadata {
  let metadata: VaultMetadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as VaultMetadata;
  } catch {
    throw new Error(`Cannot read encrypted memory vault metadata at ${metadataPath}.`);
  }

  if (
    metadata.version !== VAULT_VERSION ||
    metadata.algorithm !== ALGORITHM ||
    metadata.kdf?.name !== KDF_NAME ||
    metadata.kdf.key_length !== KEY_LENGTH
  ) {
    throw new Error(`Encrypted memory vault metadata at ${metadataPath} is unsupported.`);
  }
  return metadata;
}

function deriveKey(password: string, metadata: VaultMetadata): Buffer {
  return scryptSync(password, Buffer.from(metadata.kdf.salt, "base64"), metadata.kdf.key_length, {
    N: metadata.kdf.N,
    r: metadata.kdf.r,
    p: metadata.kdf.p,
  });
}

function encryptVerification(key: Buffer): VaultMetadata["verification"] {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(VERIFICATION_TEXT, "utf-8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function verifyVault(key: Buffer, metadata: VaultMetadata): void {
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(metadata.verification.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(metadata.verification.auth_tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(metadata.verification.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf-8");
    if (plaintext !== VERIFICATION_TEXT) throw new Error("Verification text mismatch.");
  } catch {
    throw new Error("Cannot unlock encrypted memory. The password is incorrect.");
  }
}
