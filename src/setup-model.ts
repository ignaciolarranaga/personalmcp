import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import yaml from "js-yaml";
import { getLlama, resolveModelFile } from "node-llama-cpp";
import type { Config } from "./types.js";

const MODELS_DIR = resolve("./models");
const CONFIG_PATH = resolve("./config.yaml");
const DEFAULT_MODEL_ID = "qwen3-4b";

export type ModelFit = "recommended" | "possible" | "too large";

export interface CuratedModel {
  id: string;
  label: string;
  spec: string;
  targetFile: string;
  diskSizeGb: number;
  minimumRamGb: number;
  recommendedRamGb: number;
  recommendedVramGb?: number;
  suitability: string;
  manualUrl: string;
  manualFile: string;
}

export interface HardwareProfile {
  totalRamGb: number;
  freeRamGb: number;
  totalVramGb?: number;
  freeVramGb?: number;
  gpuAvailable: boolean;
  vramDetectionError?: string;
}

export interface SetupModelOptions {
  model?: string;
  listModels: boolean;
  writeConfig: boolean;
}

export const CURATED_MODELS: CuratedModel[] = [
  {
    id: DEFAULT_MODEL_ID,
    label: "Qwen3-4B-Instruct Q4_K_M",
    spec: "hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    targetFile: "qwen3-4b-instruct-q4_k_m.gguf",
    diskSizeGb: 2.5,
    minimumRamGb: 8,
    recommendedRamGb: 12,
    recommendedVramGb: 4,
    suitability: "Default. Good instruction following and multilingual support.",
    manualUrl: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF",
    manualFile: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  },
  {
    id: "llama-3.2-3b",
    label: "Llama-3.2-3B-Instruct Q4_K_M",
    spec: "hf:bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    targetFile: "llama-3.2-3b-instruct-q4_k_m.gguf",
    diskSizeGb: 2,
    minimumRamGb: 6,
    recommendedRamGb: 8,
    recommendedVramGb: 3,
    suitability: "Low-memory option. Faster, but less capable than the default.",
    manualUrl: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF",
    manualFile: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "qwen3-0.6b",
    label: "Qwen3-0.6B Q8_0",
    spec: "hf:Qwen/Qwen3-0.6B-GGUF:Q8_0",
    targetFile: "qwen3-0.6b-q8_0.gguf",
    diskSizeGb: 0.8,
    minimumRamGb: 4,
    recommendedRamGb: 6,
    recommendedVramGb: 2,
    suitability: "Tiny option for constrained machines and smoke tests.",
    manualUrl: "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF",
    manualFile: "Qwen3-0.6B-Q8_0.gguf",
  },
  {
    id: "qwen3-8b",
    label: "Qwen3-8B Q4_K_M",
    spec: "hf:Qwen/Qwen3-8B-GGUF:Q4_K_M",
    targetFile: "qwen3-8b-q4_k_m.gguf",
    diskSizeGb: 5,
    minimumRamGb: 12,
    recommendedRamGb: 16,
    recommendedVramGb: 6,
    suitability: "Stronger responses on machines with more memory.",
    manualUrl: "https://huggingface.co/Qwen/Qwen3-8B-GGUF",
    manualFile: "Qwen3-8B-Q4_K_M.gguf",
  },
];

interface ModelSelection {
  id?: string;
  label: string;
  spec: string;
  targetPath?: string;
  manualUrl?: string;
  manualFile?: string;
}

export async function setupModel(options: SetupModelOptions): Promise<void> {
  if (options.listModels) {
    printModelRecommendations(await detectHardwareProfile());
    return;
  }

  const selection = selectModel(options.model);
  console.error(`[setup-model] Setting up ${selection.label}...`);
  console.error(
    selection.targetPath
      ? `[setup-model] Target: ${selection.targetPath}`
      : `[setup-model] Target directory: ${MODELS_DIR}`,
  );

  const modelPath = await resolveSelectedModel(selection);
  const modelName = selection.id ?? modelNameFromPath(modelPath);
  const configModelPath = formatConfigModelPath(modelPath);

  if (options.writeConfig) {
    writeModelConfig(modelName, configModelPath);
    console.error(`[setup-model] Updated config.yaml: llm.model_path: ${configModelPath}`);
  } else {
    printConfigInstructions(modelName, configModelPath);
  }

  console.error(`[setup-model] Model ready at ${modelPath}`);
  console.error("[setup-model] You can now run: personalmcp serve");
}

export function selectModel(model?: string): ModelSelection {
  if (!model) {
    return selectionFromCuratedModel(getCuratedModel(DEFAULT_MODEL_ID));
  }

  const curatedModel = CURATED_MODELS.find((entry) => entry.id === model);
  if (curatedModel) {
    return selectionFromCuratedModel(curatedModel);
  }

  return {
    label: model,
    spec: model,
  };
}

export function assessModelFit(model: CuratedModel, hardware: HardwareProfile): ModelFit {
  if (hardware.totalRamGb < model.minimumRamGb) {
    return "too large";
  }

  if (hardware.totalRamGb < model.recommendedRamGb) {
    return "possible";
  }

  if (
    hardware.gpuAvailable &&
    model.recommendedVramGb != null &&
    (hardware.totalVramGb ?? 0) < model.recommendedVramGb
  ) {
    return "possible";
  }

  return "recommended";
}

