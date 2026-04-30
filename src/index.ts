import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { NodeLlamaCppProvider } from "./llm/NodeLlamaCppProvider.js";
import { createServer } from "./server.js";

async function main() {
  const config = loadConfig();

  const llm = new NodeLlamaCppProvider(
    config.llm.model_path,
    config.llm.temperature,
    config.llm.max_tokens
  );

  await llm.initialize();

  const server = createServer(llm, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[PersonalMCP] Server ready. Listening for MCP requests.");
}

main().catch((err) => {
  console.error("[PersonalMCP] Fatal error:", err);
  process.exit(1);
});
