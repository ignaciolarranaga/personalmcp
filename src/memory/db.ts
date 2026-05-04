import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import type {
  AuthGrantRecord,
  MemoryDatabase,
  MemoryRecord,
  OAuthAuthorizationCodeRecord,
  OAuthClientRecord,
  OAuthRefreshTokenRecord,
  SourceRecord,
} from "../types.js";

const ENVELOPE_VERSION = 1;
const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const DB_FILENAME = "memory.db";
const DB_ENC_FILENAME = "memory.db.enc";

interface EncryptedEnvelope {
  version: number;
  algorithm: typeof ALGORITHM;
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  subject TEXT,
  predicate TEXT,
  value TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  importance REAL NOT NULL DEFAULT 0.5,
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  visibility TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  supersedes TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  text,
  tags,
  content=memory_records,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS memory_records_ai AFTER INSERT ON memory_records BEGIN
  INSERT INTO memory_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memory_records_ad AFTER DELETE ON memory_records BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memory_records_au AFTER UPDATE ON memory_records BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
  INSERT INTO memory_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
END;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  title TEXT,
  type TEXT,
  date TEXT,
  created_at TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  memory_item_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_grants (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  label TEXT,
  resource TEXT NOT NULL,
  scopes TEXT NOT NULL,
  approval_code_hash TEXT UNIQUE,
  approval_code_expires_at TEXT,
  approval_code_consumed_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

interface RawRecord {
  id: string;
  kind: string;
  text: string;
  subject: string | null;
  predicate: string | null;
  value: string | null;
  tags: string;
  confidence: number;
  importance: number;
  source_id: string | null;
  status: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  supersedes: string | null;
}

interface RawSource {
  id: string;
  title: string | null;
  type: string | null;
  date: string | null;
  created_at: string;
  content_hash: string;
  memory_item_ids: string;
}

interface RawOAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: string;
  created_at: string;
}

interface RawAuthGrant {
  id: string;
  subject: string;
  label: string | null;
  resource: string;
  scopes: string;
  approval_code_hash: string | null;
  approval_code_expires_at: string | null;
  approval_code_consumed_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RawOAuthAuthorizationCode {
  code_hash: string;
  client_id: string;
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string;
  resource: string;
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
}

interface RawOAuthRefreshToken {
  token_hash: string;
  client_id: string;
  grant_id: string;
  scopes: string;
  resource: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: RawRecord): MemoryRecord {
  return {
    id: row.id,
    kind: row.kind as MemoryRecord["kind"],
    text: row.text,
    subject: row.subject ?? undefined,
    predicate: row.predicate ?? undefined,
    value: row.value ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    confidence: row.confidence,
    importance: row.importance,
    source_id: row.source_id ?? undefined,
    status: row.status as MemoryRecord["status"],
    visibility: row.visibility as MemoryRecord["visibility"],
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at ?? undefined,
    supersedes: row.supersedes ? (JSON.parse(row.supersedes) as string[]) : undefined,
  };
}

function rowToSource(row: RawSource): SourceRecord {
  return {
    id: row.id,
    title: row.title ?? undefined,
    type: row.type as SourceRecord["type"],
    date: row.date ?? undefined,
    created_at: row.created_at,
    content_hash: row.content_hash,
    memory_item_ids: JSON.parse(row.memory_item_ids) as string[],
  };
}

function rowToOAuthClient(row: RawOAuthClient): OAuthClientRecord {
  return {
    client_id: row.client_id,
    client_name: row.client_name ?? undefined,
    redirect_uris: JSON.parse(row.redirect_uris) as string[],
    token_endpoint_auth_method: row.token_endpoint_auth_method,
    created_at: row.created_at,
  };
}

function rowToAuthGrant(row: RawAuthGrant): AuthGrantRecord {
  return {
    id: row.id,
    subject: row.subject,
    label: row.label ?? undefined,
    resource: row.resource,
    scopes: JSON.parse(row.scopes) as string[],
    approval_code_hash: row.approval_code_hash ?? undefined,
    approval_code_expires_at: row.approval_code_expires_at ?? undefined,
    approval_code_consumed_at: row.approval_code_consumed_at ?? undefined,
    expires_at: row.expires_at ?? undefined,
    revoked_at: row.revoked_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToOAuthAuthorizationCode(
  row: RawOAuthAuthorizationCode,
): OAuthAuthorizationCodeRecord {
  return {
    code_hash: row.code_hash,
    client_id: row.client_id,
    grant_id: row.grant_id,
    redirect_uri: row.redirect_uri,
    code_challenge: row.code_challenge,
    scopes: JSON.parse(row.scopes) as string[],
    resource: row.resource,
    expires_at: row.expires_at,
    created_at: row.created_at,
    consumed_at: row.consumed_at ?? undefined,
  };
}

function rowToOAuthRefreshToken(row: RawOAuthRefreshToken): OAuthRefreshTokenRecord {
  return {
    token_hash: row.token_hash,
    client_id: row.client_id,
    grant_id: row.grant_id,
    scopes: JSON.parse(row.scopes) as string[],
    resource: row.resource,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function encryptBuffer(buffer: Buffer, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function decryptBuffer(raw: string, key: Buffer, filePath: string): Buffer {
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(raw) as EncryptedEnvelope;
  } catch {
    throw new Error(`Encrypted memory database ${filePath} is not valid JSON.`);
  }

  if (envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== ALGORITHM) {
    throw new Error(`Encrypted memory database ${filePath} uses an unsupported format.`);
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.auth_tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
  } catch {
    throw new Error(
      `Cannot decrypt ${filePath}. The password may be wrong, or the file may be corrupted.`,
    );
  }
}

export function createMemoryDatabase(options: {
  memPath: string;
  key?: Buffer;
  mode: "encrypted" | "plain";
}): MemoryDatabase {
  const { memPath, key, mode } = options;

  mkdirSync(memPath, { recursive: true });

  let db: Database.Database;

  if (mode === "plain") {
    const dbPath = join(memPath, DB_FILENAME);
    db = new Database(dbPath);
  } else {
    const encPath = join(memPath, DB_ENC_FILENAME);
    if (existsSync(encPath)) {
      const raw = readFileSync(encPath, "utf-8");
      const buffer = decryptBuffer(raw, key!, encPath);
      db = new Database(buffer);
    } else {
      db = new Database(":memory:");
    }
  }

  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  const persistFn = (): void => {
    if (mode === "plain") return;
    const buffer = db.serialize();
    const encPath = join(memPath, DB_ENC_FILENAME);
    const tmpPath = `${encPath}.tmp`;
    writeFileSync(tmpPath, encryptBuffer(buffer, key!), "utf-8");
    renameSync(tmpPath, encPath);
  };

  const insertRecord = db.prepare(`
    INSERT INTO memory_records
      (id, kind, text, subject, predicate, value, tags, confidence, importance,
       source_id, status, visibility, created_at, updated_at, last_used_at, supersedes)
    VALUES
      (@id, @kind, @text, @subject, @predicate, @value, @tags, @confidence, @importance,
       @source_id, @status, @visibility, @created_at, @updated_at, @last_used_at, @supersedes)
  `);

  const updateRecordStmt = db.prepare(`
    UPDATE memory_records SET
      kind = COALESCE(@kind, kind),
      text = COALESCE(@text, text),
      subject = COALESCE(@subject, subject),
      predicate = COALESCE(@predicate, predicate),
      value = COALESCE(@value, value),
      tags = COALESCE(@tags, tags),
      confidence = COALESCE(@confidence, confidence),
      importance = COALESCE(@importance, importance),
      source_id = COALESCE(@source_id, source_id),
      status = COALESCE(@status, status),
      visibility = COALESCE(@visibility, visibility),
      updated_at = @updated_at,
      last_used_at = COALESCE(@last_used_at, last_used_at),
      supersedes = COALESCE(@supersedes, supersedes)
    WHERE id = @id
  `);

  const getRecordByIdStmt = db.prepare<[string]>(
    "SELECT * FROM memory_records WHERE id = ?",
  );

  const countRecordsStmt = db.prepare<[string]>(
    "SELECT COUNT(*) as count FROM memory_records WHERE status = ?",
  );

  const countAllStmt = db.prepare(
    "SELECT COUNT(*) as count FROM memory_records",
  );

  const getSourceByHashStmt = db.prepare<[string]>(
    "SELECT * FROM sources WHERE content_hash = ?",
  );

  const insertSourceStmt = db.prepare(`
    INSERT INTO sources (id, title, type, date, created_at, content_hash, memory_item_ids)
    VALUES (@id, @title, @type, @date, @created_at, @content_hash, @memory_item_ids)
  `);

  const listSourcesStmt = db.prepare("SELECT * FROM sources ORDER BY created_at DESC");
  const insertOAuthClientStmt = db.prepare(`
    INSERT OR REPLACE INTO oauth_clients
      (client_id, client_name, redirect_uris, token_endpoint_auth_method, created_at)
    VALUES
      (@client_id, @client_name, @redirect_uris, @token_endpoint_auth_method, @created_at)
  `);
  const getOAuthClientStmt = db.prepare<[string]>(
    "SELECT * FROM oauth_clients WHERE client_id = ?",
  );
  const insertAuthGrantStmt = db.prepare(`
    INSERT INTO auth_grants
      (id, subject, label, resource, scopes, approval_code_hash, approval_code_expires_at,
       approval_code_consumed_at, expires_at, revoked_at, created_at, updated_at)
    VALUES
      (@id, @subject, @label, @resource, @scopes, @approval_code_hash, @approval_code_expires_at,
       @approval_code_consumed_at, @expires_at, @revoked_at, @created_at, @updated_at)
  `);
  const listAuthGrantsStmt = db.prepare("SELECT * FROM auth_grants ORDER BY created_at DESC");
  const getAuthGrantStmt = db.prepare<[string]>("SELECT * FROM auth_grants WHERE id = ?");
  const getAuthGrantByApprovalCodeHashStmt = db.prepare<[string]>(
    "SELECT * FROM auth_grants WHERE approval_code_hash = ?",
  );
  const updateAuthGrantStmt = db.prepare(`
    UPDATE auth_grants SET
      subject = COALESCE(@subject, subject),
      label = COALESCE(@label, label),
      resource = COALESCE(@resource, resource),
      scopes = COALESCE(@scopes, scopes),
      approval_code_hash = COALESCE(@approval_code_hash, approval_code_hash),
      approval_code_expires_at = COALESCE(@approval_code_expires_at, approval_code_expires_at),
      approval_code_consumed_at = COALESCE(@approval_code_consumed_at, approval_code_consumed_at),
      expires_at = COALESCE(@expires_at, expires_at),
      revoked_at = COALESCE(@revoked_at, revoked_at),
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertOAuthAuthorizationCodeStmt = db.prepare(`
    INSERT INTO oauth_authorization_codes
      (code_hash, client_id, grant_id, redirect_uri, code_challenge, scopes, resource,
       expires_at, created_at, consumed_at)
    VALUES
      (@code_hash, @client_id, @grant_id, @redirect_uri, @code_challenge, @scopes, @resource,
       @expires_at, @created_at, @consumed_at)
  `);
  const getOAuthAuthorizationCodeStmt = db.prepare<[string]>(
    "SELECT * FROM oauth_authorization_codes WHERE code_hash = ?",
  );
  const consumeOAuthAuthorizationCodeStmt = db.prepare<[string, string]>(
    "UPDATE oauth_authorization_codes SET consumed_at = ? WHERE code_hash = ?",
  );
  const insertOAuthRefreshTokenStmt = db.prepare(`
    INSERT INTO oauth_refresh_tokens
      (token_hash, client_id, grant_id, scopes, resource, expires_at, revoked_at, created_at, updated_at)
    VALUES
      (@token_hash, @client_id, @grant_id, @scopes, @resource, @expires_at, @revoked_at, @created_at, @updated_at)
  `);
  const getOAuthRefreshTokenStmt = db.prepare<[string]>(
    "SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?",
  );
  const updateOAuthRefreshTokenStmt = db.prepare(`
    UPDATE oauth_refresh_tokens SET
      scopes = COALESCE(@scopes, scopes),
      resource = COALESCE(@resource, resource),
      expires_at = COALESCE(@expires_at, expires_at),
      revoked_at = COALESCE(@revoked_at, revoked_at),
      updated_at = @updated_at
    WHERE token_hash = @token_hash
  `);

  return {
    insertRecord(record: MemoryRecord): void {
      insertRecord.run({
        ...record,
        tags: JSON.stringify(record.tags),
        supersedes: record.supersedes ? JSON.stringify(record.supersedes) : null,
        subject: record.subject ?? null,
        predicate: record.predicate ?? null,
        value: record.value ?? null,
        source_id: record.source_id ?? null,
        last_used_at: record.last_used_at ?? null,
      });
    },

    updateRecord(id: string, updates: Partial<MemoryRecord>): void {
      updateRecordStmt.run({
        id,
        kind: updates.kind ?? null,
        text: updates.text ?? null,
        subject: updates.subject ?? null,
        predicate: updates.predicate ?? null,
        value: updates.value ?? null,
        tags: updates.tags ? JSON.stringify(updates.tags) : null,
        confidence: updates.confidence ?? null,
        importance: updates.importance ?? null,
        source_id: updates.source_id ?? null,
        status: updates.status ?? null,
        visibility: updates.visibility ?? null,
        updated_at: updates.updated_at ?? new Date().toISOString(),
        last_used_at: updates.last_used_at ?? null,
        supersedes: updates.supersedes ? JSON.stringify(updates.supersedes) : null,
      });
    },

    queryRecords(
      filters: {
        status?: string;
        excludeVisibility?: string[];
        includeVisibility?: string[];
        kind?: string[];
      } = {},
    ): MemoryRecord[] {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (filters.status) {
        conditions.push("status = ?");
        params.push(filters.status);
      }

      if (filters.excludeVisibility && filters.excludeVisibility.length > 0) {
        const placeholders = filters.excludeVisibility.map(() => "?").join(", ");
        conditions.push(`visibility NOT IN (${placeholders})`);
        params.push(...filters.excludeVisibility);
      }

      if (filters.includeVisibility && filters.includeVisibility.length > 0) {
        const placeholders = filters.includeVisibility.map(() => "?").join(", ");
        conditions.push(`visibility IN (${placeholders})`);
        params.push(...filters.includeVisibility);
      }

      if (filters.kind && filters.kind.length > 0) {
        const placeholders = filters.kind.map(() => "?").join(", ");
        conditions.push(`kind IN (${placeholders})`);
        params.push(...filters.kind);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM memory_records ${where} ORDER BY importance DESC, confidence DESC`;
      const stmt = db.prepare(sql);
      return (stmt.all(...params) as RawRecord[]).map(rowToRecord);
    },

    searchRecords(query: string, limit = 10): MemoryRecord[] {
      const sql = `
        SELECT r.* FROM memory_records r
        INNER JOIN memory_fts f ON r.rowid = f.rowid
        WHERE memory_fts MATCH ?
        ORDER BY f.rank
        LIMIT ?
      `;
      const stmt = db.prepare(sql);
      try {
        return (stmt.all(query, limit) as RawRecord[]).map(rowToRecord);
      } catch {
        return [];
      }
    },

    getRecordById(id: string): MemoryRecord | null {
      const row = getRecordByIdStmt.get(id) as RawRecord | undefined;
      return row ? rowToRecord(row) : null;
    },

    countRecords(status?: string): number {
      if (status) {
        const row = countRecordsStmt.get(status) as { count: number };
        return row.count;
      }
      const row = countAllStmt.get() as { count: number };
      return row.count;
    },

    getSourceByHash(hash: string): SourceRecord | null {
      const row = getSourceByHashStmt.get(hash) as RawSource | undefined;
      return row ? rowToSource(row) : null;
    },

    insertSource(record: SourceRecord): void {
      insertSourceStmt.run({
        ...record,
        title: record.title ?? null,
        type: record.type ?? null,
        date: record.date ?? null,
        memory_item_ids: JSON.stringify(record.memory_item_ids),
      });
    },

    listSources(): SourceRecord[] {
      return (listSourcesStmt.all() as RawSource[]).map(rowToSource);
    },

    insertOAuthClient(record: OAuthClientRecord): void {
      insertOAuthClientStmt.run({
        ...record,
        client_name: record.client_name ?? null,
        redirect_uris: JSON.stringify(record.redirect_uris),
      });
    },

    getOAuthClient(clientId: string): OAuthClientRecord | null {
      const row = getOAuthClientStmt.get(clientId) as RawOAuthClient | undefined;
      return row ? rowToOAuthClient(row) : null;
    },

    insertAuthGrant(record: AuthGrantRecord): void {
      insertAuthGrantStmt.run({
        ...record,
        label: record.label ?? null,
        scopes: JSON.stringify(record.scopes),
        approval_code_hash: record.approval_code_hash ?? null,
        approval_code_expires_at: record.approval_code_expires_at ?? null,
        approval_code_consumed_at: record.approval_code_consumed_at ?? null,
        expires_at: record.expires_at ?? null,
        revoked_at: record.revoked_at ?? null,
      });
    },

    listAuthGrants(): AuthGrantRecord[] {
      return (listAuthGrantsStmt.all() as RawAuthGrant[]).map(rowToAuthGrant);
    },

    getAuthGrant(id: string): AuthGrantRecord | null {
      const row = getAuthGrantStmt.get(id) as RawAuthGrant | undefined;
      return row ? rowToAuthGrant(row) : null;
    },

    getAuthGrantByApprovalCodeHash(hash: string): AuthGrantRecord | null {
      const row = getAuthGrantByApprovalCodeHashStmt.get(hash) as RawAuthGrant | undefined;
      return row ? rowToAuthGrant(row) : null;
    },

    updateAuthGrant(id: string, updates: Partial<AuthGrantRecord>): void {
      updateAuthGrantStmt.run({
        id,
        subject: updates.subject ?? null,
        label: updates.label ?? null,
        resource: updates.resource ?? null,
        scopes: updates.scopes ? JSON.stringify(updates.scopes) : null,
        approval_code_hash: updates.approval_code_hash ?? null,
        approval_code_expires_at: updates.approval_code_expires_at ?? null,
        approval_code_consumed_at: updates.approval_code_consumed_at ?? null,
        expires_at: updates.expires_at ?? null,
        revoked_at: updates.revoked_at ?? null,
        updated_at: updates.updated_at ?? new Date().toISOString(),
      });
    },

    insertOAuthAuthorizationCode(record: OAuthAuthorizationCodeRecord): void {
      insertOAuthAuthorizationCodeStmt.run({
        ...record,
        scopes: JSON.stringify(record.scopes),
        consumed_at: record.consumed_at ?? null,
      });
    },

    getOAuthAuthorizationCode(codeHash: string): OAuthAuthorizationCodeRecord | null {
      const row = getOAuthAuthorizationCodeStmt.get(codeHash) as
        | RawOAuthAuthorizationCode
        | undefined;
      return row ? rowToOAuthAuthorizationCode(row) : null;
    },

    consumeOAuthAuthorizationCode(codeHash: string, consumedAt: string): void {
      consumeOAuthAuthorizationCodeStmt.run(consumedAt, codeHash);
    },

    insertOAuthRefreshToken(record: OAuthRefreshTokenRecord): void {
      insertOAuthRefreshTokenStmt.run({
        ...record,
        scopes: JSON.stringify(record.scopes),
        revoked_at: record.revoked_at ?? null,
      });
    },

    getOAuthRefreshToken(tokenHash: string): OAuthRefreshTokenRecord | null {
      const row = getOAuthRefreshTokenStmt.get(tokenHash) as RawOAuthRefreshToken | undefined;
      return row ? rowToOAuthRefreshToken(row) : null;
    },

    updateOAuthRefreshToken(tokenHash: string, updates: Partial<OAuthRefreshTokenRecord>): void {
      updateOAuthRefreshTokenStmt.run({
        token_hash: tokenHash,
        scopes: updates.scopes ? JSON.stringify(updates.scopes) : null,
        resource: updates.resource ?? null,
        expires_at: updates.expires_at ?? null,
        revoked_at: updates.revoked_at ?? null,
        updated_at: updates.updated_at ?? new Date().toISOString(),
      });
    },

    persist: persistFn,
  };
}
