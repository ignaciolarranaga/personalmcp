import { Command, InvalidArgumentError } from "commander";

export type MemoryFormat = "markdown" | "jsonl";

export interface CommonCommandOptions {
  debugEnabled: boolean;
  passwordFile?: string;
}

export type ServeCommandOptions = CommonCommandOptions;

export interface MemoryCommandOptions extends CommonCommandOptions {
  format: MemoryFormat;
}

export interface SetupModelCommandOptions {
  model?: string;
  listModels: boolean;
  writeConfig: boolean;
}

export interface CliHandlers {
  serve: (options: ServeCommandOptions) => Promise<void>;
  exportMemory: (options: MemoryCommandOptions) => Promise<void>;
  importMemory: (filePath: string, options: MemoryCommandOptions) => Promise<void>;
  setupModel: (options: SetupModelCommandOptions) => Promise<void>;
}

export function createCliProgram(handlers: CliHandlers): Command {
  const program = new Command();

  program
    .name("aiprofile")
    .description("A local-first MCP server that acts as your personal digital twin")
    .version("0.1.0")
    .showHelpAfterError()
    .showSuggestionAfterError();

  program
    .command("serve")
    .description("Start the AIProfile HTTP server")
    .option("--debug", "Enable debug logging")
    .option("--password-file <path>", "Read memory password from file")
    .action(async (options: CommanderCommonOptions) => {
      await handlers.serve(toCommonOptions(options));
    });

  const memory = program.command("memory").description("Import and export local memory records");

  memory
    .command("export")
    .description("Export active memory records to stdout")
    .option("--format <format>", "Output format: markdown or jsonl", parseMemoryFormat, "markdown")
    .option("--debug", "Enable debug logging")
    .option("--password-file <path>", "Read memory password from file")
    .action(async (options: CommanderMemoryOptions) => {
      await handlers.exportMemory(toMemoryOptions(options));
    });

  memory
    .command("import")
    .description("Import memory records from a file")
    .argument("<file>", "Markdown or JSON Lines file to import")
    .option("--format <format>", "Input format: markdown or jsonl", parseMemoryFormat, "markdown")
    .option("--debug", "Enable debug logging")
    .option("--password-file <path>", "Read memory password from file")
    .action(async (filePath: string, options: CommanderMemoryOptions) => {
      await handlers.importMemory(filePath, toMemoryOptions(options));
    });

  program
    .command("setup-model")
    .description("Download a local GGUF model")
    .option("--model <model>", "Curated model ID, Hugging Face URI, or GGUF URL")
    .option("--list-models", "List curated model recommendations")
    .option("--write-config", "Update config.yaml to use the downloaded model")
    .action(async (options: CommanderSetupModelOptions) => {
      await handlers.setupModel({
        model: options.model,
        listModels: options.listModels === true,
        writeConfig: options.writeConfig === true,
      });
    });

  return program;
}

export async function runCliProgram(program: Command, argv: string[]): Promise<void> {
  if (argv.length === 0) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv, { from: "user" });
}

interface CommanderCommonOptions {
  debug?: boolean;
  passwordFile?: string;
}

interface CommanderMemoryOptions extends CommanderCommonOptions {
  format: MemoryFormat;
}

interface CommanderSetupModelOptions {
  model?: string;
  listModels?: boolean;
  writeConfig?: boolean;
}

function toCommonOptions(options: CommanderCommonOptions): CommonCommandOptions {
  return {
    debugEnabled: options.debug === true,
    passwordFile: options.passwordFile,
  };
}

function toMemoryOptions(options: CommanderMemoryOptions): MemoryCommandOptions {
  return {
    ...toCommonOptions(options),
    format: options.format,
  };
}

function parseMemoryFormat(value: string): MemoryFormat {
  if (value === "markdown" || value === "jsonl") return value;
  throw new InvalidArgumentError("format must be either markdown or jsonl");
}
