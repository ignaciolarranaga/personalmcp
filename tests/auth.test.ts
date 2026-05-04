import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  anonymousMemoryAccess,
  defaultAuthResource,
  deriveAuthSigningKey,
  memoryAccessFromScopes,
  verifyOAuthAccessToken,
} from "../src/auth.js";
import { createMemoryDatabase } from "../src/memory/db.js";
import { unlockOrCreateVault } from "../src/memory/vault.js";
import {
  createAuthGrant,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  hashOAuthSecret,
  normalizeAuthorizationRequest,
  refreshAccessToken,
  registerOAuthClient,
  revokeAuthGrant,
} from "../src/oauth.js";
import type { Config } from "../src/types.js";

describe("OAuth auth grants", () => {
  it("creates a grant and exchanges an authorization code for a grant-backed access token", () => {
    withAuthDb(({ config, db, signingKey }) => {
      const { grant, approvalCode } = createAuthGrant(db, config, {
        subject: "ignaciolarranaga",
        scopes: [],
        presets: ["owner-full"],
        expiresIn: "30d",
      });
      const client = registerOAuthClient(db, {
        client_name: "ChatGPT",
        redirect_uris: ["https://chatgpt.com/connector/oauth/test"],
      });
      const verifier = "a".repeat(64);
      const redirect = createAuthorizationCode(
        db,
        normalizeAuthorizationRequest(
          new URL(
            `http://localhost/oauth/authorize?response_type=code&client_id=${
              client.client_id
            }&redirect_uri=${encodeURIComponent(
              client.redirect_uris[0],
            )}&scope=${encodeURIComponent(
              "aiprofile:ask memory:read:public memory:read:kind:profile",
            )}&state=state-123&code_challenge=${pkceChallenge(
              verifier,
            )}&code_challenge_method=S256&resource=${encodeURIComponent(defaultAuthResource(config))}`,
          ),
        ),
        approvalCode,
      );
      const code = redirect.searchParams.get("code");
      expect(code).toBeTruthy();
      expect(redirect.searchParams.get("state")).toBe("state-123");

      const tokenResponse = exchangeAuthorizationCode(
        db,
        signingKey,
        config,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: code!,
          redirect_uri: client.redirect_uris[0],
          code_verifier: verifier,
          resource: defaultAuthResource(config),
        }),
      );

      const authInfo = verifyOAuthAccessToken(
        tokenResponse.access_token as string,
        signingKey,
        config,
        defaultAuthResource(config),
        db,
      );
      expect(authInfo.clientId).toBe(client.client_id);
      expect(authInfo.extra).toMatchObject({
        subject: "ignaciolarranaga",
        grantId: grant.id,
      });
      expect(authInfo.scopes).toEqual([
        "aiprofile:ask",
        "memory:read:kind:profile",
        "memory:read:public",
      ]);
      expect(tokenResponse.refresh_token).toEqual(expect.any(String));
    });
  });

  it("rejects reused approval codes and wrong-resource token validation", () => {
    withAuthDb(({ config, db, signingKey }) => {
      const { approvalCode } = createAuthGrant(db, config, {
        subject: "owner",
        scopes: ["aiprofile:ask"],
        presets: [],
        expiresIn: "30d",
      });
      const client = registerOAuthClient(db, { redirect_uris: ["http://localhost/callback"] });
      const verifier = "b".repeat(64);
      const request = normalizeAuthorizationRequest(
        new URL(
          `http://localhost/oauth/authorize?response_type=code&client_id=${
            client.client_id
          }&redirect_uri=${encodeURIComponent(
            client.redirect_uris[0],
          )}&scope=aiprofile%3Aask&code_challenge=${pkceChallenge(
            verifier,
          )}&code_challenge_method=S256&resource=${encodeURIComponent(defaultAuthResource(config))}`,
        ),
      );
      const redirect = createAuthorizationCode(db, request, approvalCode);
      expect(() => createAuthorizationCode(db, request, approvalCode)).toThrow(
        "Approval code was already used",
      );
      const tokenResponse = exchangeAuthorizationCode(
        db,
        signingKey,
        config,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: redirect.searchParams.get("code")!,
          redirect_uri: client.redirect_uris[0],
          code_verifier: verifier,
          resource: defaultAuthResource(config),
        }),
      );

      expect(() =>
        verifyOAuthAccessToken(
          tokenResponse.access_token as string,
          signingKey,
          config,
          "http://localhost:9999/mcp",
          db,
        ),
      ).toThrow("Token resource is not valid");
    });
  });

  it("rejects access tokens after their grant is revoked and supports refresh tokens", () => {
    withAuthDb(({ config, db, signingKey }) => {
      const { grant, approvalCode } = createAuthGrant(db, config, {
        subject: "owner",
        scopes: ["aiprofile:ask"],
        presets: [],
        expiresIn: "30d",
      });
      const client = registerOAuthClient(db, { redirect_uris: ["http://localhost/callback"] });
      const verifier = "c".repeat(64);
      const redirect = createAuthorizationCode(
        db,
        normalizeAuthorizationRequest(
          new URL(
            `http://localhost/oauth/authorize?response_type=code&client_id=${
              client.client_id
            }&redirect_uri=${encodeURIComponent(
              client.redirect_uris[0],
            )}&scope=aiprofile%3Aask&code_challenge=${pkceChallenge(
              verifier,
            )}&code_challenge_method=S256&resource=${encodeURIComponent(defaultAuthResource(config))}`,
          ),
        ),
        approvalCode,
      );
      const tokenResponse = exchangeAuthorizationCode(
        db,
        signingKey,
        config,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: redirect.searchParams.get("code")!,
          redirect_uri: client.redirect_uris[0],
          code_verifier: verifier,
          resource: defaultAuthResource(config),
        }),
      );

      const refreshed = refreshAccessToken(
        db,
        signingKey,
        config,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: tokenResponse.refresh_token as string,
          resource: defaultAuthResource(config),
        }),
      );
      expect(refreshed.access_token).toEqual(expect.any(String));

      revokeAuthGrant(db, grant.id);
      expect(() =>
        verifyOAuthAccessToken(
          tokenResponse.access_token as string,
          signingKey,
          config,
          defaultAuthResource(config),
          db,
        ),
      ).toThrow("Token grant is not active");
    });
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

  it("hashes approval codes before storing them", () => {
    withAuthDb(({ config, db }) => {
      const { approvalCode } = createAuthGrant(db, config, {
        subject: "owner",
        scopes: ["aiprofile:ask"],
        presets: [],
        expiresIn: "30d",
      });
      const grant = db.getAuthGrantByApprovalCodeHash(hashOAuthSecret(approvalCode));
      expect(grant?.approval_code_hash).toBe(hashOAuthSecret(approvalCode));
      expect(grant?.approval_code_hash).not.toBe(approvalCode);
    });
  });
});

function withAuthDb(
  fn: (context: {
    memPath: string;
    config: Config;
    db: ReturnType<typeof createMemoryDatabase>;
    signingKey: Buffer;
  }) => void,
): void {
  const memPath = mkdtempSync(join(tmpdir(), "aiprofile-auth-"));
  try {
    const vault = unlockOrCreateVault(memPath, "vault password");
    const signingKey = deriveAuthSigningKey(vault.key);
    const db = createMemoryDatabase({ memPath, mode: "plain" });
    const config = makeConfig(memPath, db);
    fn({ memPath, config, db, signingKey });
  } finally {
    rmSync(memPath, { recursive: true, force: true });
  }
}

function makeConfig(memPath: string, db: ReturnType<typeof createMemoryDatabase>): Config {
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
    memory: { path: memPath, mode: "plain", storage: db },
    safety: {
      allow_first_person: true,
      public_can_access_private_memory: false,
      require_disclaimer_for_inferred_answers: true,
    },
  };
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
