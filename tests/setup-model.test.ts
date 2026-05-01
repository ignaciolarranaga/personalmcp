import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
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
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "aiprofile-setup-model-")));
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
    vi.doUnmock("node:os");
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  it("automatically selects the best model by default", async () => {
    mockSystemMemory(16, 10);
    llamaMocks.getVramState.mockResolvedValue({
      total: 0,
      free: 0,
      unifiedSize: 0,
    });
    const { setupModel } = await import("../src/setup-model.js");
    const expectedPath = join(tempDir, "models", "qwen3-8b-q4_k_m.gguf");
    llamaMocks.resolveModelFile.mockResolvedValue(expectedPath);

    await setupModel({ listModels: false, writeConfig: false });

    expect(llamaMocks.resolveModelFile).toHaveBeenCalledWith("hf:Qwen/Qwen3-8B-GGUF:Q4_K_M", {
      directory: join(tempDir, "models"),
      fileName: "qwen3-8b-q4_k_m.gguf",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[setup-model] Selected model for this machine: qwen3-8b (Qwen3-8B Q4_K_M)",
    );
  });

  it("lets explicit curated model IDs bypass automatic selection", async () => {
    mockSystemMemory(128, 96);
    const { setupModel } = await import("../src/setup-model.js");
    const expectedPath = join(tempDir, "models", "qwen3-4b-instruct-q4_k_m.gguf");
    llamaMocks.resolveModelFile.mockResolvedValue(expectedPath);

    await setupModel({ model: "qwen3-4b", listModels: false, writeConfig: false });

    expect(llamaMocks.getVramState).not.toHaveBeenCalled();
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

  it("resolves newer single-file curated model IDs", async () => {
    const { setupModel } = await import("../src/setup-model.js");
    const expectedPath = join(tempDir, "models", "phi-4-q4_k_m.gguf");
    llamaMocks.resolveModelFile.mockResolvedValue(expectedPath);

    await setupModel({ model: "phi-4", listModels: false, writeConfig: true });

    expect(llamaMocks.resolveModelFile).toHaveBeenCalledWith("hf:bartowski/phi-4-GGUF:Q4_K_M", {
      directory: join(tempDir, "models"),
      fileName: "phi-4-q4_k_m.gguf",
    });
    expect(readConfig()).toMatchObject({
      llm: {
        model: "phi-4",
        model_path: "./models/phi-4-q4_k_m.gguf",
        provider: "node-llama-cpp",
      },
    });
  });

  it("keeps split curated model entrypoints as the first GGUF part", async () => {
    const { setupModel } = await import("../src/setup-model.js");
    const expectedPath = join(tempDir, "models", "gpt-oss-120b-q4_k_m-00001-of-00002.gguf");
    llamaMocks.resolveModelFile.mockResolvedValue(expectedPath);

    await setupModel({ model: "gpt-oss-120b", listModels: false, writeConfig: true });

    expect(llamaMocks.resolveModelFile).toHaveBeenCalledWith(
      "hf:unsloth/gpt-oss-120b-GGUF:Q4_K_M",
      {
        directory: join(tempDir, "models"),
        fileName: "gpt-oss-120b-q4_k_m.gguf",
      },
    );
    expect(existsSync(join(tempDir, "models", "gpt-oss-120b-q4_k_m.gguf"))).toBe(false);
    expect(readConfig()).toMatchObject({
      llm: {
        model: "gpt-oss-120b",
        model_path: "./models/gpt-oss-120b-q4_k_m-00001-of-00002.gguf",
        provider: "node-llama-cpp",
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

  it("skips downloading split models only when all parts already exist", async () => {
    const { setupModel } = await import("../src/setup-model.js");
    const modelsDir = join(tempDir, "models");
    const firstPart = join(modelsDir, "gpt-oss-120b-q4_k_m-00001-of-00002.gguf");
    const secondPart = join(modelsDir, "gpt-oss-120b-q4_k_m-00002-of-00002.gguf");
    mkdirSync(modelsDir);
    writeFileSync(firstPart, "existing 1", "utf-8");
    writeFileSync(secondPart, "existing 2", "utf-8");

    await setupModel({ model: "gpt-oss-120b", listModels: false, writeConfig: false });

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

  it("prints recommendations for 32GB machines", async () => {
    const { printModelRecommendations } = await import("../src/setup-model.js");

    printModelRecommendations({
      totalRamGb: 32,
      freeRamGb: 24,
      gpuAvailable: false,
    });

    const output = consoleLog.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("mistral-small-3.2-24b [recommended]");
    expect(output).toContain("qwen3-32b [possible]");
    expect(output).toContain("llama-3.3-70b [too large]");
  });

  it("prints recommendations for 64GB machines", async () => {
    const { printModelRecommendations } = await import("../src/setup-model.js");

    printModelRecommendations({
      totalRamGb: 64,
      freeRamGb: 48,
      gpuAvailable: false,
    });

    const output = consoleLog.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("llama-3.3-70b [possible]");
    expect(output).toContain("deepseek-r1-llama-70b [possible]");
    expect(output).toContain("gpt-oss-120b [too large]");
  });

  it("prints split-model recommendations for 128GB machines", async () => {
    const { printModelRecommendations } = await import("../src/setup-model.js");

    printModelRecommendations({
      totalRamGb: 128,
      freeRamGb: 96,
      gpuAvailable: false,
    });

    const output = consoleLog.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("gpt-oss-120b [recommended]");
    expect(output).toContain("llama-4-scout [recommended]");
    expect(output).toContain("mistral-large-2411 [recommended]");
    expect(output).toContain("Split GGUF: downloads 2 parts; keep them together.");
  });

  it("selects best curated models for representative RAM-only machines", async () => {
    const { selectBestCuratedModel } = await import("../src/setup-model.js");

    expect(selectBestCuratedModel(makeHardware(8)).id).toBe("llama-3.2-3b");
    expect(selectBestCuratedModel(makeHardware(16)).id).toBe("qwen3-8b");
    expect(selectBestCuratedModel(makeHardware(32)).id).toBe("mistral-small-3.2-24b");
    expect(selectBestCuratedModel(makeHardware(64)).id).toBe("deepseek-r1-qwen-32b");
    expect(selectBestCuratedModel(makeHardware(128)).id).toBe("mistral-large-2411");
  });

  it("falls back to qwen3-4b when no curated model is recommended", async () => {
    const { selectBestCuratedModel } = await import("../src/setup-model.js");

    expect(selectBestCuratedModel(makeHardware(2)).id).toBe("qwen3-4b");
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

function mockSystemMemory(totalRamGb: number, freeRamGb: number): void {
  vi.doMock("node:os", async () => {
    const actual = await vi.importActual<typeof import("node:os")>("node:os");
    return {
      ...actual,
      totalmem: () => totalRamGb * gib,
      freemem: () => freeRamGb * gib,
    };
  });
}

function makeHardware(totalRamGb: number) {
  return {
    totalRamGb,
    freeRamGb: totalRamGb * 0.75,
    gpuAvailable: false,
  };
}

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
