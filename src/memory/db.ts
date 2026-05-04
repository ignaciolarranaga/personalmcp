import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import type { MemoryDatabase, MemoryRecord, SourceRecord } from "../types.js";

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

    persist: persistFn,
  };
}
