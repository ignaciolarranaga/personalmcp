import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MemoryStorage } from "../types.js";
import type { Config } from "../types.js";

const ENVELOPE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

interface EncryptedEnvelope {
  version: number;
  algorithm: typeof ALGORITHM;
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

export function createPlainMemoryStorage(memPath: string): MemoryStorage {
  return {
    exists(filename) {
      return existsSync(join(memPath, filename));
    },
    readText(filename) {
      return readFileSync(join(memPath, filename), "utf-8");
    },
    writeText(filename, content) {
      const filePath = join(memPath, filename);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, "utf-8");
    },
    rawPath(filename) {
      return join(memPath, filename);
    },
  };
}

export function createEncryptedMemoryStorage(memPath: string, key: Buffer): MemoryStorage {
  return {
    exists(filename) {
      return existsSync(encryptedPath(memPath, filename));
    },
    readText(filename) {
      const filePath = encryptedPath(memPath, filename);
      const raw = readFileSync(filePath, "utf-8");
      return decryptText(raw, key, filePath);
    },
    writeText(filename, content) {
      const filePath = encryptedPath(memPath, filename);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, encryptText(content, key), "utf-8");
    },
    rawPath(filename) {
      return encryptedPath(memPath, filename);
    },
  };
}

export function requireMemoryStorage(config: Config): MemoryStorage {
  if (config.memory.storage) return config.memory.storage;
  if ((config.memory.mode ?? "encrypted") === "plain") {
    return createPlainMemoryStorage(config.memory.path);
  }
  throw new Error("Encrypted memory storage has not been unlocked.");
}

function encryptedPath(memPath: string, filename: string): string {
  return join(memPath, `${filename}.enc`);
}

function encryptText(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function decryptText(raw: string, key: Buffer, filePath: string): string {
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(raw) as EncryptedEnvelope;
  } catch {
    throw new Error(`Encrypted memory file ${filePath} is not valid JSON.`);
  }

  if (envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== ALGORITHM) {
    throw new Error(`Encrypted memory file ${filePath} uses an unsupported encryption format.`);
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.auth_tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf-8");
  } catch {
    throw new Error(
      `Cannot decrypt ${filePath}. The password may be wrong, or the file may be corrupted.`,
    );
  }
}
