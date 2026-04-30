import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeLlamaCppProvider } from "../src/llm/NodeLlamaCppProvider.js";
import type { DebugLogger } from "../src/debug.js";

const mocks = vi.hoisted(() => ({
  dispose: vi.fn<() => Promise<void>>(),
  prompt: vi.fn<() => Promise<string>>(),
}));

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(async () => ({
    loadModel: vi.fn(async () => ({
      createContext: vi.fn(async () => ({
        getSequence: () => "test-sequence",
        dispose: mocks.dispose,
      })),
    })),
  })),
  LlamaChatSession: class {
    async prompt(): Promise<string> {
      return mocks.prompt();
    }
  },
}));

class CapturingDebugLogger implements DebugLogger {
  readonly enabled = true;
  readonly events: Array<{ event: string; details?: Record<string, unknown> }> = [];

  log(event: string, details?: Record<string, unknown>): void {
    this.events.push({ event, details });
  }
}

describe("NodeLlamaCppProvider debug logging", () => {
  beforeEach(() => {
    mocks.dispose.mockResolvedValue(undefined);
    mocks.prompt.mockResolvedValue("generated output");
  });

  it("logs LLM prompt and output snippets when debug logging is enabled", async () => {
    const debugLogger = new CapturingDebugLogger();
    const provider = new NodeLlamaCppProvider("/tmp/test-model.gguf", 0.2, 1200, debugLogger);

    await provider.initialize();
    const result = await provider.generate({
      system: "system prompt",
      prompt: "user prompt",
      temperature: 0.4,
      maxTokens: 500,
    });

    expect(result).toEqual({ text: "generated output" });
    expect(debugLogger.events).toEqual([
      {
        event: "llm.generate.start",
        details: {
          temperature: 0.4,
          maxTokens: 500,
          system: "system prompt",
          prompt: "user prompt",
        },
      },
      {
        event: "llm.generate.end",
        details: expect.objectContaining({
          status: "ok",
          output: "generated output",
        }) as Record<string, unknown>,
      },
    ]);
    expect(debugLogger.events[1].details?.durationMs).toEqual(expect.any(Number));
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
