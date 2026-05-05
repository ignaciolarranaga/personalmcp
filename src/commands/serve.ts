import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  AuthError,
  defaultAuthIssuer,
  defaultAuthResource,
  deriveAuthSigningKey,
  hasScopes,
  OPERATION_SCOPES,
  verifyOAuthAccessToken,
} from "../auth.js";
import { loadConfig } from "../config.js";
import { createDebugLogger } from "../debug.js";
import { NodeLlamaCppProvider } from "../llm/NodeLlamaCppProvider.js";
import { initializeMemoryStorage, type MemoryUnlockOptions } from "../memory/unlock.js";
import {
  createAuthorizationCode,
  createAuthorizationErrorPage,
  createAuthorizationPage,
  exchangeAuthorizationCode,
  normalizeAuthorizationRequest,
  OAuthEndpointError,
  oauthMetadata,
  protectedResourceMetadata,
  refreshAccessToken,
  registerOAuthClient,
  revokeOAuthToken,
} from "../oauth.js";
import { createServer } from "../server.js";
import type { ServerAccessMode } from "../server.js";
import { AIPROFILE_VERSION } from "../version.js";

export type StartServerOptions = MemoryUnlockOptions;

export async function startServer(options: StartServerOptions): Promise<void> {
  const debugLogger = createDebugLogger({ enabled: options.debugEnabled });
  const config = loadConfig();
  const memoryInit = await initializeMemoryStorage(config, options);
  const port = config.server?.port ?? 3000;
  const authMode = config.auth?.mode ?? "off";
  const authResource = defaultAuthResource(config);
  const authMetadataUrl = protectedResourceMetadataUrl(authResource);
  const issuer = defaultAuthIssuer(config);

  if (authMode === "local") {
    if (!memoryInit.vaultKey) {
      throw new Error("Local auth requires encrypted memory mode.");
    }
    config.auth = {
      ...config.auth,
      signing_key: deriveAuthSigningKey(memoryInit.vaultKey),
    };
  }

  const llm = new NodeLlamaCppProvider(
    config.llm.model_path,
    config.llm.temperature,
    config.llm.max_tokens,
    debugLogger,
  );

  await llm.initialize();

  const protectedSessions = new Map<string, McpHttpSession>();
  const anonymousSessions = new Map<string, McpHttpSession>();

  async function createMcpHttpSession(
    accessMode: ServerAccessMode,
    sessions: Map<string, McpHttpSession>,
  ): Promise<McpHttpSession> {
    const server = createServer(llm, config, debugLogger, { accessMode });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, session);
      },
    });
    const session = { server, transport };
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) sessions.delete(sessionId);
      void server.close();
    };
    await server.connect(transport);
    return session;
  }

  const httpServer = createHttpServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);
    if (req.method === "OPTIONS") {
      writeCors(res);
      res.writeHead(204).end();
      return;
    }
    if (requestUrl.pathname === "/mcp") {
      if (authMode === "local") {
        await handleAuthorizedMcpRequest(req, res, {
          config,
          resource: authResource,
          metadataUrl: authMetadataUrl,
          protectedSessions,
          anonymousSessions,
          createSession: createMcpHttpSession,
        });
      } else {
        await handleMcpSessionRequest(req, res, {
          body: req.method === "POST" ? await readJsonBody(req) : undefined,
          sessions: protectedSessions,
          accessMode: "full",
          createSession: createMcpHttpSession,
        });
      }
      return;
    }
    if (authMode === "local" && requestUrl.pathname === new URL(authMetadataUrl).pathname) {
      writeJson(res, protectedResourceMetadata(config));
      return;
    }
    if (authMode === "local" && requestUrl.pathname === "/.well-known/oauth-authorization-server") {
      writeJson(res, oauthMetadata(config));
      return;
    }
    if (
      authMode === "local" &&
      requestUrl.pathname === "/oauth/register" &&
      req.method === "POST"
    ) {
      await handleOAuthRegister(req, res, config);
      return;
    }
    if (authMode === "local" && requestUrl.pathname === "/oauth/authorize") {
      await handleOAuthAuthorize(req, res, config, requestUrl);
      return;
    }
    if (authMode === "local" && requestUrl.pathname === "/oauth/token" && req.method === "POST") {
      await handleOAuthToken(req, res, config);
      return;
    }
    if (authMode === "local" && requestUrl.pathname === "/oauth/revoke" && req.method === "POST") {
      await handleOAuthRevoke(req, res, config);
      return;
    }
    res.writeHead(404).end("Not found");
  });

  httpServer.listen(port, () => {
    console.error(`[AIProfile] AIProfile v${AIPROFILE_VERSION}`);
    console.error(`[AIProfile] Server ready on http://localhost:${port}/mcp`);
    if (authMode === "local") {
      console.error("[AIProfile] Unauthenticated clients are limited to public-safe ask.");
      console.error("[AIProfile] OAuth issuer:");
      console.error(`  ${issuer}`);
      console.error("[AIProfile] Create an OAuth grant with:");
      console.error("  aiprofile auth grant add --subject owner --preset owner-full");
    }
    if (options.debugEnabled) {
      console.error("[AIProfile] Debug logging enabled.");
    }
  });
}

