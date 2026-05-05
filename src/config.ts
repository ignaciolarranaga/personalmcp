import { readFileSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";
import type { Config } from "./types.js";

export function loadConfig(configPath?: string): Config {
  const filePath = resolve(configPath ?? "config.yaml");
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    if (!configPath) return defaultConfig();
    throw new Error(`Cannot read config file at ${filePath}. Make sure config.yaml exists.`);
  }

  const parsed = yaml.load(raw) as Config;

  if (!parsed?.llm?.model_path) {
    throw new Error("config.yaml must include llm.model_path");
  }
  if (!parsed?.memory?.path) {
    throw new Error("config.yaml must include memory.path");
  }
  parsed.memory.mode = parsed.memory.mode ?? "encrypted";
  if (parsed.memory.mode !== "encrypted" && parsed.memory.mode !== "plain") {
    throw new Error("config.yaml memory.mode must be either encrypted or plain");
  }
  parsed.auth = parsed.auth ?? {};
  parsed.auth.mode = parsed.auth.mode ?? "local";
  parsed.auth.anonymous_enabled = parsed.auth.anonymous_enabled ?? true;

  return parsed;
}

export function defaultConfig(): Config {
  return {
    server: {
      port: 3000,
    },
    auth: {
      mode: "local",
      anonymous_enabled: true,
    },
    owner: {
      name: null,
      preferred_language: null,
    },
    llm: {
      provider: "node-llama-cpp",
      model: "qwen3-4b-instruct-q4_k_m",
      model_path: "./models/qwen3-4b-instruct-q4_k_m.gguf",
      temperature: 0.2,
      max_tokens: 1200,
      context_tokens: 4096,
    },
    memory: {
      path: "./memory",
      mode: "encrypted",
    },
    safety: {
      allow_first_person: true,
      public_can_access_private_memory: false,
      require_disclaimer_for_inferred_answers: true,
    },
  };
}
