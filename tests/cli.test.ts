import { describe, expect, it, vi } from "vitest";
import { createCliProgram, runCliProgram, type CliHandlers } from "../src/cli.js";

describe("CLI", () => {
  it("shows top-level help with the expected commands", async () => {
    const { output, program } = makeTestProgram();

    await expect(runCliProgram(program, ["--help"])).rejects.toMatchObject({
      code: "commander.helpDisplayed",
      exitCode: 0,
    });

    expect(output()).toContain("serve");
    expect(output()).toContain("auth");
    expect(output()).toContain("memory");
    expect(output()).toContain("setup-model");
  });

  it("shows help and exits successfully when no command is provided", async () => {
    const { output, program } = makeTestProgram();

    await runCliProgram(program, []);

    expect(output()).toContain("Usage: aiprofile");
    expect(output()).toContain("Commands:");
  });

  it("rejects unknown commands", async () => {
    const { program } = makeTestProgram();

    await expect(runCliProgram(program, ["unknown"])).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
    });
  });

  it("parses memory export formats", async () => {
    const { handlers, program } = makeTestProgram();

    await runCliProgram(program, ["memory", "export", "--format", "jsonl"]);

    expect(handlers.exportMemory).toHaveBeenCalledWith({
      debugEnabled: false,
      format: "jsonl",
      passwordFile: undefined,
    });
  });

  it("parses memory import formats", async () => {
    const { handlers, program } = makeTestProgram();

    await runCliProgram(program, [
      "memory",
      "import",
      "memory-backup.md",
      "--format",
      "markdown",
      "--password-file",
      "./local-password-file",
    ]);

    expect(handlers.importMemory).toHaveBeenCalledWith("memory-backup.md", {
      debugEnabled: false,
      format: "markdown",
      passwordFile: "./local-password-file",
    });
  });

  it("rejects invalid memory formats", async () => {
    const { program } = makeTestProgram();

    await expect(
      runCliProgram(program, ["memory", "export", "--format", "xml"]),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
      exitCode: 1,
    });
  });

  it("parses setup-model options", async () => {
    const { handlers, program } = makeTestProgram();

    await runCliProgram(program, [
      "setup-model",
      "--model",
      "llama-3.2-3b",
      "--list-models",
      "--write-config",
    ]);

    expect(handlers.setupModel).toHaveBeenCalledWith({
      model: "llama-3.2-3b",
      listModels: true,
      writeConfig: true,
    });
  });

  it("parses auth grant add options", async () => {
    const { handlers, program } = makeTestProgram();

    await runCliProgram(program, [
      "auth",
      "grant",
      "add",
      "--subject",
      "ignaciolarranaga",
      "--preset",
      "owner-full",
      "--scope",
      "aiprofile:ask",
      "--scope",
      "aiprofile:ingest",
      "--expires-in",
      "24h",
      "--resource",
      "http://localhost:3000/mcp",
      "--password-file",
      "./local-password-file",
    ]);

    expect(handlers.addAuthGrant).toHaveBeenCalledWith({
      debugEnabled: false,
      passwordFile: "./local-password-file",
      subject: "ignaciolarranaga",
      label: undefined,
      scopes: ["aiprofile:ask", "aiprofile:ingest"],
      presets: ["owner-full"],
      expiresIn: "24h",
      resource: "http://localhost:3000/mcp",
    });
  });

  it("parses auth grant list and revoke", async () => {
    const { handlers, program } = makeTestProgram();

    await runCliProgram(program, ["auth", "grant", "list"]);
    await runCliProgram(program, ["auth", "grant", "revoke", "grant_123", "--debug"]);

    expect(handlers.listAuthGrants).toHaveBeenCalledWith({
      debugEnabled: false,
      passwordFile: undefined,
    });
    expect(handlers.revokeAuthGrant).toHaveBeenCalledWith("grant_123", {
      debugEnabled: true,
      passwordFile: undefined,
    });
  });

  it("rejects the removed fallback option", async () => {
    const { program } = makeTestProgram();

    await expect(runCliProgram(program, ["setup-model", "--fallback"])).rejects.toMatchObject({
      code: "commander.unknownOption",
      exitCode: 1,
    });
  });
});

function makeTestProgram() {
  let capturedOutput = "";
  const handlers: CliHandlers = {
    serve: vi.fn(async () => undefined),
    addAuthGrant: vi.fn(async () => undefined),
    listAuthGrants: vi.fn(async () => undefined),
    revokeAuthGrant: vi.fn(async () => undefined),
    exportMemory: vi.fn(async () => undefined),
    importMemory: vi.fn(async () => undefined),
    setupModel: vi.fn(async () => undefined),
  };
  const program = createCliProgram(handlers);
  configureTestCommand(program, {
    writeOut: (str) => {
      capturedOutput += str;
    },
    writeErr: (str) => {
      capturedOutput += str;
    },
  });

  return {
    handlers,
    output: () => capturedOutput,
    program,
  };
}

type OutputConfig = Parameters<ReturnType<typeof createCliProgram>["configureOutput"]>[0];

function configureTestCommand(
  command: ReturnType<typeof createCliProgram>,
  outputConfig: OutputConfig,
): void {
  command.exitOverride();
  command.configureOutput(outputConfig);
  for (const subcommand of command.commands) {
    configureTestCommand(subcommand, outputConfig);
  }
}
