import { getLlama, resolveModelFile } from "node-llama-cpp";
import { mkdirSync, existsSync, renameSync } from "fs";
import { resolve, join } from "path";

const DEFAULT_MODEL = "hf:unsloth/Qwen3-4B-Instruct-GGUF:*Q4_K_M*";
const FALLBACK_MODEL = "hf:bartowski/Llama-3.2-3B-Instruct-GGUF:*Q4_K_M*";
const MODELS_DIR = resolve("./models");
const DEFAULT_TARGET = join(MODELS_DIR, "qwen3-4b-instruct-q4_k_m.gguf");
const FALLBACK_TARGET = join(MODELS_DIR, "llama-3.2-3b-instruct-q4_k_m.gguf");

const isFallback = process.argv.includes("--fallback");
const modelSpec = isFallback ? FALLBACK_MODEL : DEFAULT_MODEL;
const targetPath = isFallback ? FALLBACK_TARGET : DEFAULT_TARGET;
const modelLabel = isFallback ? "Llama-3.2-3B (fallback)" : "Qwen3-4B (default)";

console.error(`[setup-model] Setting up ${modelLabel}...`);
console.error(`[setup-model] Target: ${targetPath}`);

if (existsSync(targetPath)) {
  console.error(`[setup-model] Model already exists at ${targetPath}. Nothing to do.`);
  process.exit(0);
}

if (!existsSync(MODELS_DIR)) {
  mkdirSync(MODELS_DIR, { recursive: true });
}

try {
  console.error(`[setup-model] Resolving model: ${modelSpec}`);
  console.error("[setup-model] This may take a while depending on your connection (~2-3 GB download).");

  const llama = await getLlama();
  const downloadedPath = await resolveModelFile(modelSpec, MODELS_DIR);

  if (resolve(downloadedPath) !== resolve(targetPath)) {
    renameSync(downloadedPath, targetPath);
  }

  console.error(`[setup-model] Model ready at ${targetPath}`);
  console.error("[setup-model] You can now run: npm run build && npm start");
} catch (err) {
  console.error(`\n[setup-model] ERROR: Failed to download model.`);
  console.error(`Reason: ${err instanceof Error ? err.message : String(err)}`);
  console.error("\nManual download instructions:");
  console.error("─".repeat(60));
  if (isFallback) {
    console.error("1. Visit: https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF");
    console.error("2. Download: Llama-3.2-3B-Instruct-Q4_K_M.gguf");
    console.error(`3. Save to: ${FALLBACK_TARGET}`);
    console.error("4. Update config.yaml: llm.model_path to point to the fallback model");
  } else {
    console.error("1. Visit: https://huggingface.co/unsloth/Qwen3-4B-Instruct-GGUF");
    console.error("2. Download: Qwen3-4B-Instruct-Q4_K_M.gguf");
    console.error(`3. Save to: ${DEFAULT_TARGET}`);
  }
  console.error("─".repeat(60));
  process.exit(1);
}
