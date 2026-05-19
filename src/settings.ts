import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type AIAssistantPlugin from "./main";
import { ALL_TOOL_NAMES, TOOL_DESCRIPTIONS, ToolName } from "./tools";

export const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant integrated into an Obsidian vault.

Capabilities:
- You can list, read, create, edit, append, delete, move, and rename markdown notes and folders via tool calls.
- You can create folders, and you can inspect backlinks, outlinks, and tags.
- You have a persistent memory store (lives inside the plugin's settings, not in the vault). Use read_memory at the start of a turn to recall what you learned about this vault before, and write_memory / append_memory to record durable facts (folder conventions, naming patterns, MOC/index notes, recurring topics, user preferences).

Rules:
- All file paths are RELATIVE to the vault root. Never use absolute paths or "..".
- Never invent paths. Use list_files or search to discover the correct path before reading.
- Before edit_file or write_file with overwrite=true, ALWAYS read_file first to see current content.
- For edit_file, old_string must match exactly once (including whitespace).
- When creating new notes, infer the vault's naming convention from existing files (folders, casing, date formats).
- Use [[wikilinks]] when referring to notes in your responses.
- Be concise. Show what you did, not what you are about to do.

Safety — do not perform destructive operations without an explicit user request:
- "Explicit" means the user named the file/folder or unambiguously asked to delete/overwrite/revert. Vague requests ("clean up", "fix this") are NOT explicit consent for destruction.
- Never delete_file unless the user explicitly asked to delete that file by name or path.
- Never overwrite (write_file with overwrite=true), edit_file, or append_to_file in a way that removes or rewrites the user's existing prose, unless they asked for that specific change. Adding new content alongside the user's is fine.
- Never roll back or undo changes you find in a file. Treat the current vault content as the user's source of truth — newer than your memory or expectations.
- Never move/rename or create_folder for files/folders the user did not mention, even if it would "tidy up" the vault.
- If you are unsure whether an action is destructive or whether the user wants it, ASK first. Prefer a clarifying question over a destructive action.
- If a destructive action is the natural next step but wasn't requested, propose it in your reply and wait for confirmation before calling the tool.`;

export interface PluginSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxContextTokens: number;
  temperature: number;
  topP: number;
  enabledTools: Record<ToolName, boolean>;
  ripgrepPath: string;
  requireConfirmation: boolean;
  includeActiveNoteInContext: boolean;
  /** Persistent assistant memory stored inside plugin data (data.json).
   *  Read/written by read_memory / write_memory / append_memory tools. */
  memoryText: string;
  /** Timestamp (ms) of the last memory write. 0 = never written. */
  memoryUpdatedAt: number;
  includeMemoryInContext: boolean;
  /** Free-form JSON merged into each chat-completion request body.
   *  Empty string = no extras. Stored as text so users can author it
   *  directly; parsed lazily by the client (invalid JSON = ignored + warn). */
  extraBody: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  baseUrl: "http://localhost:8000/v1",
  apiKey: "EMPTY",
  model: "",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  maxContextTokens: 100_000,
  temperature: 0.7,
  topP: 1.0,
  enabledTools: ALL_TOOL_NAMES.reduce(
    (acc, name) => ({ ...acc, [name]: true }),
    {} as Record<ToolName, boolean>,
  ),
  ripgrepPath: "",
  requireConfirmation: false,
  includeActiveNoteInContext: true,
  memoryText: "",
  memoryUpdatedAt: 0,
  includeMemoryInContext: true,
  extraBody: "",
};

