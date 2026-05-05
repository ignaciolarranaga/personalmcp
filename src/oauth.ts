import { createHash, randomBytes } from "node:crypto";
import {
  defaultAuthIssuer,
  defaultAuthResource,
  issueOAuthAccessToken,
  isGrantActive,
  normalizeScopes,
  parseExpiresIn,
  scopesAllowed,
  SUPPORTED_AUTH_SCOPES,
} from "./auth.js";
import type {
  AuthGrantRecord,
  Config,
  MemoryDatabase,
  OAuthClientRecord,
  OAuthRefreshTokenRecord,
} from "./types.js";

const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export const AUTH_SCOPE_PRESETS = {
  "public-read": [
    "aiprofile:ask",
    "memory:read:public",
    "memory:read:kind:profile",
    "memory:read:kind:fact",
    "memory:read:kind:summary",
  ],
  "owner-read": [
    "aiprofile:ask",
    "memory:read:*",
    "memory:read:kind:*",
  ],
  maintainer: [
    "aiprofile:ask",
    "aiprofile:ingest",
    "aiprofile:suggest",
    "memory:read:public",
    "memory:read:personal",
    "memory:read:kind:profile",
    "memory:read:kind:preference",
    "memory:read:kind:principle",
    "memory:read:kind:communication_style",
  ],
  "owner-full": [
    "aiprofile:ask",
    "aiprofile:ingest",
    "aiprofile:suggest",
    "memory:read:*",
    "memory:read:kind:*",
  ],
} as const;

export type AuthScopePreset = keyof typeof AUTH_SCOPE_PRESETS;

export interface CreateGrantOptions {
  subject: string;
  label?: string;
  scopes: string[];
  presets: AuthScopePreset[];
  resource?: string;
  expiresIn: string;
}

export interface CreatedGrant {
  grant: AuthGrantRecord;
  approvalCode: string;
}

export interface AuthorizationRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}

