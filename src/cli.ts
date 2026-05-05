import { Command, InvalidArgumentError } from "commander";
import { AIPROFILE_VERSION } from "./version.js";

export type MemoryFormat = "markdown" | "jsonl";

export interface CommonCommandOptions {
  debugEnabled: boolean;
  passwordFile?: string;
}

export type ServeCommandOptions = CommonCommandOptions;

export interface AuthTokenCommandOptions extends CommonCommandOptions {
  subject: string;
  label?: string;
  scopes: string[];
  presets: Array<"public-read" | "owner-read" | "maintainer" | "owner-full">;
  expiresIn: string;
  resource?: string;
}

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
  addAuthGrant: (options: AuthTokenCommandOptions) => Promise<void>;
  listAuthGrants: (options: CommonCommandOptions) => Promise<void>;
  revokeAuthGrant: (grantId: string, options: CommonCommandOptions) => Promise<void>;
  exportMemory: (options: MemoryCommandOptions) => Promise<void>;
  importMemory: (filePath: string, options: MemoryCommandOptions) => Promise<void>;
  setupModel: (options: SetupModelCommandOptions) => Promise<void>;
}

export function createCliProgram(handlers: CliHandlers): Command {
  const program = new Command();

  program
    .name("aiprofile")
    .description(
      "A local-first MCP server for structured, agent-readable identity and context profiles",
    )
    .version(AIPROFILE_VERSION)
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

  const auth = program.command("auth").description("Manage OAuth grants for MCP auth");
  const authGrant = auth.command("grant").description("Manage local OAuth grants");

  authGrant
    .command("add")
    .description("Create an OAuth grant and print its one-time approval code")
    .requiredOption("--subject <label>", "Human-readable local subject label")
    .option("--label <name>", "Optional grant label")
    .option("--scope <scope>", "Scope to grant. Repeat for multiple scopes.", collectScope, [])
    .option(
      "--preset <preset>",
      "Grant preset: public-read, owner-read, maintainer, owner-full. Repeat for multiple presets.",
      collectPreset,
      [],
    )
    .option("--expires-in <duration>", "Grant lifetime, e.g. 24h or 30d", "30d")
    .option("--resource <url>", "MCP resource URL this grant may access")
    .option("--debug", "Enable debug logging")
    .option("--password-file <path>", "Read memory password from file")
    .action(async (options: CommanderAuthTokenOptions) => {
      await handlers.addAuthGrant(toAuthTokenOptions(options));
    });

  authGrant
    .command("list")
    .description("List OAuth grants")
    .option("--debug", "Enable debug logging")
    .option("--password-file <path>", "Read memory password from file")
    .action(async (options: CommanderCommonOptions) => {
      await handlers.listAuthGrants(toCommonOptions(options));
    });

  authGrant
    .command("revoke")
    .description("Revoke an OAuth grant")
    .argument("<grant-id>", "Grant ID to revoke")
    .option("--debug", "Enable debug logging")
    .option("--password-file <path>", "Read memory password from file")
    .action(async (grantId: string, options: CommanderCommonOptions) => {
      await handlers.revokeAuthGrant(grantId, toCommonOptions(options));
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

interface CommanderAuthTokenOptions extends CommanderCommonOptions {
  subject: string;
  label?: string;
  scope?: string[];
  preset?: Array<"public-read" | "owner-read" | "maintainer" | "owner-full">;
  expiresIn: string;
  resource?: string;
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

function toAuthTokenOptions(options: CommanderAuthTokenOptions): AuthTokenCommandOptions {
  return {
    ...toCommonOptions(options),
    subject: options.subject,
    label: options.label,
    scopes: options.scope ?? [],
    presets: options.preset ?? [],
    expiresIn: options.expiresIn,
    resource: options.resource,
  };
}

function parseMemoryFormat(value: string): MemoryFormat {
  if (value === "markdown" || value === "jsonl") return value;
  throw new InvalidArgumentError("format must be either markdown or jsonl");
}

function collectScope(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectPreset(
  value: string,
  previous: Array<"public-read" | "owner-read" | "maintainer" | "owner-full">,
): Array<"public-read" | "owner-read" | "maintainer" | "owner-full"> {
  const valid = ["public-read", "owner-read", "maintainer", "owner-full"];
  if (!valid.includes(value)) {
    throw new InvalidArgumentError(`preset must be one of: ${valid.join(", ")}`);
  }
  return [...previous, value as "public-read" | "owner-read" | "maintainer" | "owner-full"];
}
