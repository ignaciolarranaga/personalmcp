import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  family?: string;
  quantization?: string;
  tier?: string;
  spec: string;
  targetFile: string;
  downloadFileName?: string;
  splitParts?: number;
  diskSizeGb: number;
  minimumRamGb: number;
  recommendedRamGb: number;
  recommendedVramGb?: number;
  suitability: string;
  notes?: string;
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
    id: "qwen3-0.6b",
    label: "Qwen3-0.6B Q8_0",
    family: "Qwen",
    quantization: "Q8_0",
    tier: "4-6GB RAM",
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
    id: "llama-3.2-3b",
    label: "Llama-3.2-3B-Instruct Q4_K_M",
    family: "Llama",
    quantization: "Q4_K_M",
    tier: "6-8GB RAM",
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
    id: DEFAULT_MODEL_ID,
    label: "Qwen3-4B-Instruct Q4_K_M",
    family: "Qwen",
    quantization: "Q4_K_M",
    tier: "8-12GB RAM",
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
    id: "phi-4-mini",
    label: "Phi-4-mini-instruct Q4_K_M",
    family: "Phi",
    quantization: "Q4_K_M",
    tier: "8-12GB RAM",
    spec: "hf:bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M",
    targetFile: "phi-4-mini-instruct-q4_k_m.gguf",
    diskSizeGb: 2.6,
    minimumRamGb: 8,
    recommendedRamGb: 12,
    recommendedVramGb: 4,
    suitability: "Small Microsoft Phi option for efficient instruction following.",
    manualUrl: "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF",
    manualFile: "Phi-4-mini-instruct-Q4_K_M.gguf",
  },
  {
    id: "qwen3-8b",
    label: "Qwen3-8B Q4_K_M",
    family: "Qwen",
    quantization: "Q4_K_M",
    tier: "12-16GB RAM",
    spec: "hf:Qwen/Qwen3-8B-GGUF:Q4_K_M",
    targetFile: "qwen3-8b-q4_k_m.gguf",
    diskSizeGb: 4.7,
    minimumRamGb: 12,
    recommendedRamGb: 16,
    recommendedVramGb: 6,
    suitability: "Stronger responses on machines with more memory.",
    manualUrl: "https://huggingface.co/Qwen/Qwen3-8B-GGUF",
    manualFile: "Qwen3-8B-Q4_K_M.gguf",
  },
  {
    id: "gemma-3-12b",
    label: "Gemma-3-12B-IT Q4_K_M",
    family: "Gemma",
    quantization: "Q4_K_M",
    tier: "16-24GB RAM",
    spec: "hf:ggml-org/gemma-3-12b-it-GGUF:Q4_K_M",
    targetFile: "gemma-3-12b-it-q4_k_m.gguf",
    diskSizeGb: 7.3,
    minimumRamGb: 16,
    recommendedRamGb: 24,
    recommendedVramGb: 8,
    suitability: "Gemma option with strong multilingual support and long context.",
    manualUrl: "https://huggingface.co/ggml-org/gemma-3-12b-it-GGUF",
    manualFile: "gemma-3-12b-it-Q4_K_M.gguf",
  },
  {
    id: "qwen3-14b",
    label: "Qwen3-14B Q4_K_M",
    family: "Qwen",
    quantization: "Q4_K_M",
    tier: "16-24GB RAM",
    spec: "hf:Qwen/Qwen3-14B-GGUF:Q4_K_M",
    targetFile: "qwen3-14b-q4_k_m.gguf",
    diskSizeGb: 9,
    minimumRamGb: 16,
    recommendedRamGb: 24,
    recommendedVramGb: 10,
    suitability: "Balanced mid-size Qwen model for reasoning and multilingual work.",
    manualUrl: "https://huggingface.co/Qwen/Qwen3-14B-GGUF",
    manualFile: "Qwen3-14B-Q4_K_M.gguf",
  },
  {
    id: "phi-4",
    label: "Phi-4 Q4_K_M",
    family: "Phi",
    quantization: "Q4_K_M",
    tier: "16-24GB RAM",
    spec: "hf:bartowski/phi-4-GGUF:Q4_K_M",
    targetFile: "phi-4-q4_k_m.gguf",
    diskSizeGb: 9.1,
    minimumRamGb: 16,
    recommendedRamGb: 24,
    recommendedVramGb: 10,
    suitability: "Compact 14B-class model with strong math and code behavior.",
    manualUrl: "https://huggingface.co/bartowski/phi-4-GGUF",
    manualFile: "phi-4-Q4_K_M.gguf",
  },
  {
    id: "gpt-oss-20b",
    label: "gpt-oss-20b Q4_K_M",
    family: "gpt-oss",
    quantization: "Q4_K_M",
    tier: "16-24GB RAM",
    spec: "hf:unsloth/gpt-oss-20b-GGUF:Q4_K_M",
    targetFile: "gpt-oss-20b-q4_k_m.gguf",
    diskSizeGb: 11.6,
    minimumRamGb: 16,
    recommendedRamGb: 24,
    recommendedVramGb: 12,
    suitability: "OpenAI open-weight reasoning model for local agentic tasks.",
    notes: "Uses the gpt-oss harmony chat format; node-llama-cpp resolves this automatically.",
    manualUrl: "https://huggingface.co/unsloth/gpt-oss-20b-GGUF",
    manualFile: "gpt-oss-20b-Q4_K_M.gguf",
  },
  {
    id: "mistral-small-3.2-24b",
    label: "Mistral-Small-3.2-24B-Instruct Q4_K_M",
    family: "Mistral",
    quantization: "Q4_K_M",
    tier: "24-32GB RAM",
    spec: "hf:llmware/mistral-3.2-24b-gguf/Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf",
    targetFile: "mistral-small-3.2-24b-instruct-q4_k_m.gguf",
    diskSizeGb: 14.3,
    minimumRamGb: 24,
    recommendedRamGb: 32,
    recommendedVramGb: 14,
    suitability: "General-purpose Mistral 24B option for higher-memory laptops and desktops.",
    manualUrl: "https://huggingface.co/llmware/mistral-3.2-24b-gguf",
    manualFile: "Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf",
  },
  {
    id: "gemma-3-27b",
    label: "Gemma-3-27B-IT Q4_K_M",
    family: "Gemma",
    quantization: "Q4_K_M",
    tier: "32-48GB RAM",
    spec: "hf:ggml-org/gemma-3-27b-it-GGUF:Q4_K_M",
    targetFile: "gemma-3-27b-it-q4_k_m.gguf",
    diskSizeGb: 16.5,
    minimumRamGb: 32,
    recommendedRamGb: 48,
    recommendedVramGb: 16,
    suitability: "Large Gemma model for quality-focused local use.",
    manualUrl: "https://huggingface.co/ggml-org/gemma-3-27b-it-GGUF",
    manualFile: "gemma-3-27b-it-Q4_K_M.gguf",
  },
  {
    id: "qwen3-30b-a3b",
    label: "Qwen3-30B-A3B MoE Q4_K_M",
    family: "Qwen",
    quantization: "Q4_K_M",
    tier: "32-48GB RAM",
    spec: "hf:Qwen/Qwen3-30B-A3B-GGUF:Q4_K_M",
    targetFile: "qwen3-30b-a3b-q4_k_m.gguf",
    diskSizeGb: 18.6,
    minimumRamGb: 32,
    recommendedRamGb: 48,
    recommendedVramGb: 18,
    suitability: "Efficient MoE Qwen model with only a subset of parameters active per token.",
    manualUrl: "https://huggingface.co/Qwen/Qwen3-30B-A3B-GGUF",
    manualFile: "Qwen3-30B-A3B-Q4_K_M.gguf",
  },
  {
    id: "qwen3-32b",
    label: "Qwen3-32B Q4_K_M",
    family: "Qwen",
    quantization: "Q4_K_M",
    tier: "32-48GB RAM",
    spec: "hf:Qwen/Qwen3-32B-GGUF:Q4_K_M",
    targetFile: "qwen3-32b-q4_k_m.gguf",
    diskSizeGb: 19.8,
    minimumRamGb: 32,
    recommendedRamGb: 48,
    recommendedVramGb: 20,
    suitability: "Dense 32B Qwen model for stronger local reasoning and instruction following.",
    manualUrl: "https://huggingface.co/Qwen/Qwen3-32B-GGUF",
    manualFile: "Qwen3-32B-Q4_K_M.gguf",
  },
  {
    id: "deepseek-r1-qwen-32b",
    label: "DeepSeek-R1-Distill-Qwen-32B Q4_K_M",
    family: "DeepSeek",
    quantization: "Q4_K_M",
    tier: "32-48GB RAM",
    spec: "hf:roleplaiapp/DeepSeek-R1-Distill-Qwen-32B-Q4_K_M-GGUF/deepseek-r1-distill-qwen-32b-q4_k_m.gguf",
    targetFile: "deepseek-r1-distill-qwen-32b-q4_k_m.gguf",
    diskSizeGb: 19.9,
    minimumRamGb: 32,
    recommendedRamGb: 48,
    recommendedVramGb: 20,
    suitability: "Reasoning-focused DeepSeek distillation for math, code, and planning tasks.",
    manualUrl: "https://huggingface.co/roleplaiapp/DeepSeek-R1-Distill-Qwen-32B-Q4_K_M-GGUF",
    manualFile: "deepseek-r1-distill-qwen-32b-q4_k_m.gguf",
  },
  {
    id: "llama-3.3-70b",
    label: "Llama-3.3-70B-Instruct Q4_K_M",
    family: "Llama",
    quantization: "Q4_K_M",
    tier: "64-96GB RAM",
    spec: "hf:bartowski/Llama-3.3-70B-Instruct-GGUF:Q4_K_M",
    targetFile: "llama-3.3-70b-instruct-q4_k_m.gguf",
    diskSizeGb: 42.5,
    minimumRamGb: 64,
    recommendedRamGb: 96,
    recommendedVramGb: 42,
    suitability: "High-end Llama option for Mac Studio-class machines.",
    manualUrl: "https://huggingface.co/bartowski/Llama-3.3-70B-Instruct-GGUF",
    manualFile: "Llama-3.3-70B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "deepseek-r1-llama-70b",
    label: "DeepSeek-R1-Distill-Llama-70B Q4_K_M",
    family: "DeepSeek",
    quantization: "Q4_K_M",
    tier: "64-96GB RAM",
    spec: "hf:lmstudio-community/DeepSeek-R1-Distill-Llama-70B-GGUF:Q4_K_M",
    targetFile: "deepseek-r1-distill-llama-70b-q4_k_m.gguf",
    diskSizeGb: 42.5,
    minimumRamGb: 64,
    recommendedRamGb: 96,
    recommendedVramGb: 42,
    suitability: "Large reasoning-tuned DeepSeek distillation for high-memory Macs.",
    manualUrl: "https://huggingface.co/lmstudio-community/DeepSeek-R1-Distill-Llama-70B-GGUF",
    manualFile: "DeepSeek-R1-Distill-Llama-70B-Q4_K_M.gguf",
  },
  {
    id: "gpt-oss-120b",
    label: "gpt-oss-120b Q4_K_M",
    family: "gpt-oss",
    quantization: "Q4_K_M",
    tier: "80-128GB RAM",
    spec: "hf:unsloth/gpt-oss-120b-GGUF:Q4_K_M",
    targetFile: "gpt-oss-120b-q4_k_m-00001-of-00002.gguf",
    downloadFileName: "gpt-oss-120b-q4_k_m.gguf",
    splitParts: 2,
    diskSizeGb: 62.8,
    minimumRamGb: 80,
    recommendedRamGb: 128,
    recommendedVramGb: 64,
    suitability: "Large OpenAI open-weight reasoning model for top-end local systems.",
    notes: "Split GGUF; all parts must stay in the same models directory.",
    manualUrl: "https://huggingface.co/unsloth/gpt-oss-120b-GGUF",
    manualFile: "Q4_K_M/gpt-oss-120b-Q4_K_M-00001-of-00002.gguf and 00002-of-00002.gguf",
  },
  {
    id: "llama-4-scout",
    label: "Llama-4-Scout-17B-16E-Instruct Q4_K_M",
    family: "Llama",
    quantization: "Q4_K_M",
    tier: "96-128GB RAM",
    spec: "hf:unsloth/Llama-4-Scout-17B-16E-Instruct-GGUF:Q4_K_M",
    targetFile: "llama-4-scout-17b-16e-instruct-q4_k_m-00001-of-00002.gguf",
    downloadFileName: "llama-4-scout-17b-16e-instruct-q4_k_m.gguf",
    splitParts: 2,
    diskSizeGb: 65.3,
    minimumRamGb: 96,
    recommendedRamGb: 128,
    recommendedVramGb: 64,
    suitability: "High-end MoE Llama 4 option for 96GB-128GB unified-memory Macs.",
    notes: "Split GGUF; all parts must stay in the same models directory.",
    manualUrl: "https://huggingface.co/unsloth/Llama-4-Scout-17B-16E-Instruct-GGUF",
    manualFile:
      "Q4_K_M/Llama-4-Scout-17B-16E-Instruct-Q4_K_M-00001-of-00002.gguf and 00002-of-00002.gguf",
  },
  {
    id: "mistral-large-2411",
    label: "Mistral-Large-Instruct-2411 Q4_K_M",
    family: "Mistral",
    quantization: "Q4_K_M",
    tier: "96-128GB RAM",
    spec: "hf:bartowski/Mistral-Large-Instruct-2411-GGUF:Q4_K_M",
    targetFile: "mistral-large-instruct-2411-q4_k_m-00001-of-00002.gguf",
    downloadFileName: "mistral-large-instruct-2411-q4_k_m.gguf",
    splitParts: 2,
    diskSizeGb: 73.3,
    minimumRamGb: 96,
    recommendedRamGb: 128,
    recommendedVramGb: 72,
    suitability: "Very large multilingual Mistral model for top-end Mac Studio-class machines.",
    notes: "Split GGUF; all parts must stay in the same models directory.",
    manualUrl: "https://huggingface.co/bartowski/Mistral-Large-Instruct-2411-GGUF",
    manualFile:
      "Mistral-Large-Instruct-2411-Q4_K_M/Mistral-Large-Instruct-2411-Q4_K_M-00001-of-00002.gguf and 00002-of-00002.gguf",
  },
];

