import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Config, MemoryKind, MemoryRecord } from "./types.js";
import type { MemoryReadAccess } from "./memory/readMemory.js";

const TOKEN_ISSUER = "aiprofile.local";
const SIGNING_CONTEXT = "aiprofile-local-auth-token-v1";
const DEFAULT_EXPIRES_IN = "30d";

export const OPERATION_SCOPES = {
  ask: "aiprofile:ask",
  ingest: "aiprofile:ingest",
  suggest: "aiprofile:suggest",
} as const;

export const PUBLIC_MEMORY_SCOPES = [
  "memory:read:public",
  "memory:read:personal",
  "memory:read:secret",
] as const;

const KIND_SCOPES: Record<MemoryKind, string> = {
  profile: "memory:read:kind:profile",
  fact: "memory:read:kind:fact",
  preference: "memory:read:kind:preference",
  principle: "memory:read:kind:principle",
  opinion: "memory:read:kind:opinion",
  communication_style: "memory:read:kind:communication_style",
  private: "memory:read:kind:private",
  decision: "memory:read:kind:decision",
  instruction: "memory:read:kind:instruction",
  summary: "memory:read:kind:summary",
  relationship: "memory:read:kind:relationship",
};

const ANONYMOUS_KINDS: MemoryKind[] = ["profile", "fact", "summary"];

export const SUPPORTED_AUTH_SCOPES = [
  OPERATION_SCOPES.ask,
  OPERATION_SCOPES.ingest,
  OPERATION_SCOPES.suggest,
  ...PUBLIC_MEMORY_SCOPES,
  "memory:read:*",
  "memory:read:kind:*",
  ...Object.values(KIND_SCOPES),
];

export interface TokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  scope: string;
}

export interface IssueTokenOptions {
  scopes: string[];
  expiresIn?: string;
  resource: string;
}

export function defaultAuthResource(config: Config): string {
  return config.auth?.resource ?? `http://localhost:${config.server?.port ?? 3000}/mcp`;
}

export function localAuthIssuer(config: Config): string {
  return config.auth?.issuer ?? TOKEN_ISSUER;
}

export function deriveAuthSigningKey(vaultKey: Buffer): Buffer {
  return createHmac("sha256", vaultKey).update(SIGNING_CONTEXT).digest();
}

export function issueLocalAuthToken(
  signingKey: Buffer,
  config: Config,
  options: IssueTokenOptions,
): string {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = parseExpiresIn(options.expiresIn ?? DEFAULT_EXPIRES_IN);
  const claims: TokenClaims = {
    iss: localAuthIssuer(config),
    sub: "owner",
    aud: options.resource,
    iat: now,
    exp: now + ttlSeconds,
    scope: normalizeScopes(options.scopes).join(" "),
  };
  return signJwt(signingKey, claims);
}

export function verifyLocalAuthToken(
  token: string,
  signingKey: Buffer,
  config: Config,
  resource: string,
): AuthInfo {
  const claims = verifyJwt(token, signingKey);
  const now = Math.floor(Date.now() / 1000);

  if (claims.iss !== localAuthIssuer(config)) {
    throw new AuthError("invalid_token", "Token issuer is not valid.");
  }
  if (claims.aud !== resource) {
    throw new AuthError("invalid_token", "Token resource is not valid.");
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= now) {
    throw new AuthError("invalid_token", "Token has expired.");
  }

  return {
    token,
    clientId: claims.sub,
    scopes: claims.scope ? claims.scope.split(/\s+/).filter(Boolean) : [],
    expiresAt: claims.exp,
    resource: new URL(resource),
  };
}

export function anonymousMemoryAccess(): MemoryReadAccess {
  return {
    includeVisibility: ["normal"],
    kind: ANONYMOUS_KINDS,
  };
}

export function memoryAccessFromScopes(scopes: string[]): MemoryReadAccess {
  const scopeSet = new Set(scopes);
  const includeVisibility: MemoryRecord["visibility"][] = [];
  if (scopeSet.has("memory:read:public") || scopeSet.has("memory:read:*")) {
    includeVisibility.push("normal");
  }
  if (scopeSet.has("memory:read:personal") || scopeSet.has("memory:read:*")) {
    includeVisibility.push("sensitive");
  }
  if (scopeSet.has("memory:read:secret") || scopeSet.has("memory:read:*")) {
    includeVisibility.push("secret");
  }

  const kind = Object.entries(KIND_SCOPES)
    .filter(([, scope]) => scopeSet.has(scope) || scopeSet.has("memory:read:kind:*"))
    .map(([memoryKind]) => memoryKind as MemoryKind);

  return { includeVisibility, kind };
}

export function hasScopes(authInfo: AuthInfo, requiredScopes: string[]): boolean {
  const scopeSet = new Set(authInfo.scopes);
  return requiredScopes.every(
    (scope) =>
      scopeSet.has(scope) ||
      scopeSet.has("aiprofile:*") ||
      (scope.startsWith("memory:read:") && scopeSet.has("memory:read:*")),
  );
}

export function parseExpiresIn(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error("--expires-in must be a duration like 3600s, 24h, or 30d.");
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const multiplier = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return amount * multiplier;
}

export class AuthError extends Error {
  constructor(
    readonly code: "invalid_token" | "insufficient_scope",
    message: string,
    readonly status = code === "invalid_token" ? 401 : 403,
    readonly requiredScopes: string[] = [],
  ) {
    super(message);
  }
}

function normalizeScopes(scopes: string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function signJwt(signingKey: Buffer, claims: TokenClaims): string {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claims),
  )}`;
  const signature = createHmac("sha256", signingKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyJwt(token: string, signingKey: Buffer): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("invalid_token", "Token is not a JWT.");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJson<Record<string, unknown>>(encodedHeader);
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new AuthError("invalid_token", "Token algorithm is not supported.");
  }

  const payload = `${encodedHeader}.${encodedPayload}`;
  const expected = createHmac("sha256", signingKey).update(payload).digest("base64url");
  if (!safeEqual(encodedSignature, expected)) {
    throw new AuthError("invalid_token", "Token signature is not valid.");
  }

  const claims = parseJson<TokenClaims>(encodedPayload);
  if (
    typeof claims.iss !== "string" ||
    typeof claims.sub !== "string" ||
    typeof claims.aud !== "string" ||
    typeof claims.scope !== "string" ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number"
  ) {
    throw new AuthError("invalid_token", "Token claims are not valid.");
  }
  return claims;
}

function parseJson<T>(encoded: string): T {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as T;
  } catch {
    throw new AuthError("invalid_token", "Token JSON is not valid.");
  }
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
