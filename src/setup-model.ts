import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { getLlama, resolveModelFile } from "node-llama-cpp";

const DEFAULT_MODEL = "hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const FALLBACK_MODEL = "hf:bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf";
const MODELS_DIR = resolve("./models");
const DEFAULT_TARGET = join(MODELS_DIR, "qwen3-4b-instruct-q4_k_m.gguf");
const FALLBACK_TARGET = join(MODELS_DIR, "llama-3.2-3b-instruct-q4_k_m.gguf");

export interface SetupModelOptions {
  fallback: boolean;
}

export async function setupModel(options: SetupModelOptions): Promise<void> {
  const modelSpec = options.fallback ? FALLBACK_MODEL : DEFAULT_MODEL;
  const targetPath = options.fallback ? FALLBACK_TARGET : DEFAULT_TARGET;
  const modelLabel = options.fallback
    ? "Llama-3.2-3B (fallback)"
    : "Qwen3-4B-Instruct-2507 (default)";

  console.error(`[setup-model] Setting up ${modelLabel}...`);
  console.error(`[setup-model] Target: ${targetPath}`);

  if (existsSync(targetPath)) {
    console.error(`[setup-model] Model already exists at ${targetPath}. Nothing to do.`);
    return;
  }

  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }

  try {
    console.error(`[setup-model] Resolving model: ${modelSpec}`);
    console.error(
      "[setup-model] This may take a while depending on your connection (~2-3 GB download).",
    );

    await getLlama();
    const downloadedPath = await resolveModelFile(modelSpec, {
      directory: MODELS_DIR,
      fileName: basename(targetPath),
    });

    if (resolve(downloadedPath) !== resolve(targetPath)) {
      renameSync(downloadedPath, targetPath);
    }

    console.error(`[setup-model] Model ready at ${targetPath}`);
    console.error("[setup-model] You can now run: personalmcp serve");
  } catch (err) {
    printManualDownloadInstructions(options.fallback);
    throw err;
  }
}

function printManualDownloadInstructions(isFallback: boolean): void {
  console.error("\n[setup-model] ERROR: Failed to download model.");
  console.error("\nManual download instructions:");
  console.error("-".repeat(60));
  if (isFallback) {
    console.error("1. Visit: https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF");
    console.error("2. Download: Llama-3.2-3B-Instruct-Q4_K_M.gguf");
    console.error(`3. Save to: ${FALLBACK_TARGET}`);
    console.error("4. Update config.yaml: llm.model_path to point to the fallback model");
  } else {
    console.error("1. Visit: https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF");
    console.error("2. Download: Qwen3-4B-Instruct-2507-Q4_K_M.gguf");
    console.error(`3. Save to: ${DEFAULT_TARGET}`);
  }
  console.error("-".repeat(60));
}
