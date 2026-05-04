export type MemoryKind =
  | "profile"
  | "fact"
  | "preference"
  | "principle"
  | "opinion"
  | "communication_style"
  | "private"
  | "decision"
  | "instruction"
  | "summary"
  | "relationship";

export type MemoryCategory =
  | "profile"
  | "fact"
  | "preference"
  | "principle"
  | "opinion"
  | "communication_style"
  | "private"
  | "ignore";

export type Confidence = "low" | "medium" | "high";
export type Sensitivity = "public" | "personal" | "private" | "sensitive";
export type UpdateType = "add" | "update" | "ignore";

export interface MemoryItem {
  id?: string;
  category: MemoryCategory;
  content: string;
  confidence: Confidence;
  evidence?: string;
  sensitivity: Sensitivity;
  update_type: UpdateType;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  subject?: string;
  predicate?: string;
  value?: string;
  tags: string[];
  confidence: number;
  importance: number;
  source_id?: string;
  status: "active" | "archived" | "superseded" | "disputed";
  visibility: "normal" | "sensitive" | "secret";
  created_at: string;
  updated_at: string;
  last_used_at?: string;
  supersedes?: string[];
}

export interface MemoryDatabase {
  insertRecord(record: MemoryRecord): void;
  updateRecord(id: string, updates: Partial<MemoryRecord>): void;
  queryRecords(filters?: {
    status?: string;
    excludeVisibility?: string[];
    includeVisibility?: string[];
    kind?: string[];
  }): MemoryRecord[];
  searchRecords(query: string, limit?: number): MemoryRecord[];
  getRecordById(id: string): MemoryRecord | null;
  countRecords(status?: string): number;
  getSourceByHash(hash: string): SourceRecord | null;
  insertSource(record: SourceRecord): void;
  listSources(): SourceRecord[];
  insertOAuthClient(record: OAuthClientRecord): void;
  getOAuthClient(clientId: string): OAuthClientRecord | null;
  insertAuthGrant(record: AuthGrantRecord): void;
  listAuthGrants(): AuthGrantRecord[];
  getAuthGrant(id: string): AuthGrantRecord | null;
  getAuthGrantByApprovalCodeHash(hash: string): AuthGrantRecord | null;
  updateAuthGrant(id: string, updates: Partial<AuthGrantRecord>): void;
  insertOAuthAuthorizationCode(record: OAuthAuthorizationCodeRecord): void;
  getOAuthAuthorizationCode(codeHash: string): OAuthAuthorizationCodeRecord | null;
  consumeOAuthAuthorizationCode(codeHash: string, consumedAt: string): void;
  insertOAuthRefreshToken(record: OAuthRefreshTokenRecord): void;
  getOAuthRefreshToken(tokenHash: string): OAuthRefreshTokenRecord | null;
  updateOAuthRefreshToken(tokenHash: string, updates: Partial<OAuthRefreshTokenRecord>): void;
  persist(): void;
}

export interface OAuthClientRecord {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  created_at: string;
}

export interface AuthGrantRecord {
  id: string;
  subject: string;
  label?: string;
  resource: string;
  scopes: string[];
  approval_code_hash?: string;
  approval_code_expires_at?: string;
  approval_code_consumed_at?: string;
  expires_at?: string;
  revoked_at?: string;
  created_at: string;
  updated_at: string;
}

export interface OAuthAuthorizationCodeRecord {
  code_hash: string;
  client_id: string;
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  resource: string;
  expires_at: string;
  created_at: string;
  consumed_at?: string;
}

export interface OAuthRefreshTokenRecord {
  token_hash: string;
  client_id: string;
  grant_id: string;
  scopes: string[];
  resource: string;
  expires_at: string;
  revoked_at?: string;
  created_at: string;
  updated_at: string;
}

export type SourceType =
  | "owner_answer"
  | "chat_transcript"
  | "document"
  | "note"
  | "article"
  | "video_transcript"
  | "audio_transcript"
  | "other";

export interface SourceRecord {
  id: string;
  title?: string;
  type?: SourceType;
  date?: string;
  created_at: string;
  content_hash: string;
  memory_item_ids: string[];
}

export interface IngestInput {
  content: string;
  source_type?: SourceType;
  source_title?: string;
  source_date?: string;
  instructions?: string;
}

export interface IngestOutput {
  success: boolean;
  memory_items_added: number;
  memory_items_updated: number;
  ignored_items: number;
  summary: string;
  warnings?: string[];
}

export type AskMode = "about_owner" | "as_owner" | "likely_opinion" | "draft_response";
export type Audience = "owner" | "public" | "trusted" | "unknown";
export type Authority = "memory_backed" | "inferred" | "style_only" | "insufficient_memory";

export interface AskInput {
  question: string;
  context?: string;
  mode?: AskMode;
  audience?: Audience;
}

export interface AskOutput {
  answer: string;
  confidence: Confidence;
  authority: Authority;
  used_memory?: string[];
  warnings?: string[];
}

export type MemoryGoal =
  | "build_initial_memory"
  | "improve_profile"
  | "learn_preferences"
  | "learn_principles"
  | "learn_opinions"
  | "learn_communication_style"
  | "fill_gaps"
  | "general";

export interface SuggestQuestionInput {
  goal?: MemoryGoal;
  topic?: string;
  audience?: Audience;
  previous_questions?: string[];
}

export interface SuggestQuestionOutput {
  question: string;
  purpose: string;
  expected_memory_categories: Array<Exclude<MemoryCategory, "ignore">>;
  suggested_source_type: "owner_answer";
}

export interface GenerateInput {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateOutput {
  text: string;
}

export interface Config {
  server?: {
    port?: number;
  };
  auth?: {
    mode?: "off" | "local";
    issuer?: string;
    resource?: string;
    anonymous_enabled?: boolean;
    signing_key?: Buffer;
  };
  owner: {
    name: string | null;
    preferred_language: string | null;
  };
  llm: {
    provider: string;
    model: string;
    model_path: string;
    temperature: number;
    max_tokens: number;
  };
  memory: {
    path: string;
    mode?: "encrypted" | "plain";
    storage?: MemoryDatabase;
  };
  safety: {
    allow_first_person: boolean;
    public_can_access_private_memory: boolean;
    require_disclaimer_for_inferred_answers: boolean;
  };
}

export interface MergeResult {
  added: number;
  updated: number;
  ignored: number;
}