export function createAuthGrant(
  db: MemoryDatabase,
  config: Config,
  options: CreateGrantOptions,
): CreatedGrant {
  const scopes = normalizeScopes([
    ...options.scopes,
    ...options.presets.flatMap((preset) => AUTH_SCOPE_PRESETS[preset]),
  ]);
  if (scopes.length === 0) {
    throw new Error("At least one --scope or --preset value is required.");
  }
  validateSupportedScopes(scopes);
  const now = new Date();
  const ttlSeconds = parseExpiresIn(options.expiresIn);
  const approvalCode = generateApprovalCode();
  const grant: AuthGrantRecord = {
    id: `grant_${randomToken(16)}`,
    subject: options.subject,
    label: options.label,
    resource: options.resource ?? defaultAuthResource(config),
    scopes,
    approval_code_hash: hashOAuthSecret(approvalCode),
    approval_code_expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  db.insertAuthGrant(grant);
  db.persist();
  return { grant, approvalCode };
}

export function revokeAuthGrant(db: MemoryDatabase, grantId: string): AuthGrantRecord {
  const grant = db.getAuthGrant(grantId);
  if (!grant) throw new Error(`No auth grant found for ${grantId}.`);
  const now = new Date().toISOString();
  db.updateAuthGrant(grantId, { revoked_at: now, updated_at: now });
  db.persist();
  return { ...grant, revoked_at: now, updated_at: now };
}

export function normalizeAuthorizationRequest(url: URL): AuthorizationRequest {
  const scope = (url.searchParams.get("scope") ?? "").split(/\s+/).filter(Boolean);
  return {
    responseType: url.searchParams.get("response_type") ?? "",
    clientId: url.searchParams.get("client_id") ?? "",
    redirectUri: url.searchParams.get("redirect_uri") ?? "",
    scope,
    state: url.searchParams.get("state") ?? undefined,
    codeChallenge: url.searchParams.get("code_challenge") ?? "",
    codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? "",
    resource: url.searchParams.get("resource") ?? "",
  };
}

export function registerOAuthClient(
  db: MemoryDatabase,
  input: Record<string, unknown>,
): OAuthClientRecord {
  const redirectUris = Array.isArray(input.redirect_uris)
    ? input.redirect_uris.filter((value): value is string => typeof value === "string")
    : [];
  if (redirectUris.length === 0) {
    throw new OAuthEndpointError("invalid_client_metadata", "redirect_uris is required.", 400);
  }
  for (const redirectUri of redirectUris) {
    validateRedirectUri(redirectUri);
  }
  const method =
    typeof input.token_endpoint_auth_method === "string"
      ? input.token_endpoint_auth_method
      : "none";
  if (method !== "none") {
    throw new OAuthEndpointError(
      "invalid_client_metadata",
      "Only public clients with token_endpoint_auth_method=none are supported.",
      400,
    );
  }
  const client: OAuthClientRecord = {
    client_id: `client_${randomToken(16)}`,
    client_name:
      typeof input.client_name === "string" && input.client_name.trim()
        ? input.client_name.trim()
        : undefined,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    created_at: new Date().toISOString(),
  };
  db.insertOAuthClient(client);
  db.persist();
  return client;
}

export function createAuthorizationPage(
  params: AuthorizationRequest,
  client: OAuthClientRecord,
): string {
  const clientName = escapeHtml(client.client_name ?? client.client_id);
  const scopes = params.scope.length > 0 ? params.scope.join(" ") : "(none requested)";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize AIProfile</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #111827; }
      main { max-width: 640px; margin: 48px auto; background: white; border: 1px solid #d8dde6; border-radius: 8px; padding: 28px; }
      dt { font-weight: 700; margin-top: 14px; }
      dd { margin: 4px 0 0; overflow-wrap: anywhere; color: #374151; }
      input { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid #aeb7c4; border-radius: 6px; font: inherit; }
      button { margin-top: 16px; padding: 10px 14px; border: 0; border-radius: 6px; background: #111827; color: white; font: inherit; cursor: pointer; }
      .note { color: #4b5563; font-size: 14px; line-height: 1.45; }
      .error { color: #b91c1c; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize AIProfile</h1>
      <p class="note">Enter the one-time approval code created with <code>aiprofile auth grant add</code>. The grant label is not identity proof; possession of the code authorizes this connection.</p>
      <dl>
        <dt>Client</dt><dd>${clientName}</dd>
        <dt>Resource</dt><dd>${escapeHtml(params.resource)}</dd>
        <dt>Requested scopes</dt><dd>${escapeHtml(scopes)}</dd>
      </dl>
      <form method="post" action="/oauth/authorize">
        ${hidden("response_type", params.responseType)}
        ${hidden("client_id", params.clientId)}
        ${hidden("redirect_uri", params.redirectUri)}
        ${hidden("scope", params.scope.join(" "))}
        ${hidden("state", params.state ?? "")}
        ${hidden("code_challenge", params.codeChallenge)}
        ${hidden("code_challenge_method", params.codeChallengeMethod)}
        ${hidden("resource", params.resource)}
        <label>
          Approval code
          <input name="approval_code" autocomplete="one-time-code" required autofocus />
        </label>
        <button type="submit">Approve</button>
      </form>
    </main>
  </body>
</html>`;
}

export function createAuthorizationErrorPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>AIProfile authorization error</title></head><body><main><h1>Authorization failed</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

export function createAuthorizationCode(
  db: MemoryDatabase,
  params: AuthorizationRequest,
  approvalCode: string,
): URL {
  const client = requireOAuthClient(db, params.clientId);
  validateAuthorizationRequest(params, client);
  const grant = db.getAuthGrantByApprovalCodeHash(hashOAuthSecret(approvalCode.trim()));
  if (!grant) throw new OAuthEndpointError("access_denied", "Approval code is not valid.", 403);
  if (!isGrantActive(grant))
    throw new OAuthEndpointError("access_denied", "Grant is not active.", 403);
  if (grant.approval_code_consumed_at) {
    throw new OAuthEndpointError("access_denied", "Approval code was already used.", 403);
  }
  if (grant.approval_code_expires_at && Date.parse(grant.approval_code_expires_at) <= Date.now()) {
    throw new OAuthEndpointError("access_denied", "Approval code has expired.", 403);
  }
  if (grant.resource !== params.resource) {
    throw new OAuthEndpointError("access_denied", "Grant resource does not match.", 403);
  }
  if (!scopesAllowed(params.scope, grant.scopes)) {
    throw new OAuthEndpointError("invalid_scope", "Requested scopes exceed the grant.", 400);
  }

  const now = new Date();
  const code = randomToken(32);
  db.insertOAuthAuthorizationCode({
    code_hash: hashOAuthSecret(code),
    client_id: params.clientId,
    grant_id: grant.id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    scopes: normalizeScopes(params.scope),
    resource: params.resource,
    expires_at: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString(),
    created_at: now.toISOString(),
  });
  db.updateAuthGrant(grant.id, {
    approval_code_consumed_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  db.persist();

  const redirect = new URL(params.redirectUri);
  redirect.searchParams.set("code", code);
  if (params.state) redirect.searchParams.set("state", params.state);
  return redirect;
}

export function exchangeAuthorizationCode(
  db: MemoryDatabase,
  signingKey: Buffer,
  config: Config,
  body: URLSearchParams,
): Record<string, unknown> {
  const clientId = requiredParam(body, "client_id");
  const code = requiredParam(body, "code");
  const redirectUri = requiredParam(body, "redirect_uri");
  const codeVerifier = requiredParam(body, "code_verifier");
  const resource = requiredParam(body, "resource");
  requireOAuthClient(db, clientId);
  const record = db.getOAuthAuthorizationCode(hashOAuthSecret(code));
  if (!record || record.client_id !== clientId) {
    throw new OAuthEndpointError("invalid_grant", "Authorization code is not valid.", 400);
  }
  if (record.consumed_at) {
    throw new OAuthEndpointError("invalid_grant", "Authorization code was already used.", 400);
  }
  if (Date.parse(record.expires_at) <= Date.now()) {
    throw new OAuthEndpointError("invalid_grant", "Authorization code has expired.", 400);
  }
  if (record.redirect_uri !== redirectUri || record.resource !== resource) {
    throw new OAuthEndpointError("invalid_grant", "Authorization code binding is not valid.", 400);
  }
  if (pkceChallenge(codeVerifier) !== record.code_challenge) {
    throw new OAuthEndpointError("invalid_grant", "PKCE verifier is not valid.", 400);
  }
  const grant = db.getAuthGrant(record.grant_id);
  if (!grant || !isGrantActive(grant) || !scopesAllowed(record.scopes, grant.scopes)) {
    throw new OAuthEndpointError("invalid_grant", "Grant is not active.", 400);
  }
  db.consumeOAuthAuthorizationCode(record.code_hash, new Date().toISOString());
  const refreshToken = insertRefreshToken(db, {
    clientId,
    grant,
    scopes: record.scopes,
    resource: record.resource,
  });
  const access = issueOAuthAccessToken(signingKey, config, {
    clientId,
    grant,
    scopes: record.scopes,
    resource: record.resource,
  });
  db.persist();
  return tokenResponse(access.token, access.expiresAt, record.scopes, refreshToken);
}

export function refreshAccessToken(
  db: MemoryDatabase,
  signingKey: Buffer,
  config: Config,
  body: URLSearchParams,
): Record<string, unknown> {
  const clientId = requiredParam(body, "client_id");
  const refreshToken = requiredParam(body, "refresh_token");
  const resource = body.get("resource") ?? defaultAuthResource(config);
  requireOAuthClient(db, clientId);
  const record = db.getOAuthRefreshToken(hashOAuthSecret(refreshToken));
  if (!record || record.client_id !== clientId || record.resource !== resource) {
    throw new OAuthEndpointError("invalid_grant", "Refresh token is not valid.", 400);
  }
  if (record.revoked_at || Date.parse(record.expires_at) <= Date.now()) {
    throw new OAuthEndpointError("invalid_grant", "Refresh token is no longer active.", 400);
  }
  const grant = db.getAuthGrant(record.grant_id);
  if (!grant || !isGrantActive(grant) || !scopesAllowed(record.scopes, grant.scopes)) {
    throw new OAuthEndpointError("invalid_grant", "Grant is not active.", 400);
  }
  const access = issueOAuthAccessToken(signingKey, config, {
    clientId,
    grant,
    scopes: record.scopes,
    resource: record.resource,
  });
  return tokenResponse(access.token, access.expiresAt, record.scopes);
}

export function revokeOAuthToken(db: MemoryDatabase, body: URLSearchParams): void {
  const token = requiredParam(body, "token");
  const hash = hashOAuthSecret(token);
  if (db.getOAuthRefreshToken(hash)) {
    db.updateOAuthRefreshToken(hash, {
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    db.persist();
  }
}

export function oauthMetadata(config: Config): Record<string, unknown> {
  const issuer = defaultAuthIssuer(config);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: SUPPORTED_AUTH_SCOPES,
  };
}

export function protectedResourceMetadata(config: Config): Record<string, unknown> {
  return {
    resource: defaultAuthResource(config),
    resource_name: "AIProfile",
    authorization_servers: [defaultAuthIssuer(config)],
    bearer_methods_supported: ["header"],
    scopes_supported: SUPPORTED_AUTH_SCOPES,
  };
}

export function validateSupportedScopes(scopes: string[]): void {
  const supported = new Set(SUPPORTED_AUTH_SCOPES);
  const invalid = scopes.filter((scope) => !supported.has(scope));
  if (invalid.length > 0) {
    throw new Error(`Unsupported scope: ${invalid.join(", ")}`);
  }
}

export function hashOAuthSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

export class OAuthEndpointError extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function validateAuthorizationRequest(
  params: AuthorizationRequest,
  client: OAuthClientRecord,
): void {
  if (params.responseType !== "code") {
    throw new OAuthEndpointError(
      "unsupported_response_type",
      "Only response_type=code is supported.",
    );
  }
  if (!client.redirect_uris.includes(params.redirectUri)) {
    throw new OAuthEndpointError("invalid_request", "redirect_uri is not registered.");
  }
  if (!params.resource) {
    throw new OAuthEndpointError("invalid_request", "resource is required.");
  }
  if (params.codeChallengeMethod !== "S256" || !params.codeChallenge) {
    throw new OAuthEndpointError("invalid_request", "PKCE S256 is required.");
  }
  validateSupportedScopes(params.scope);
}

function requireOAuthClient(db: MemoryDatabase, clientId: string): OAuthClientRecord {
  const client = db.getOAuthClient(clientId);
  if (!client) throw new OAuthEndpointError("invalid_client", "Client is not registered.", 401);
  return client;
}

function insertRefreshToken(
  db: MemoryDatabase,
  options: { clientId: string; grant: AuthGrantRecord; scopes: string[]; resource: string },
): string {
  const token = randomToken(32);
  const now = new Date();
  const record: OAuthRefreshTokenRecord = {
    token_hash: hashOAuthSecret(token),
    client_id: options.clientId,
    grant_id: options.grant.id,
    scopes: normalizeScopes(options.scopes),
    resource: options.resource,
    expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  db.insertOAuthRefreshToken(record);
  return token;
}

function tokenResponse(
  accessToken: string,
  expiresAt: number,
  scopes: string[],
  refreshToken?: string,
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.max(0, expiresAt - now),
    scope: normalizeScopes(scopes).join(" "),
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  };
}

function validateRedirectUri(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthEndpointError("invalid_client_metadata", "redirect_uri must be a URL.", 400);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new OAuthEndpointError(
      "invalid_client_metadata",
      "redirect_uri must be HTTPS or localhost.",
      400,
    );
  }
}

function requiredParam(body: URLSearchParams, name: string): string {
  const value = body.get(name);
  if (!value) throw new OAuthEndpointError("invalid_request", `${name} is required.`, 400);
  return value;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function generateApprovalCode(): string {
  const raw = randomBytes(8).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
