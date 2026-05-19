# Obsidian AI Assistant

**English** · [Русский](./README.ru.md)

Local AI chat with tool calling for your Obsidian vault. Connects to any OpenAI-compatible endpoint — [vLLM](https://github.com/vllm-project/vllm), [llama.cpp](https://github.com/ggerganov/llama.cpp), [LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com) (with its OpenAI-compatible API), or a hosted OpenAI-style service — and gives the model the ability to read, write, and search your notes directly.

> All inference can stay on your machine. No data leaves the vault unless you point it at a remote endpoint.

---

## Features

- **Streaming chat** in a right-panel view, with Markdown rendering and `[[wikilinks]]`
- **Tool calling** — the model can act on your vault:
  - `list_files`, `read_file`, `write_file`, `edit_file`, `append_to_file`, `delete_file`
  - `search` (with optional `ripgrep` integration for speed)
  - `get_backlinks`, `get_outlinks`, `get_tags`
- **Active note context** — the currently open note is automatically injected
- **Automatic history summarization** when context grows past a configurable threshold
- **Per-tool toggles** — disable anything you don't want the model to do
- **Safe by design** — all paths are normalized and confined to the vault; `delete_file` goes to the system trash, never permanent

---

## Installation

### Option A — manual install from GitHub Releases (recommended)

1. Go to [Releases](https://github.com/cop1cat/obsidian-ai-assistant/releases) and download the latest release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. In your vault, create the folder `<vault>/.obsidian/plugins/obsidian-ai-assistant/` and drop the three files into it.
3. In Obsidian: **Settings → Community plugins → Reload plugins**, then enable **AI Assistant**.

### Option B — install from source (latest `main`)

Requires Node 18+ and [pnpm](https://pnpm.io/).

```bash
git clone https://github.com/cop1cat/obsidian-ai-assistant.git
cd obsidian-ai-assistant
pnpm install
pnpm run build
```

Copy or symlink the build output into your vault:

```bash
# Replace /path/to/vault with your real vault path.
mkdir -p /path/to/vault/.obsidian/plugins/obsidian-ai-assistant
ln -sf "$(pwd)/main.js"       /path/to/vault/.obsidian/plugins/obsidian-ai-assistant/main.js
ln -sf "$(pwd)/manifest.json" /path/to/vault/.obsidian/plugins/obsidian-ai-assistant/manifest.json
ln -sf "$(pwd)/styles.css"    /path/to/vault/.obsidian/plugins/obsidian-ai-assistant/styles.css
```

Then in Obsidian: **Settings → Community plugins → Reload plugins**, and enable **AI Assistant**.

### Option C — install via BRAT

If you use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin (Beta Reviewers Auto-update Tool):

1. Open BRAT settings → **Add Beta plugin**
2. Paste: `cop1cat/obsidian-ai-assistant`
3. Enable the plugin in **Settings → Community plugins**

BRAT will keep it up to date automatically as new releases are published.

---

## Setup

Open **Settings → AI Assistant** and configure:

| Setting | Default | Notes |
|---|---|---|
| **Base URL** | `http://localhost:8000/v1` | OpenAI-compatible endpoint. For Ollama use `http://localhost:11434/v1`. |
| **API key** | `EMPTY` | Local servers usually accept any non-empty value. |
| **Model** | _(empty — required)_ | Model name as exposed by the endpoint (e.g. `Qwen/Qwen2.5-7B-Instruct`). |
| **Temperature / Top-p** | `0.7` / `1.0` | Standard sampling. |
| **Max context tokens** | `100000` | History is summarized when it grows past this. |
| **System prompt** | sensible default | Includes the vault-safety rules; edit freely. |
| **Include active note in context** | `true` | Path + content of the open note is appended to the system message. |
| **ripgrep path** | _(empty)_ | Optional. Set to e.g. `/opt/homebrew/bin/rg` for fast search. |
| **Enabled tools** | all on | Toggle any tool off if you don't want the model to use it. |

Open the chat: click the bot icon in the left ribbon, or run **AI Assistant: Open AI Chat** from the command palette.

---

## Quickstart: running with vLLM

```bash
# In one terminal — serve a model:
pip install vllm
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000
```

Then in the plugin settings set:

- Base URL: `http://localhost:8000/v1`
- API key: `EMPTY`
- Model: `Qwen/Qwen2.5-7B-Instruct`

Open the chat, ask: _"List the top-level folders in my vault and summarize what each contains."_

---

## How tool calling works

On each user message the plugin runs an agentic loop:

1. Send the conversation (plus a system prompt with the vault-safety rules) to the model.
2. If the response contains `tool_calls`, execute each one locally against your vault.
3. Append the results as `role: "tool"` messages and ask the model again.
4. Stop when the model returns a text-only answer.

Hard cap: **20 iterations** per turn. The model is instructed to read before editing, to never invent paths, and to follow your vault's naming conventions.

### What you'll see in the chat

Tool calls appear as collapsible blocks above the assistant's text:

```
✅ 🔧 read_file(path: "Daily/2026-05-19.md")
   ▶ Click to expand arguments and result
```

Streaming responses show a blinking cursor while the model is still talking.

---

## Development

```bash
pnpm install
pnpm run dev        # esbuild watch → main.js
pnpm run typecheck  # strict TS check
pnpm run build      # typecheck + production bundle
```

Smoke test that the bundle loads as Obsidian would (mocks `require("obsidian")`):

```bash
node scripts/smoke-load.mjs
```

For live development, symlink the repo into a test vault (see Option B above) and run `pnpm run dev`. Then **Cmd+R** in Obsidian to reload after each rebuild — or install the [Hot Reload](https://github.com/pjeby/hot-reload) plugin.

Project layout:

```
src/
  main.ts                 plugin entry, ribbon, command, view registration
  settings.ts             settings + SettingTab + runtime config validation
  view/
    ChatView.ts           ItemView in the right panel
    MessageRenderer.ts    markdown rendering + collapsible tool calls
  llm/
    client.ts             OpenAI SDK wrapper, streaming
    agent.ts              tool-calling loop
    summarizer.ts         history compression
    tokenizer.ts          js-tiktoken wrapper
    types.ts              ChatMessage, ToolCall, UI types
  tools/
    index.ts              tool registry
    list_files.ts, read_file.ts, write_file.ts, edit_file.ts,
    append_to_file.ts, delete_file.ts, search.ts,
    get_backlinks.ts, get_outlinks.ts, get_tags.ts
  utils/
    paths.ts              path normalization + vault-confinement
```

---

## Security notes

- **Paths**: all tool arguments are normalized via `normalizePath`, rejected if absolute or containing `..`. Tools only see paths inside your vault.
- **Deletion**: `delete_file` always uses `vault.trash(file, true)` — the system trash, recoverable. Never permanent.
- **Network**: the only outbound calls are to the Base URL you configure. Point it at `localhost` to keep everything offline.
- **Tool gating**: every tool can be disabled in settings. Disable `write_file`, `edit_file`, `delete_file`, `append_to_file` for a read-only assistant.

---

## License

MIT — see [LICENSE](./LICENSE).
