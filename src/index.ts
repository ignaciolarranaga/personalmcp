import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { NodeLlamaCppProvider } from "./llm/NodeLlamaCppProvider.js";
import { createServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const port = config.server?.port ?? 3000;

  const llm = new NodeLlamaCppProvider(
    config.llm.model_path,
    config.llm.temperature,
    config.llm.max_tokens
  );

  await llm.initialize();

  const mcpServer = createServer(llm, config);
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
  });
}

main().catch((err) => {
  console.error("[PersonalMCP] Fatal error:", err);
  process.exit(1);
});
