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
  memory_items: string[];
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
