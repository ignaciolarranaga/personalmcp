import type { Config, MemoryDatabase } from "../types.js";

export function requireMemoryDatabase(config: Config): MemoryDatabase {
  if (config.memory.storage) return config.memory.storage;
  throw new Error("Memory database has not been initialized.");
}
