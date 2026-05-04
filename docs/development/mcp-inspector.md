# Debugging with MCP Inspector

The Anthropic and Model Context Protocol debugging tool is MCP Inspector. It gives you a browser UI for connecting to an MCP server, listing tools, inspecting schemas, and calling tools with test inputs.

Start AIProfile in one terminal:

```bash
npm run build
npm start
```

To include server-side MCP call traces and local LLM prompt/output snippets, start with:

```bash
npm start -- --debug
```

Start the Inspector in another terminal:

```bash
npx @modelcontextprotocol/inspector
```

The Inspector terminal prints a proxy session token. If the UI shows **Proxy Authentication Required**, copy that token, open **Configuration** in the Inspector UI, paste it into the proxy or session token field, and save.

Open the Inspector UI, usually `http://localhost:6274`, then connect with:

- Transport type: `Streamable HTTP`
- URL: `http://localhost:3000/mcp`

After connecting, open the **Tools** tab and run **List Tools**.

Without OAuth authorization, you should only see:

- `ask`

After completing the OAuth flow with an owner grant, you should see:

- `ingest`
- `ask`
- `suggest_question`

Use the Inspector to call a tool directly and inspect the raw response. If a call fails, check both terminals: the Inspector terminal shows client and proxy connection issues, and the AIProfile terminal shows server-side errors such as model loading, config, or tool execution failures.
