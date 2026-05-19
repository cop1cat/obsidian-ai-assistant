import { App, PluginSettingTab, Setting } from "obsidian";
import type AIAssistantPlugin from "./main";
import { ALL_TOOL_NAMES, ToolName } from "./tools";

export const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant integrated into an Obsidian vault.

Capabilities:
- You can list, read, create, edit, append, delete, and search markdown notes via tool calls.
- You can inspect backlinks, outlinks, and tags.

Rules:
- All file paths are RELATIVE to the vault root. Never use absolute paths or "..".
- Never invent paths. Use list_files or search to discover the correct path before reading.
- Before edit_file or write_file with overwrite=true, ALWAYS read_file first to see current content.
- For edit_file, old_string must match exactly once (including whitespace).
- When creating new notes, infer the vault's naming convention from existing files (folders, casing, date formats).
- Use [[wikilinks]] when referring to notes in your responses.
- Be concise. Show what you did, not what you are about to do.`;

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
  };
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
        t
          .setValue(String(this.plugin.settings.temperature))
          .onChange(async (v) => {
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
        t
          .setValue(String(this.plugin.settings.topP))
          .onChange(async (v) => {
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
        t
          .setValue(String(this.plugin.settings.maxContextTokens))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.maxContextTokens = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    containerEl.createEl("h2", { text: "System prompt" });

    let promptTextarea: HTMLTextAreaElement | null = null;
    new Setting(containerEl)
      .setName("Prompt")
      .setDesc(
        "Sent as the system message on every request. Edit freely — the default includes vault-safety rules (paths relative, read before edit, use list_files/search to discover paths).",
      )
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.systemPrompt).onChange(async (v) => {
          this.plugin.settings.systemPrompt = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 14;
        t.inputEl.style.width = "100%";
        t.inputEl.style.fontFamily = "var(--font-monospace)";
        promptTextarea = t.inputEl;
      })
      .addExtraButton((b) =>
        b
          .setIcon("rotate-ccw")
          .setTooltip("Reset to default prompt")
          .onClick(async () => {
            this.plugin.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
            await this.plugin.saveSettings();
            if (promptTextarea) promptTextarea.value = DEFAULT_SYSTEM_PROMPT;
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

    containerEl.createEl("h2", { text: "Tools" });

    for (const name of ALL_TOOL_NAMES) {
      new Setting(containerEl).setName(name).addToggle((tg) =>
        tg.setValue(this.plugin.settings.enabledTools[name]).onChange(async (v) => {
          this.plugin.settings.enabledTools[name] = v;
          await this.plugin.saveSettings();
        }),
      );
    }

    new Setting(containerEl)
      .setName("ripgrep path")
      .setDesc("Optional. Absolute path to rg binary for faster search. Leave empty to use JS fallback.")
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