interface ModelSelection {
  id?: string;
  label: string;
  spec: string;
  targetPath?: string;
  downloadFileName?: string;
  splitParts?: number;
  manualUrl?: string;
  manualFile?: string;
}

export async function setupModel(options: SetupModelOptions): Promise<void> {
  if (options.listModels) {
    printModelRecommendations(await detectHardwareProfile());
    return;
  }

  const selection = options.model ? selectModel(options.model) : await selectBestModelForHardware();
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
  console.error("[setup-model] You can now run: aiprofile serve");
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

async function selectBestModelForHardware(): Promise<ModelSelection> {
  const hardware = await detectHardwareProfile();
  const model = selectBestCuratedModel(hardware);
  console.error(`[setup-model] Detected hardware: ${formatHardwareSummary(hardware)}`);
  console.error(`[setup-model] Selected model for this machine: ${model.id} (${model.label})`);
  return selectionFromCuratedModel(model);
}

export function selectBestCuratedModel(hardware: HardwareProfile): CuratedModel {
  const fallback = getCuratedModel(DEFAULT_MODEL_ID);
  const recommendedModels = CURATED_MODELS.filter(
    (model) => assessModelFit(model, hardware) === "recommended",
  );

  if (recommendedModels.length === 0) {
    return fallback;
  }

  return (
    recommendedModels
      .slice()
      .sort((left, right) => compareBestModelCandidates(left, right, hardware))[0] ?? fallback
  );
}

function compareBestModelCandidates(
  left: CuratedModel,
  right: CuratedModel,
  hardware: HardwareProfile,
): number {
  const ramTierDifference = right.recommendedRamGb - left.recommendedRamGb;
  if (ramTierDifference !== 0) {
    return ramTierDifference;
  }

  if (hardware.totalRamGb < 128) {
    const splitDifference = splitPenalty(left) - splitPenalty(right);
    if (splitDifference !== 0) {
      return splitDifference;
    }
  }

  return right.diskSizeGb - left.diskSizeGb;
}

function splitPenalty(model: CuratedModel): number {
  return model.splitParts ? 1 : 0;
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
  console.log("Curated GGUF models for AIProfile");
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
    console.log(
      `  ${model.label} - ${model.family ?? "Local GGUF"}${
        model.quantization ? ` ${model.quantization}` : ""
      } - ~${formatGb(model.diskSizeGb)} download`,
    );
    console.log(
      `  Memory: ${model.tier ? `${model.tier}; ` : ""}${formatGb(
        model.minimumRamGb,
      )}+ RAM minimum, ${formatGb(model.recommendedRamGb)}+ RAM recommended${
        model.recommendedVramGb != null
          ? `, ${formatGb(model.recommendedVramGb)}+ VRAM helpful`
          : ""
      }`,
    );
    console.log(`  ${model.suitability}`);
    if (model.splitParts) {
      console.log(`  Split GGUF: downloads ${model.splitParts} parts; keep them together.`);
    }
    if (model.notes) {
      console.log(`  Note: ${model.notes}`);
    }
    console.log(`  Command: aiprofile setup-model --model ${model.id}`);
    console.log("");
  }
}

