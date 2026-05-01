import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const llamaMocks = vi.hoisted(() => ({
  getLlama: vi.fn(),
  getVramState: vi.fn(),
  resolveModelFile: vi.fn(),
}));

vi.mock("node-llama-cpp", () => ({
  getLlama: llamaMocks.getLlama,
  resolveModelFile: llamaMocks.resolveModelFile,
}));

const originalCwd = process.cwd();
const gib = 1024 ** 3;

describe("setup-model", () => {
  let tempDir: string;
  let consoleError: MockInstance<typeof console.error>;
  let consoleLog: MockInstance<typeof console.log>;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "personalmcp-setup-model-")));
    writeFileSync(join(tempDir, "config.yaml"), makeConfigYaml(), "utf-8");
    vi.resetModules();
    vi.clearAllMocks();
    llamaMocks.getLlama.mockResolvedValue({ getVramState: llamaMocks.getVramState });
    llamaMocks.getVramState.mockResolvedValue({
      total: 4 * gib,
      free: 3 * gib,
      unifiedSize: 0,
    });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  it("downloads the default model with its stable target filename", async () => {
    const { setupModel } = await import("../src/setup-model.js");
    const expectedPath = join(tempDir, "models", "qwen3-4b-instruct-q4_k_m.gguf");
    llamaMocks.resolveModelFile.mockResolvedValue(expectedPath);

    await setupModel({ listModels: false, writeConfig: false });

    expect(llamaMocks.resolveModelFile).toHaveBeenCalledWith(
      "hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
      {
        directory: join(tempDir, "models"),
        fileName: "qwen3-4b-instruct-q4_k_m.gguf",
      },
    );
  });

  it("resolves curated model IDs and writes config when requested", async () => {
    const { setupModel } = await import("../src/setup-model.js");
    const expectedPath = join(tempDir, "models", "llama-3.2-3b-instruct-q4_k_m.gguf");
    llamaMocks.resolveModelFile.mockResolvedValue(expectedPath);

    await setupModel({ model: "llama-3.2-3b", listModels: false, writeConfig: true });

    expect(llamaMocks.resolveModelFile).toHaveBeenCalledWith(
      "hf:bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
      {
        directory: join(tempDir, "models"),
        fileName: "llama-3.2-3b-instruct-q4_k_m.gguf",
      },
    );
    expect(readConfig()).toMatchObject({
      llm: {
        model: "llama-3.2-3b",
        model_path: "./models/llama-3.2-3b-instruct-q4_k_m.gguf",
        provider: "node-llama-cpp",
      },
      memory: {
        path: "./memory",
      },
    });
  });

  it("resolves custom model specs into the models directory without forcing a filename", async () => {
    const { setupModel } = await import("../src/setup-model.js");
    const expectedPath = join(tempDir, "models", "Custom-Model.Q4_K_M.gguf");
    llamaMocks.resolveModelFile.mockResolvedValue(expectedPath);

    await setupModel({
      model: "hf:example/Custom-Model-GGUF:Q4_K_M",
      listModels: false,
      writeConfig: false,
    });

    expect(llamaMocks.resolveModelFile).toHaveBeenCalledWith(
      "hf:example/Custom-Model-GGUF:Q4_K_M",
      {
        directory: join(tempDir, "models"),
        fileName: undefined,
      },
    );
    expect(consoleError).toHaveBeenCalledWith("  model: custom-model.q4_k_m");
    expect(consoleError).toHaveBeenCalledWith("  model_path: ./models/Custom-Model.Q4_K_M.gguf");
  });

  it("skips downloading when a curated target already exists", async () => {
    const { setupModel } = await import("../src/setup-model.js");
    const targetPath = join(tempDir, "models", "llama-3.2-3b-instruct-q4_k_m.gguf");
    mkdirSync(join(tempDir, "models"));
    writeFileSync(targetPath, "existing", "utf-8");

    await setupModel({ model: "llama-3.2-3b", listModels: false, writeConfig: false });

    expect(existsSync(targetPath)).toBe(true);
    expect(llamaMocks.resolveModelFile).not.toHaveBeenCalled();
  });

  it("prints curated recommendations with memory fit labels", async () => {
    const { printModelRecommendations } = await import("../src/setup-model.js");

    printModelRecommendations({
      totalRamGb: 8,
      freeRamGb: 5,
      gpuAvailable: false,
      vramDetectionError: "No GPU VRAM reported by node-llama-cpp.",
    });

    const output = consoleLog.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("llama-3.2-3b [recommended]");
    expect(output).toContain("qwen3-8b [too large]");
    expect(output).toContain("using RAM-only guidance");
  });

  it("falls back to RAM-only hardware detection when VRAM detection fails", async () => {
    llamaMocks.getLlama.mockRejectedValue(new Error("no backend"));
    const { detectHardwareProfile } = await import("../src/setup-model.js");

    const hardware = await detectHardwareProfile();

    expect(hardware.gpuAvailable).toBe(false);
    expect(hardware.totalRamGb).toBeGreaterThan(0);
    expect(hardware.vramDetectionError).toBe("no backend");
  });
});

function readConfig() {
  return yaml.load(readFileSync(join(tempDirForRead(), "config.yaml"), "utf-8"));
}

function tempDirForRead(): string {
  return process.cwd();
}

function makeConfigYaml(): string {
  return `server:
  port: 3000

owner:
  name: null
  preferred_language: null

llm:
  provider: node-llama-cpp
  model: qwen3-4b-instruct-q4_k_m
  model_path: ./models/qwen3-4b-instruct-q4_k_m.gguf
  temperature: 0.2
  max_tokens: 1200

memory:
  path: ./memory
  mode: encrypted

safety:
  allow_first_person: true
  public_can_access_private_memory: false
  require_disclaimer_for_inferred_answers: true
`;
}
