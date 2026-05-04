# Model Setup

AIProfile runs with local GGUF models supported by `node-llama-cpp`.

## Default model selection

By default, setup detects your machine and downloads the strongest curated model that is comfortably recommended for the available RAM or VRAM:

```bash
npm run setup-model
npx --yes --ignore-scripts=false aiprofile setup-model
```

Use an explicit model ID when you want to override automatic selection:

```bash
npm run setup-model -- --model qwen3-4b
npx --yes --ignore-scripts=false aiprofile setup-model --model qwen3-4b
```

`qwen3-4b` is the safe fallback model if no curated model is recommended for the detected machine.

## Choose a model

List curated GGUF models with RAM and VRAM-aware recommendations:

```bash
npm run setup-model -- --list-models
npx --yes --ignore-scripts=false aiprofile setup-model --list-models
```

Install a curated model by ID:

```bash
npm run setup-model -- --model qwen3-14b --write-config
npx --yes --ignore-scripts=false aiprofile setup-model --model qwen3-14b --write-config
```

`--write-config` updates only `llm.model` and `llm.model_path` in `config.yaml`. Without it, the command prints the exact config values to set manually.

## Mac RAM guide

The curated list uses GGUF files compatible with `node-llama-cpp`. Most options use Q4_K_M because it is a good balance of quality, size, and speed on Apple Silicon. A few tiny models use Q8_0 where the file is still small.

| Mac memory | Try first                                | Notes                                                      |
| ---------: | ---------------------------------------- | ---------------------------------------------------------- |
|       8 GB | `llama-3.2-3b`                           | `qwen3-4b` remains a good explicit fallback.               |
|      16 GB | `qwen3-8b`                               | Good laptop tier for stronger local answers.               |
|      32 GB | `mistral-small-3.2-24b`                  | Better quality, slower startup and generation.             |
|      64 GB | `deepseek-r1-qwen-32b`                   | Avoids 70B models unless they are comfortably recommended. |
|      96 GB | `llama-3.3-70b`, `deepseek-r1-llama-70b` | High-end dense 70B-class models.                           |
|     128 GB | `mistral-large-2411`                     | Split GGUF top-end curated option.                         |

For 192 GB, 256 GB, or 512 GB Mac Studio machines, use custom Hugging Face GGUF URIs for larger models or higher-quality quantizations. The curated catalogue intentionally stops at models that are practical on 128 GB RAM.

## Smaller model

Llama-3.2-3B-Instruct Q4_K_M is about 2 GB and has a lower RAM requirement:

```bash
npm run setup-model -- --model llama-3.2-3b
npx --yes --ignore-scripts=false aiprofile setup-model --model llama-3.2-3b
```

Manual download:

```text
https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF
```

Save as:

```text
./models/llama-3.2-3b-instruct-q4_k_m.gguf
```

## Custom Hugging Face or HTTP GGUF model

```bash
npx --yes --ignore-scripts=false aiprofile setup-model --model hf:Qwen/Qwen3-8B-GGUF:Q4_K_M --write-config
npx --yes --ignore-scripts=false aiprofile setup-model --model hf:Qwen/Qwen3-235B-A22B-GGUF:Q4_K_M
npx --yes --ignore-scripts=false aiprofile setup-model --model https://huggingface.co/user/repo/resolve/main/model.gguf
```

Only GGUF models supported by `node-llama-cpp` can be loaded by AIProfile. Split GGUF models are supported when the model URI resolves to the first `-00001-of-000NN.gguf` part. All downloaded parts must remain in the same directory.