async function resolveSelectedModel(selection: ModelSelection): Promise<string> {
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }

  if (selection.targetPath && allTargetPartsExist(selection.targetPath, selection.splitParts)) {
    console.error(`[setup-model] Model already exists at ${selection.targetPath}. Nothing to do.`);
    return selection.targetPath;
  }

  try {
    console.error(`[setup-model] Resolving model: ${selection.spec}`);
    console.error(
      "[setup-model] This may take a while depending on your connection and model size.",
    );

    await getLlama();
    const downloadedPath = await resolveModelFile(selection.spec, {
      directory: MODELS_DIR,
      fileName: selection.downloadFileName,
    });

    if (
      selection.targetPath &&
      !selection.splitParts &&
      resolve(downloadedPath) !== resolve(selection.targetPath)
    ) {
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
    downloadFileName: model.downloadFileName ?? model.targetFile,
    splitParts: model.splitParts,
    manualUrl: model.manualUrl,
    manualFile: model.manualFile,
  };
}

function allTargetPartsExist(targetPath: string, splitParts?: number): boolean {
  if (!splitParts) {
    return existsSync(targetPath);
  }

  return splitPartPaths(targetPath, splitParts).every((partPath) => existsSync(partPath));
}

function splitPartPaths(firstPartPath: string, splitParts: number): string[] {
  const firstPart = basename(firstPartPath);
  const match = firstPart.match(/^(?<prefix>.+)-00001-of-\d{5}\.gguf$/);
  if (!match?.groups?.prefix) {
    return [firstPartPath];
  }

  return Array.from({ length: splitParts }, (_, index) => {
    const part = String(index + 1).padStart(5, "0");
    const parts = String(splitParts).padStart(5, "0");
    return join(dirname(firstPartPath), `${match.groups!.prefix}-${part}-of-${parts}.gguf`);
  });
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
  console.error(
    "[setup-model] To use this model, update config.yaml or rerun with --write-config:",
  );
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
    if (selection.splitParts) {
      console.error(`3. Save all parts under: ${dirname(selection.targetPath)}`);
      console.error(`   Config should point to: ${selection.targetPath}`);
    } else {
      console.error(`3. Save to: ${selection.targetPath}`);
    }
  } else {
    console.error(`1. Download a GGUF model from: ${selection.spec}`);
    console.error(`2. Save it under: ${MODELS_DIR}`);
  }

  console.error(`${nextStep}. Run: aiprofile setup-model --list-models for supported examples`);
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
    .replace(/(?:-\d{5}-of-\d{5})?\.gguf(?:\.part\d+of\d+)?$/i, "")
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

function formatHardwareSummary(hardware: HardwareProfile): string {
  const ramSummary = `${formatGb(hardware.totalRamGb)} RAM total, ${formatGb(hardware.freeRamGb)} RAM free`;

  if (hardware.gpuAvailable) {
    return `${ramSummary}; ${formatGb(hardware.totalVramGb ?? 0)} VRAM total, ${formatGb(
      hardware.freeVramGb ?? 0,
    )} VRAM free`;
  }

  return `${ramSummary}; GPU memory unavailable${
    hardware.vramDetectionError ? ` (${hardware.vramDetectionError})` : ""
  }`;
}