export async function detectHardwareProfile(): Promise<HardwareProfile> {
  const hardware: HardwareProfile = {
    totalRamGb: bytesToGb(totalmem()),
    freeRamGb: bytesToGb(freemem()),
    gpuAvailable: false,
  };

  try {
    const llama = await getLlama();
    const vramState = await llama.getVramState();
    if (vramState.total > 0) {
      hardware.gpuAvailable = true;
      hardware.totalVramGb = bytesToGb(vramState.total);
      hardware.freeVramGb = bytesToGb(vramState.free);
    } else {
      hardware.vramDetectionError = "No GPU VRAM reported by node-llama-cpp.";
    }
  } catch (err) {
    hardware.vramDetectionError = err instanceof Error ? err.message : String(err);
  }

  return hardware;
}

export function printModelRecommendations(hardware: HardwareProfile): void {
  console.log("Curated GGUF models for PersonalMCP");
  console.log(
    `Detected memory: ${formatGb(hardware.totalRamGb)} RAM total, ${formatGb(
      hardware.freeRamGb,
    )} RAM free`,
  );

  if (hardware.gpuAvailable) {
    console.log(
      `Detected GPU memory: ${formatGb(hardware.totalVramGb ?? 0)} VRAM total, ${formatGb(
        hardware.freeVramGb ?? 0,
      )} VRAM free`,
    );
  } else {
    console.log(
      `GPU memory: unavailable; using RAM-only guidance${
        hardware.vramDetectionError ? ` (${hardware.vramDetectionError})` : ""
      }`,
    );
  }

  console.log("");

  for (const model of CURATED_MODELS) {
    const fit = assessModelFit(model, hardware);
    console.log(`${model.id} [${fit}]`);
    console.log(`  ${model.label} - ~${formatGb(model.diskSizeGb)} download`);
    console.log(
      `  Memory: ${formatGb(model.minimumRamGb)}+ RAM minimum, ${formatGb(
        model.recommendedRamGb,
      )}+ RAM recommended${
        model.recommendedVramGb != null
          ? `, ${formatGb(model.recommendedVramGb)}+ VRAM helpful`
          : ""
      }`,
    );
    console.log(`  ${model.suitability}`);
    console.log(`  Command: personalmcp setup-model --model ${model.id}`);
    console.log("");
  }
}

async function resolveSelectedModel(selection: ModelSelection): Promise<string> {
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }

  if (selection.targetPath && existsSync(selection.targetPath)) {
    console.error(`[setup-model] Model already exists at ${selection.targetPath}. Nothing to do.`);
    return selection.targetPath;
  }

  try {
    console.error(`[setup-model] Resolving model: ${selection.spec}`);
    console.error("[setup-model] This may take a while depending on your connection and model size.");

    await getLlama();
    const downloadedPath = await resolveModelFile(selection.spec, {
      directory: MODELS_DIR,
      fileName: selection.targetPath ? basename(selection.targetPath) : undefined,
    });

    if (selection.targetPath && resolve(downloadedPath) !== resolve(selection.targetPath)) {
      renameSync(downloadedPath, selection.targetPath);
      return selection.targetPath;
    }

    return downloadedPath;
  } catch (err) {
    printManualDownloadInstructions(selection);
    throw err;
  }
}

function selectionFromCuratedModel(model: CuratedModel): ModelSelection {
  return {
    id: model.id,
    label: model.label,
    spec: model.spec,
    targetPath: join(MODELS_DIR, model.targetFile),
    manualUrl: model.manualUrl,
    manualFile: model.manualFile,
  };
}

function getCuratedModel(id: string): CuratedModel {
  const model = CURATED_MODELS.find((entry) => entry.id === id);
  if (!model) {
    throw new Error(`Unknown curated model: ${id}`);
  }
  return model;
}

function writeModelConfig(model: string, modelPath: string): void {
  let parsed: Config;
  try {
    parsed = yaml.load(readFileSync(CONFIG_PATH, "utf-8")) as Config;
  } catch {
    throw new Error(`Cannot read config file at ${CONFIG_PATH}. Make sure config.yaml exists.`);
  }

  if (!parsed?.llm) {
    throw new Error("config.yaml must include llm settings to update the model.");
  }

  parsed.llm.model = model;
  parsed.llm.model_path = modelPath;
  writeFileSync(CONFIG_PATH, yaml.dump(parsed, { lineWidth: 100 }), "utf-8");
}

function printConfigInstructions(model: string, modelPath: string): void {
  console.error("[setup-model] To use this model, update config.yaml or rerun with --write-config:");
  console.error("llm:");
  console.error(`  model: ${model}`);
  console.error(`  model_path: ${modelPath}`);
}

function printManualDownloadInstructions(selection: ModelSelection): void {
  console.error("\n[setup-model] ERROR: Failed to download model.");
  console.error("\nManual download instructions:");
  console.error("-".repeat(60));

  const nextStep = selection.manualUrl && selection.manualFile && selection.targetPath ? 4 : 3;

  if (selection.manualUrl && selection.manualFile && selection.targetPath) {
    console.error(`1. Visit: ${selection.manualUrl}`);
    console.error(`2. Download: ${selection.manualFile}`);
    console.error(`3. Save to: ${selection.targetPath}`);
  } else {
    console.error(`1. Download a GGUF model from: ${selection.spec}`);
    console.error(`2. Save it under: ${MODELS_DIR}`);
  }

  console.error(`${nextStep}. Run: personalmcp setup-model --list-models for supported examples`);
  console.error("-".repeat(60));
}

function formatConfigModelPath(modelPath: string): string {
  const relativePath = relative(process.cwd(), modelPath);
  if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return `./${relativePath.split(sep).join("/")}`;
  }
  return modelPath;
}

function modelNameFromPath(modelPath: string): string {
  return basename(modelPath)
    .replace(/\.gguf(?:\.part\d+of\d+)?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function bytesToGb(bytes: number): number {
  return bytes / 1024 ** 3;
}

function formatGb(value: number): string {
  return `${Math.round(value * 10) / 10} GB`;
}