interface AuthRequestOptions {
  config: ReturnType<typeof loadConfig>;
  resource: string;
  metadataUrl: string;
  protectedSessions: Map<string, McpHttpSession>;
  anonymousSessions: Map<string, McpHttpSession>;
  createSession: (
    accessMode: ServerAccessMode,
    sessions: Map<string, McpHttpSession>,
  ) => Promise<McpHttpSession>;
}

interface McpHttpSession {
  server: Awaited<ReturnType<typeof createServer>>;
  transport: StreamableHTTPServerTransport;
}

async function handleOAuthRegister(
  req: IncomingMessage,
  res: ServerResponse,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  try {
    const input = (await readJsonBody(req)) as Record<string, unknown>;
    const db = requireAuthDb(config);
    const client = registerOAuthClient(db, input ?? {});
    writeJson(
      res,
      {
        client_id: client.client_id,
        client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
      },
      201,
    );
  } catch (err) {
    writeOAuthError(res, err);
  }
}

async function handleOAuthAuthorize(
  req: IncomingMessage,
  res: ServerResponse,
  config: ReturnType<typeof loadConfig>,
  requestUrl: URL,
): Promise<void> {
  try {
    const db = requireAuthDb(config);
    if (req.method === "GET") {
      const params = normalizeAuthorizationRequest(requestUrl);
      const client = db.getOAuthClient(params.clientId);
      if (!client) throw new OAuthEndpointError("invalid_client", "Client is not registered.", 401);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(createAuthorizationPage(params, client));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end("Method not allowed");
      return;
    }
    const body = await readFormBody(req);
    const params = normalizeAuthorizationRequest(
      new URL(`/oauth/authorize?${body.toString()}`, defaultAuthIssuer(config)),
    );
    const redirect = createAuthorizationCode(db, params, body.get("approval_code") ?? "");
    res.writeHead(302, { location: redirect.toString() }).end();
  } catch (err) {
    if (err instanceof OAuthEndpointError && err.error === "access_denied") {
      res.writeHead(err.status, { "content-type": "text/html; charset=utf-8" });
      res.end(createAuthorizationErrorPage(err.message));
      return;
    }
    writeOAuthError(res, err);
  }
}

async function handleOAuthToken(
  req: IncomingMessage,
  res: ServerResponse,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  try {
    const signingKey = config.auth?.signing_key;
    if (!signingKey) throw new OAuthEndpointError("server_error", "Auth is not initialized.", 500);
    const db = requireAuthDb(config);
    const body = await readFormBody(req);
    const grantType = body.get("grant_type");
    const token =
      grantType === "authorization_code"
        ? exchangeAuthorizationCode(db, signingKey, config, body)
        : grantType === "refresh_token"
          ? refreshAccessToken(db, signingKey, config, body)
          : (() => {
              throw new OAuthEndpointError(
                "unsupported_grant_type",
                "Grant type is not supported.",
              );
            })();
    writeJson(res, token);
  } catch (err) {
    writeOAuthError(res, err);
  }
}

async function handleOAuthRevoke(
  req: IncomingMessage,
  res: ServerResponse,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  try {
    const db = requireAuthDb(config);
    revokeOAuthToken(db, await readFormBody(req));
    res.writeHead(200).end();
  } catch (err) {
    writeOAuthError(res, err);
  }
}

