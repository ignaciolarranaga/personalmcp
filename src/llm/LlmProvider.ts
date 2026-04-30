import type { GenerateInput, GenerateOutput } from "../types.js";

export interface LlmProvider {
  initialize(): Promise<void>;
  generate(input: GenerateInput): Promise<GenerateOutput>;
}
