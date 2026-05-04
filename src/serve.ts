import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  AuthError,
  defaultAuthResource,
  deriveAuthSigningKey,
  hasScopes,
  OPERATION_SCOPES,
  SUPPORTED_AUTH_SCOPES,
  verifyLocalAuthToken,
} from "./auth.js";
import { loadConfig } from "./config.js";
import { createDebugLogger } from "./debug.js";
import { NodeLlamaCppProvider } from "./llm/NodeLlamaCppProvider.js";
import { initializeMemoryStorage, type MemoryUnlockOptions } from "./memory/unlock.js";
import { createServer } from "./server.js";

export type StartServerOptions = MemoryUnlockOptions;

export async function startServer(options: StartServerOptions): Promise<void> {
  const debugLogger = createDebugLogger({ enabled: options.debugEnabled });
  const config = loadConfig();
  const memoryInit = await initializeMemoryStorage(config, options);
  const port = config.server?.port ?? 3000;
  const authMode = config.auth?.mode ?? "off";
  const authResource = defaultAuthResource(config);
  const authMetadataUrl = protectedResourceMetadataUrl(authResource);

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

  const mcpServer = createServer(llm, config, debugLogger, {
    accessMode: authMode === "local" ? "scoped" : "full",
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);

  const anonymousServer =
    authMode === "local"
      ? createServer(llm, config, debugLogger, {
          accessMode: "anonymous",
        })
      : undefined;
  const anonymousTransport = anonymousServer
    ? new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
    : undefined;
  if (anonymousServer && anonymousTransport) {
    await anonymousServer.connect(anonymousTransport);
  }

  const httpServer = createHttpServer(async (req, res) => {
    if (req.url === "/mcp") {
      if (authMode === "local") {
        await handleAuthorizedMcpRequest(req, res, {
          config,
          resource: authResource,
          metadataUrl: authMetadataUrl,
          protectedTransport: transport,
          anonymousTransport: anonymousTransport!,
        });
      } else {
        await transport.handleRequest(req, res);
      }
      return;
    }
    if (authMode === "local" && req.url === new URL(authMetadataUrl).pathname) {
      writeProtectedResourceMetadata(res, authResource);
      return;
    }
    res.writeHead(404).end("Not found");
  });

  httpServer.listen(port, () => {
    console.error(`[AIProfile] Server ready on http://localhost:${port}/mcp`);
    if (authMode === "local") {
      console.error("[AIProfile] Unauthenticated clients are limited to public-safe ask.");
      console.error("[AIProfile] Create a scoped Bearer token with:");
      console.error("  aiprofile auth token \\");
      console.error("    --scope aiprofile:ask \\");
      console.error("    --scope aiprofile:ingest \\");
      console.error("    --scope memory:read:public \\");
      console.error("    --scope memory:read:personal \\");
      console.error("    --scope memory:read:kind:profile \\");
      console.error("    --scope memory:read:kind:preference");
      console.error("[AIProfile] Configure clients with: Authorization: Bearer <token>");
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
  protectedTransport: StreamableHTTPServerTransport;
  anonymousTransport: StreamableHTTPServerTransport;
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
    await options.anonymousTransport.handleRequest(req, res, parsedBody);
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
  await options.protectedTransport.handleRequest(req, res, parsedBody);
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
  return verifyLocalAuthToken(token, signingKey, options.config, options.resource);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
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

function writeProtectedResourceMetadata(res: ServerResponse, resource: string): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify(
      {
        resource,
        resource_name: "AIProfile",
        bearer_methods_supported: ["header"],
        scopes_supported: SUPPORTED_AUTH_SCOPES,
      },
      null,
      2,
    ),
  );
}
