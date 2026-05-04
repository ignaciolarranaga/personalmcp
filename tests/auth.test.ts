import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  anonymousMemoryAccess,
  defaultAuthResource,
  deriveAuthSigningKey,
  issueLocalAuthToken,
  memoryAccessFromScopes,
  verifyLocalAuthToken,
} from "../src/auth.js";
import { unlockOrCreateVault } from "../src/memory/vault.js";
import type { Config } from "../src/types.js";

describe("local auth tokens", () => {
  it("issues and validates a scoped vault-signed token", () => {
    const memPath = mkdtempSync(join(tmpdir(), "aiprofile-auth-"));
    try {
      const config = makeConfig(memPath);
      const vault = unlockOrCreateVault(memPath, "vault password");
      const signingKey = deriveAuthSigningKey(vault.key);
      const token = issueLocalAuthToken(signingKey, config, {
        scopes: ["aiprofile:ingest", "aiprofile:ask"],
        expiresIn: "30d",
        resource: defaultAuthResource(config),
      });

      const authInfo = verifyLocalAuthToken(token, signingKey, config, defaultAuthResource(config));

      expect(authInfo.scopes).toEqual(["aiprofile:ask", "aiprofile:ingest"]);
      expect(authInfo.clientId).toBe("owner");
    } finally {
      rmSync(memPath, { recursive: true, force: true });
    }
  });

  it("rejects expired and wrong-resource tokens", () => {
    const memPath = mkdtempSync(join(tmpdir(), "aiprofile-auth-"));
    try {
      const config = makeConfig(memPath);
      const vault = unlockOrCreateVault(memPath, "vault password");
      const signingKey = deriveAuthSigningKey(vault.key);
      const expired = issueLocalAuthToken(signingKey, config, {
        scopes: ["aiprofile:ask"],
        expiresIn: "0s",
        resource: defaultAuthResource(config),
      });
      const wrongResource = issueLocalAuthToken(signingKey, config, {
        scopes: ["aiprofile:ask"],
        expiresIn: "30d",
        resource: "http://localhost:9999/mcp",
      });

      expect(() =>
        verifyLocalAuthToken(expired, signingKey, config, defaultAuthResource(config)),
      ).toThrow("Token has expired");
      expect(() =>
        verifyLocalAuthToken(wrongResource, signingKey, config, defaultAuthResource(config)),
      ).toThrow("Token resource is not valid");
    } finally {
      rmSync(memPath, { recursive: true, force: true });
    }
  });

  it("maps anonymous and scoped memory access", () => {
    expect(anonymousMemoryAccess()).toEqual({
      includeVisibility: ["normal"],
      kind: ["profile", "fact", "summary"],
    });
    expect(
      memoryAccessFromScopes([
        "memory:read:public",
        "memory:read:personal",
        "memory:read:kind:profile",
        "memory:read:kind:preference",
      ]),
    ).toEqual({
      includeVisibility: ["normal", "sensitive"],
      kind: ["profile", "preference"],
    });
  });
});

function makeConfig(memPath: string): Config {
  return {
    server: { port: 3000 },
    auth: { mode: "local", anonymous_enabled: true },
    owner: { name: null, preferred_language: null },
    llm: {
      provider: "test",
      model: "test",
      model_path: "/tmp/test-model.gguf",
      temperature: 0.2,
      max_tokens: 1200,
    },
    memory: { path: memPath, mode: "encrypted" },
    safety: {
      allow_first_person: true,
      public_can_access_private_memory: false,
      require_disclaimer_for_inferred_answers: true,
    },
  };
}