export function validateSettings(raw: unknown): PluginSettings {
  const defaults = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const str = (k: keyof PluginSettings, fallback: string): string => {
    const v = r[k as string];
    return typeof v === "string" ? v : fallback;
  };
  const num = (k: keyof PluginSettings, fallback: number): number => {
    const v = r[k as string];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const bool = (k: keyof PluginSettings, fallback: boolean): boolean => {
    const v = r[k as string];
    return typeof v === "boolean" ? v : fallback;
  };

  const enabledRaw = (r.enabledTools && typeof r.enabledTools === "object"
    ? (r.enabledTools as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const enabledTools = ALL_TOOL_NAMES.reduce((acc, name) => {
    const v = enabledRaw[name];
    acc[name] = typeof v === "boolean" ? v : defaults.enabledTools[name];
    return acc;
  }, {} as Record<ToolName, boolean>);

  return {
    baseUrl: str("baseUrl", defaults.baseUrl),
    apiKey: str("apiKey", defaults.apiKey),
    model: str("model", defaults.model),
    systemPrompt: str("systemPrompt", defaults.systemPrompt),
    maxContextTokens: Math.max(1024, num("maxContextTokens", defaults.maxContextTokens)),
    temperature: num("temperature", defaults.temperature),
    topP: num("topP", defaults.topP),
    enabledTools,
    ripgrepPath: str("ripgrepPath", defaults.ripgrepPath),
    requireConfirmation: bool("requireConfirmation", defaults.requireConfirmation),
    includeActiveNoteInContext: bool("includeActiveNoteInContext", defaults.includeActiveNoteInContext),
    memoryText: str("memoryText", defaults.memoryText),
    memoryUpdatedAt: num("memoryUpdatedAt", defaults.memoryUpdatedAt),
    includeMemoryInContext: bool("includeMemoryInContext", defaults.includeMemoryInContext),
    extraBody: str("extraBody", defaults.extraBody),
  };
}

/** Full-screen editor for the system prompt — escapes the cramped settings row. */
class SystemPromptModal extends Modal {
  private textarea!: HTMLTextAreaElement;
  private initial: string;

  constructor(
    app: App,
    private plugin: AIAssistantPlugin,
    private onSaved: () => void,
  ) {
    super(app);
    this.initial = plugin.settings.systemPrompt;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ai-system-prompt-modal");
    contentEl.empty();
    contentEl.createEl("h2", { text: "System prompt" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Sent as the system message on every request. Edit freely — the default includes vault-safety rules (paths relative, read before edit, use list_files/search to discover paths).",
    });

    this.textarea = contentEl.createEl("textarea", { cls: "ai-system-prompt-textarea" });
    this.textarea.value = this.initial;
    this.textarea.rows = 24;

    const buttons = contentEl.createDiv({ cls: "ai-system-prompt-buttons" });

    const copyBtn = buttons.createEl("button", { text: "Copy" });
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(this.textarea.value);
        copyBtn.setText("Copied");
        window.setTimeout(() => copyBtn.setText("Copy"), 1200);
      } catch {
        new Notice("Could not copy to clipboard.");
      }
    };

    const resetBtn = buttons.createEl("button", { text: "Reset to default" });
    resetBtn.onclick = () => {
      if (!window.confirm("Replace the prompt with the default? Your edits will be lost.")) return;
      this.textarea.value = DEFAULT_SYSTEM_PROMPT;
    };

    const spacer = buttons.createDiv({ cls: "ai-system-prompt-spacer" });
    spacer.style.flex = "1";

    const cancelBtn = buttons.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = buttons.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.onclick = async () => {
      this.plugin.settings.systemPrompt = this.textarea.value;
      await this.plugin.saveSettings();
      this.onSaved();
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class AIAssistantSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AIAssistantPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AI Assistant — Connection" });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("OpenAI-compatible endpoint (vLLM, llama.cpp, LM Studio, …)")
      .addText((t) =>
        t
          .setPlaceholder("http://localhost:8000/v1")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.baseUrl = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Use EMPTY for local servers that don't require auth.")
      .addText((t) =>
        t
          .setPlaceholder("EMPTY")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Model name as exposed by the endpoint.")
      .addText((t) =>
        t
          .setPlaceholder("Qwen/Qwen2.5-7B-Instruct")
          .setValue(this.plugin.settings.model)
          .onChange(async (v) => {
            this.plugin.settings.model = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h2", { text: "Generation" });

    new Setting(containerEl)
      .setName("Temperature")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.temperature)).onChange(async (v) => {
          const n = parseFloat(v);
          if (Number.isFinite(n)) {
            this.plugin.settings.temperature = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Top-p")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.topP)).onChange(async (v) => {
          const n = parseFloat(v);
          if (Number.isFinite(n)) {
            this.plugin.settings.topP = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Max context tokens")
      .setDesc("History is summarized when it exceeds this threshold.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.maxContextTokens)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.maxContextTokens = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    containerEl.createEl("h2", { text: "System prompt" });

    const promptPreview = containerEl.createEl("pre", { cls: "ai-system-prompt-preview" });
    const renderPreview = () => {
      const txt = this.plugin.settings.systemPrompt;
      const oneLine = txt.replace(/\s+/g, " ").trim();
      promptPreview.setText(oneLine.length > 200 ? oneLine.slice(0, 200) + "…" : oneLine || "(empty)");
    };
    renderPreview();

    new Setting(containerEl)
      .setName("Edit system prompt")
      .setDesc("Opens a full-window editor with copy / reset.")
      .addButton((b) =>
        b.setButtonText("Open editor").onClick(() => {
          new SystemPromptModal(this.app, this.plugin, renderPreview).open();
        }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("copy")
          .setTooltip("Copy current prompt")
          .onClick(async () => {
            try {
              await navigator.clipboard.writeText(this.plugin.settings.systemPrompt);
              new Notice("System prompt copied.");
            } catch {
              new Notice("Could not copy to clipboard.");
            }
          }),
      );

    new Setting(containerEl)
      .setName("Include active note in context")
      .setDesc("Append the currently open note's path and content to the system message.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.includeActiveNoteInContext).onChange(async (v) => {
          this.plugin.settings.includeActiveNoteInContext = v;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h2", { text: "Memory" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Persistent notes the assistant keeps about your vault. Stored inside the plugin (data.json) — not as a vault file. Editable here; the model reads/writes it via the read_memory / write_memory / append_memory tools and (optionally) sees it on every turn.",
    });

    new Setting(containerEl)
      .setName("Inject memory into system prompt")
      .setDesc("Prepend the memory contents to the system message on every turn.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.includeMemoryInContext).onChange(async (v) => {
          this.plugin.settings.includeMemoryInContext = v;
          await this.plugin.saveSettings();
        }),
      );

    const memSetting = new Setting(containerEl).setName("Memory contents");
    const updated = this.plugin.settings.memoryUpdatedAt;
    memSetting.setDesc(
      updated
        ? `Last updated: ${new Date(updated).toLocaleString()}`
        : "Empty — the assistant hasn't recorded anything yet.",
    );
    memSetting.settingEl.addClass("ai-memory-setting");

    const memWrap = containerEl.createDiv({ cls: "ai-memory-editor" });
    const memTa = memWrap.createEl("textarea", { cls: "ai-memory-textarea" });
    memTa.rows = 14;
    memTa.placeholder = "(empty — will be populated by the assistant)";
    memTa.value = this.plugin.settings.memoryText;
    memTa.addEventListener("input", async () => {
      this.plugin.settings.memoryText = memTa.value;
      this.plugin.settings.memoryUpdatedAt = Date.now();
      await this.plugin.saveSettings();
    });

    const memBtns = memWrap.createDiv({ cls: "ai-memory-buttons" });
    const clearBtn = memBtns.createEl("button", { text: "Clear" });
    clearBtn.onclick = async () => {
      if (!window.confirm("Clear all memory? This cannot be undone.")) return;
      this.plugin.settings.memoryText = "";
      this.plugin.settings.memoryUpdatedAt = Date.now();
      memTa.value = "";
      await this.plugin.saveSettings();
      this.display();
    };
    const copyMemBtn = memBtns.createEl("button", { text: "Copy" });
    copyMemBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(memTa.value);
        copyMemBtn.setText("Copied");
        window.setTimeout(() => copyMemBtn.setText("Copy"), 1200);
      } catch {
        new Notice("Could not copy to clipboard.");
      }
    };

    containerEl.createEl("h2", { text: "Extra request params" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Optional JSON object merged into every chat-completion request body. Use it to set server-specific extras like thinking control or reasoning budget. Examples: " +
        "{\"chat_template_kwargs\":{\"enable_thinking\":false}} (Qwen3/vLLM/SGLang — disables thinking), " +
        "{\"reasoning_effort\":\"minimal\"} (OpenAI o-series). Invalid JSON is ignored with a console warning.",
    });

    new Setting(containerEl).setName("Extra body (JSON)").setHeading();
    const extraWrap = containerEl.createDiv({ cls: "ai-json-editor" });
    const extraTa = extraWrap.createEl("textarea", { cls: "ai-json-textarea" });
    extraTa.rows = 6;
    extraTa.placeholder = '{"chat_template_kwargs":{"enable_thinking":false}}';
    extraTa.value = this.plugin.settings.extraBody;
    const extraStatus = extraWrap.createDiv({ cls: "ai-json-status" });
    const updateExtraStatus = (v: string) => {
      const s = v.trim();
      if (!s) {
        extraStatus.setText("empty — no extras sent");
        extraStatus.removeClass("is-error");
        extraStatus.removeClass("is-ok");
        return;
      }
      try {
        JSON.parse(s);
        extraStatus.setText("valid JSON");
        extraStatus.addClass("is-ok");
        extraStatus.removeClass("is-error");
      } catch (e) {
        extraStatus.setText(`invalid JSON: ${(e as Error).message}`);
        extraStatus.addClass("is-error");
        extraStatus.removeClass("is-ok");
      }
    };
    updateExtraStatus(extraTa.value);
    extraTa.addEventListener("input", async () => {
      this.plugin.settings.extraBody = extraTa.value;
      updateExtraStatus(extraTa.value);
      await this.plugin.saveSettings();
    });

    containerEl.createEl("h2", { text: "Tools" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Toggle which tools the model can call. Read-only tools are safe to leave on. Destructive tools (write, edit, append, delete, move) can be disabled for a read-only assistant.",
    });

    for (const name of ALL_TOOL_NAMES) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(TOOL_DESCRIPTIONS[name])
        .addToggle((tg) =>
          tg.setValue(this.plugin.settings.enabledTools[name]).onChange(async (v) => {
            this.plugin.settings.enabledTools[name] = v;
            await this.plugin.saveSettings();
          }),
        );
    }

    new Setting(containerEl)
      .setName("ripgrep path")
      .setDesc(
        "Optional. Absolute path to rg binary for faster search. Leave empty to use JS fallback.",
      )
      .addText((t) =>
        t
          .setPlaceholder("/opt/homebrew/bin/rg")
          .setValue(this.plugin.settings.ripgrepPath)
          .onChange(async (v) => {
            this.plugin.settings.ripgrepPath = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Require confirmation for destructive ops")
      .setDesc("(Reserved for v2 — currently no confirmation modal is shown.)")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.requireConfirmation).onChange(async (v) => {
          this.plugin.settings.requireConfirmation = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
