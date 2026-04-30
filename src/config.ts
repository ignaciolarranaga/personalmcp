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

  return parsed;
}