async function handleAuthorizedMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: AuthRequestOptions,
): Promise<void> {
  const parsedBody = req.method === "POST" ? await readJsonBody(req) : undefined;
  const authHeader = req.headers.authorization;
  const requiredScopes = requiredScopesForRequest(parsedBody, !!authHeader);

  if (!authHeader) {
    if (requiredScopes.length > 0) {
      writeAuthError(
        res,
        new AuthError("invalid_token", "Authorization required.", 401, requiredScopes),
        options.metadataUrl,
      );
      return;
    }
    await handleMcpSessionRequest(req, res, {
      body: parsedBody,
      sessions: options.anonymousSessions,
      accessMode: "anonymous",
      createSession: options.createSession,
    });
    return;
  }

  let authInfo: AuthInfo;
  try {
    authInfo = verifyAuthorizationHeader(authHeader, options);
  } catch (err) {
    writeAuthError(
      res,
      err instanceof AuthError ? err : new AuthError("invalid_token", "Token is not valid."),
      options.metadataUrl,
    );
    return;
  }

  if (!hasScopes(authInfo, requiredScopes)) {
    writeAuthError(
      res,
      new AuthError("insufficient_scope", "Insufficient scope.", 403, requiredScopes),
      options.metadataUrl,
    );
    return;
  }

  (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;
  await handleMcpSessionRequest(req, res, {
    body: parsedBody,
    sessions: options.protectedSessions,
    accessMode: "scoped",
    createSession: options.createSession,
  });
}

async function handleMcpSessionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    body: unknown;
    sessions: Map<string, McpHttpSession>;
    accessMode: ServerAccessMode;
    createSession: (
      accessMode: ServerAccessMode,
      sessions: Map<string, McpHttpSession>,
    ) => Promise<McpHttpSession>;
  },
): Promise<void> {
  const sessionId = firstHeader(req.headers["mcp-session-id"]);
  const existingSession = sessionId ? options.sessions.get(sessionId) : undefined;
  if (existingSession) {
    await existingSession.transport.handleRequest(req, res, options.body);
    return;
  }

  if (!sessionId && req.method === "POST" && isInitializeRequest(options.body)) {
    const session = await options.createSession(options.accessMode, options.sessions);
    await session.transport.handleRequest(req, res, options.body);
    return;
  }

  res.writeHead(400, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid MCP session ID provided.",
      },
      id: null,
    }),
  );
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function verifyAuthorizationHeader(authHeader: string, options: AuthRequestOptions): AuthInfo {
  const [type, token] = authHeader.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) {
    throw new AuthError("invalid_token", "Invalid Authorization header format.");
  }
  const signingKey = options.config.auth?.signing_key;
  if (!signingKey) {
    throw new AuthError("invalid_token", "Local auth is not initialized.");
  }
  return verifyOAuthAccessToken(
    token,
    signingKey,
    options.config,
    options.resource,
    requireAuthDb(options.config),
  );
}

function requireAuthDb(config: ReturnType<typeof loadConfig>) {
  const db = config.memory.storage;
  if (!db) throw new Error("Memory database has not been initialized.");
  return db;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(req);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const raw = await readRawBody(req);
  return new URLSearchParams(raw);
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function requiredScopesForRequest(body: unknown, authenticated: boolean): string[] {
  if (Array.isArray(body)) {
    return [...new Set(body.flatMap((item) => requiredScopesForRequest(item, authenticated)))];
  }
  if (!body || typeof body !== "object") return [];
  const request = body as { method?: unknown; params?: { name?: unknown } };
  if (request.method !== "tools/call") return [];
  if (request.params?.name === "ask") return authenticated ? [OPERATION_SCOPES.ask] : [];
  if (request.params?.name === "ingest") return [OPERATION_SCOPES.ingest];
  if (request.params?.name === "suggest_question") return [OPERATION_SCOPES.suggest];
  return [OPERATION_SCOPES.ask];
}

function writeAuthError(res: ServerResponse, error: AuthError, metadataUrl: string): void {
  const params = [
    `error="${error.code}"`,
    `error_description="${error.message.replace(/"/g, "'")}"`,
    error.requiredScopes.length > 0 ? `scope="${error.requiredScopes.join(" ")}"` : null,
    `resource_metadata="${metadataUrl}"`,
  ].filter(Boolean);
  res.setHeader("WWW-Authenticate", `Bearer ${params.join(", ")}`);
  writeCors(res);
  res.writeHead(error.status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: error.code, error_description: error.message }));
}

function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const resourcePath = url.pathname === "/" ? "" : url.pathname;
  url.pathname = `/.well-known/oauth-protected-resource${resourcePath}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function writeJson(res: ServerResponse, body: Record<string, unknown>, status = 200): void {
  writeCors(res);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function writeOAuthError(res: ServerResponse, err: unknown): void {
  const error =
    err instanceof OAuthEndpointError
      ? err
      : new OAuthEndpointError(
          "server_error",
          err instanceof Error ? err.message : "OAuth request failed.",
          500,
        );
  writeJson(
    res,
    {
      error: error.error,
      error_description: error.message,
    },
    error.status,
  );
}

function writeCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization, content-type, mcp-session-id");
}
