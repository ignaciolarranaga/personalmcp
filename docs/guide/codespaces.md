# GitHub Codespaces

[Create a Codespace for AIProfile](https://codespaces.new/ignaciolarranaga/aiprofile)

The repository includes a `.devcontainer` setup for Codespaces. It uses Node.js 22 and installs the native build tools needed by `better-sqlite3` and `node-llama-cpp`, including `build-essential`, Python, CMake, Ninja, and related compiler tooling.

When the Codespace is created it runs:

```bash
npm ci
npm run build
```

After the Codespace is ready, download the local model explicitly:

```bash
npm run setup-model
```

The model is about 2.5 GB and is stored in `./models/`, which is ignored by Git. Codespaces should compile and run the project on CPU. GPU acceleration such as Metal is not available there, and CUDA depends on the Codespaces machine type.

Start the server with:

```bash
npm start
```

Port `3000` is forwarded automatically for the MCP endpoint at `/mcp`.
