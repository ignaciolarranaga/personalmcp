import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("uses built-in defaults when config.yaml is not present", () => {
    const originalCwd = process.cwd();
    const tempDir = mkdtempSync(join(tmpdir(), "aiprofile-config-"));

    try {
      process.chdir(tempDir);

      expect(loadConfig()).toMatchObject({
        server: {
          port: 3000,
        },
        llm: {
          model_path: "./models/qwen3-4b-instruct-q4_k_m.gguf",
        },
        memory: {
          path: "./memory",
          mode: "encrypted",
        },
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
