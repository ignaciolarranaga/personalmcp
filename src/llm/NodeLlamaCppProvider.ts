import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { resolve } from "path";
import { noopDebugLogger, type DebugLogger } from "../debug.js";
import type { LlmProvider } from "./LlmProvider.js";
import type { GenerateInput, GenerateOutput } from "../types.js";

export class NodeLlamaCppProvider implements LlmProvider {
  private modelPath: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;
  private debugLogger: DebugLogger;
  private llama: Awaited<ReturnType<typeof getLlama>> | null = null;
  private model: Awaited<ReturnType<Awaited<ReturnType<typeof getLlama>>["loadModel"]>> | null =
    null;

  constructor(
    modelPath: string,
    temperature = 0.2,
    maxTokens = 1200,
    debugLogger: DebugLogger = noopDebugLogger,
  ) {
    this.modelPath = resolve(modelPath);
    this.defaultTemperature = temperature;
    this.defaultMaxTokens = maxTokens;
    this.debugLogger = debugLogger;
  }

  async initialize(): Promise<void> {
    console.error(`[AIProfile] Loading model from ${this.modelPath}...`);
    this.llama = await getLlama();
    this.model = await this.llama.loadModel({ modelPath: this.modelPath });
    console.error("[AIProfile] Model loaded.");
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    if (!this.model) {
      throw new Error("LLM provider not initialized. Call initialize() first.");
    }

    const temperature = input.temperature ?? this.defaultTemperature;
    const maxTokens = input.maxTokens ?? this.defaultMaxTokens;
    const startedAt = Date.now();

    this.debugLogger.log("llm.generate.start", {
      temperature,
      maxTokens,
      system: input.system,
      prompt: input.prompt,
    });

    const context = await this.model.createContext();
    try {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: input.system,
      });

      const text = await session.prompt(input.prompt, {
        temperature,
        maxTokens,
      });

      this.debugLogger.log("llm.generate.end", {
        status: "ok",
        durationMs: Date.now() - startedAt,
        output: text,
      });

      return { text };
    } catch (err) {
      this.debugLogger.log("llm.generate.error", {
        status: "error",
        durationMs: Date.now() - startedAt,
        error: err,
      });
      throw err;
    } finally {
      await context.dispose();
    }
  }
}
