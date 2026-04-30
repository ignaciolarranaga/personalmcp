import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { resolve } from "path";
import type { LlmProvider } from "./LlmProvider.js";
import type { GenerateInput, GenerateOutput } from "../types.js";

export class NodeLlamaCppProvider implements LlmProvider {
  private modelPath: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;
  private llama: Awaited<ReturnType<typeof getLlama>> | null = null;
  private model: Awaited<ReturnType<Awaited<ReturnType<typeof getLlama>>["loadModel"]>> | null = null;

  constructor(modelPath: string, temperature = 0.2, maxTokens = 1200) {
    this.modelPath = resolve(modelPath);
    this.defaultTemperature = temperature;
    this.defaultMaxTokens = maxTokens;
  }

  async initialize(): Promise<void> {
    console.error(`[PersonalMCP] Loading model from ${this.modelPath}...`);
    this.llama = await getLlama();
    this.model = await this.llama.loadModel({ modelPath: this.modelPath });
    console.error("[PersonalMCP] Model loaded.");
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    if (!this.model) {
      throw new Error("LLM provider not initialized. Call initialize() first.");
    }

    const context = await this.model.createContext();
    try {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: input.system,
      });

      const text = await session.prompt(input.prompt, {
        temperature: input.temperature ?? this.defaultTemperature,
        maxTokens: input.maxTokens ?? this.defaultMaxTokens,
      });

      return { text };
    } finally {
      await context.dispose();
    }
  }
}
