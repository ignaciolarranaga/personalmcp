import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createDebugLogger } from "./debug.js";
import { NodeLlamaCppProvider } from "./llm/NodeLlamaCppProvider.js";
import { createServer } from "./server.js";
import { initializeMemoryStorage, parseCliOptions } from "./memory/unlock.js";

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const debugLogger = createDebugLogger({ enabled: options.debugEnabled });
  const config = loadConfig();
  await initializeMemoryStorage(config, options);
  const port = config.server?.port ?? 3000;

  const llm = new NodeLlamaCppProvider(
    config.llm.model_path,
    config.llm.temperature,
    config.llm.max_tokens,
    debugLogger,
  );

  await llm.initialize();

  const mcpServer = createServer(llm, config, debugLogger);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);

  const httpServer = createHttpServer(async (req, res) => {
    if (req.url === "/mcp") {
      await transport.handleRequest(req, res);
      return;
    }
    res.writeHead(404).end("Not found");
  });

  httpServer.listen(port, () => {
    console.error(`[PersonalMCP] Server ready on http://localhost:${port}/mcp`);
    if (options.debugEnabled) {
      console.error("[PersonalMCP] Debug logging enabled.");
    }
  });
}

main().catch((err) => {
  console.error("[PersonalMCP] Fatal error:", err);
  process.exit(1);
});
