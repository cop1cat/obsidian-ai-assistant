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

Style:
- Match the user's language. If they write in Russian, reply in Russian.
- Plain, neutral, professional tone. No sycophancy: never say "отличный план", "хороший вопрос", "солидный план", "great idea", "perfect", "love it". Do not praise the user or their notes.
- Do not use emoji or decorative symbols (🔥 ✅ 😊 ✨ 🎉 ⚡ — none). Use plain markdown bullets and headings.
- Do not use exclamation marks unless you are quoting the user.
- No filler openers ("Конечно!", "Sure!", "Of course", "Great question") and no filler closers ("С чего начнём?", "Что-то ещё?", "Дай знать!", "Hope this helps", "Let me know!").
- Do not offer an unprompted menu of next-step options. If the user asked a question, answer it. If they asked you to do X, do X — do not propose alternative things you could do instead.
- Do not announce intent ("Сейчас я сделаю…", "I'll start by…"). Just do it, then report the result. Show what you did, not what you are about to do.
- Default to ≤3 short paragraphs. Go longer only when the task genuinely requires it.
- When the answer is a single fact or short list, give it directly without preamble or restating the question.
- When you propose an action, propose it once in one sentence, then stop. Do not render it as a checkbox/bullet menu.
- If a sentence adds no information, delete it.
- Use [[wikilinks]] when referring to notes by name. Format file paths in backticks.
- Aim for the tone of an engineer's PR comment: what you did, what you found, where you stopped. No commentary on the user's mood, intentions, or how nice their vault is.

Safety — do not perform destructive operations without an explicit user request:
- "Explicit" means the user named the file/folder or unambiguously asked to delete/overwrite/revert. Vague requests ("clean up", "fix this") are NOT explicit consent for destruction.
- Never delete_file unless the user explicitly asked to delete that file by name or path.
- Never overwrite (write_file with overwrite=true), edit_file, or append_to_file in a way that removes or rewrites the user's existing prose, unless they asked for that specific change. Adding new content alongside the user's is fine.
- Never roll back or undo changes you find in a file. Treat the current vault content as the user's source of truth — newer than your memory or expectations.
- Never move/rename or create_folder for files/folders the user did not mention, even if it would "tidy up" the vault.
- If you are unsure whether an action is destructive or whether the user wants it, ASK first. Prefer a clarifying question over a destructive action.
- If a destructive action is the natural next step but wasn't requested, propose it in your reply and wait for confirmation before calling the tool.`;

/** Compact, stable, dependency-free hash for strings (FNV-1a 32-bit).
 *  Used only to compare two prompt strings cheaply — not for security. */
export function hashPrompt(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const CURRENT_DEFAULT_PROMPT_HASH = hashPrompt(DEFAULT_SYSTEM_PROMPT);

/** True if the user's prompt is unchanged since the last baseline AND the
 *  shipped default has moved on — i.e. they are sitting on a stale default. */
export function isStaleDefaultPrompt(settings: PluginSettings): boolean {
  if (!settings.notifyOnPromptUpdate) return false;
  if (!settings.systemPromptBaselineHash) return false;
  if (hashPrompt(settings.systemPrompt) !== settings.systemPromptBaselineHash) return false;
  return settings.systemPromptBaselineHash !== CURRENT_DEFAULT_PROMPT_HASH;
}

/** A saved model preset. Switching profile copies these fields into the
 *  top-level settings (baseUrl/apiKey/model/...) so the rest of the plugin
 *  keeps reading from one place. The id is opaque and stable across renames. */
export interface ModelProfile {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  topP: number;
  extraBody: string;
}

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
  /** FNV-1a hash of the system prompt at the moment the user last accepted /
   *  saved it. Lets us detect "user hasn't touched the prompt since baseline,
   *  but the shipped default has moved on" without ever overwriting custom
   *  prompts. Empty on legacy installs — backfilled on first load. */
  systemPromptBaselineHash: string;
  /** Toggle for the one-shot Notice + settings banner shown when the shipped
   *  default system prompt has changed and the user is on the prior default. */
  notifyOnPromptUpdate: boolean;
  /** Free-form JSON merged into each chat-completion request body.
   *  Empty string = no extras. Stored as text so users can author it
   *  directly; parsed lazily by the client (invalid JSON = ignored + warn). */
  extraBody: string;
  /** Max attempts for a model request before surfacing an error. 1 = no retry.
   *  Retries only fire when nothing was streamed yet — once the model starts
   *  emitting tokens, we never replay (would duplicate output). */
  maxAttempts: number;
  /** Per-attempt timeout in seconds for the *initial* model response (time to
   *  first byte). Streaming after first byte is not bounded by this. */
  requestTimeoutSec: number;
  /** Saved model presets. The active one's fields are mirrored into the
   *  top-level baseUrl/apiKey/model/temperature/topP/extraBody. Always has
   *  at least one entry (the migrated "Default" profile for legacy installs). */
  profiles: ModelProfile[];
  /** Id of the profile whose values are currently live. Falls back to the
   *  first profile when stale. */
  activeProfileId: string;
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
  systemPromptBaselineHash: "",
  notifyOnPromptUpdate: true,
  extraBody: "",
  maxAttempts: 3,
  requestTimeoutSec: 10,
  profiles: [
    {
      id: "default",
      label: "Default",
      baseUrl: "http://localhost:8000/v1",
      apiKey: "EMPTY",
      model: "",
      temperature: 0.7,
      topP: 1.0,
      extraBody: "",
    },
  ],
  activeProfileId: "default",
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
    systemPromptBaselineHash: str("systemPromptBaselineHash", defaults.systemPromptBaselineHash),
    notifyOnPromptUpdate: bool("notifyOnPromptUpdate", defaults.notifyOnPromptUpdate),
    extraBody: str("extraBody", defaults.extraBody),
    maxAttempts: Math.max(1, Math.min(10, Math.round(num("maxAttempts", defaults.maxAttempts)))),
    requestTimeoutSec: Math.max(1, Math.min(300, num("requestTimeoutSec", defaults.requestTimeoutSec))),
    ...normalizeProfiles(r, defaults, {
      baseUrl: str("baseUrl", defaults.baseUrl),
      apiKey: str("apiKey", defaults.apiKey),
      model: str("model", defaults.model),
      temperature: num("temperature", defaults.temperature),
      topP: num("topP", defaults.topP),
      extraBody: str("extraBody", defaults.extraBody),
    }),
  };
}

/** Read `profiles` + `activeProfileId` from raw settings, falling back to a
 *  single profile synthesised from the legacy top-level fields when the user
 *  is upgrading from a version that didn't have profiles. */
function normalizeProfiles(
  r: Record<string, unknown>,
  defaults: PluginSettings,
  legacyTopLevel: Pick<ModelProfile, "baseUrl" | "apiKey" | "model" | "temperature" | "topP" | "extraBody">,
): { profiles: ModelProfile[]; activeProfileId: string } {
  const rawList = Array.isArray(r.profiles) ? (r.profiles as unknown[]) : [];
  const parsed: ModelProfile[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id ? o.id : `p_${Date.now()}_${parsed.length}`;
    parsed.push({
      id,
      label: typeof o.label === "string" && o.label ? o.label : "Untitled",
      baseUrl: typeof o.baseUrl === "string" ? o.baseUrl : legacyTopLevel.baseUrl,
      apiKey: typeof o.apiKey === "string" ? o.apiKey : legacyTopLevel.apiKey,
      model: typeof o.model === "string" ? o.model : legacyTopLevel.model,
      temperature: typeof o.temperature === "number" && Number.isFinite(o.temperature)
        ? o.temperature
        : legacyTopLevel.temperature,
      topP: typeof o.topP === "number" && Number.isFinite(o.topP) ? o.topP : legacyTopLevel.topP,
      extraBody: typeof o.extraBody === "string" ? o.extraBody : legacyTopLevel.extraBody,
    });
  }
  if (parsed.length === 0) {
    parsed.push({
      id: "default",
      label: "Default",
      ...legacyTopLevel,
    });
  }
  const rawActive = typeof r.activeProfileId === "string" ? r.activeProfileId : "";
  const activeProfileId = parsed.find((p) => p.id === rawActive)?.id ?? parsed[0].id;
  void defaults;
  return { profiles: parsed, activeProfileId };
}

/** Full-screen editor for the system prompt — escapes the cramped settings row. */
class SystemPromptModal extends Modal {
  private textarea!: HTMLTextAreaElement;
  private initial: string;

  constructor(
    app: App,
    private plugin: AIAssistantPlugin,
    private onSaved: () => void,
    initialOverride?: string,
  ) {
    super(app);
    this.initial = initialOverride ?? plugin.settings.systemPrompt;
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
      const next = this.textarea.value;
      this.plugin.settings.systemPrompt = next;
      // Re-baseline so we don't nag about default updates the user has just
      // accepted (or just personalised).
      this.plugin.settings.systemPromptBaselineHash = hashPrompt(next);
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

  private renderProfilesSection(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "Model profiles" });
    const desc = containerEl.createEl("p", { cls: "setting-item-description" });
    desc.setText(
      "Saved presets for endpoint + model + sampling. Switching the active profile " +
        "applies its values to the Connection/Generation fields below. The active " +
        "profile is kept in sync with any edits you make there.",
    );

    const list = containerEl.createDiv({ cls: "ai-profiles-list" });
    const redraw = () => {
      list.empty();
      for (const p of this.plugin.settings.profiles) {
        const isActive = p.id === this.plugin.settings.activeProfileId;
        const row = list.createDiv({ cls: "ai-profile-row" });
        if (isActive) row.addClass("is-active");

        const nameInput = row.createEl("input", { type: "text", cls: "ai-profile-name" });
        nameInput.value = p.label;
        nameInput.onchange = async () => {
          const v = nameInput.value.trim();
          if (!v) {
            nameInput.value = p.label;
            return;
          }
          p.label = v;
          await this.plugin.saveSettings();
        };

        const modelSpan = row.createSpan({ cls: "ai-profile-model" });
        modelSpan.setText(p.model || "(no model)");

        const actions = row.createDiv({ cls: "ai-profile-actions" });
        if (!isActive) {
          const useBtn = actions.createEl("button", { text: "Use" });
          useBtn.onclick = async () => {
            await this.plugin.switchProfile(p.id);
            this.display();
          };
        } else {
          actions.createSpan({ cls: "ai-profile-active-badge", text: "active" });
        }
        const delBtn = actions.createEl("button", { text: "Delete" });
        delBtn.disabled = this.plugin.settings.profiles.length <= 1;
        delBtn.onclick = async () => {
          if (this.plugin.settings.profiles.length <= 1) return;
          const idx = this.plugin.settings.profiles.findIndex((x) => x.id === p.id);
          if (idx < 0) return;
          this.plugin.settings.profiles.splice(idx, 1);
          if (isActive) {
            // Switch to the first remaining profile.
            await this.plugin.switchProfile(this.plugin.settings.profiles[0].id);
          } else {
            await this.plugin.saveSettings();
          }
          this.display();
        };
      }
    };
    redraw();

    new Setting(containerEl)
      .setName("New profile")
      .setDesc("Create a copy of the current settings under a new name.")
      .addButton((b) =>
        b.setButtonText("Add profile").onClick(async () => {
          const s = this.plugin.settings;
          const newId = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          s.profiles.push({
            id: newId,
            label: `Profile ${s.profiles.length + 1}`,
            baseUrl: s.baseUrl,
            apiKey: s.apiKey,
            model: s.model,
            temperature: s.temperature,
            topP: s.topP,
            extraBody: s.extraBody,
          });
          await this.plugin.saveSettings();
          this.display();
        }),
      );
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderProfilesSection(containerEl);

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

    new Setting(containerEl)
      .setName("Max request attempts")
      .setDesc(
        "How many times to try a model request before surfacing an error. 1 = no retry. " +
        "Retries only happen before any tokens have streamed.",
      )
      .addText((t) =>
        t.setValue(String(this.plugin.settings.maxAttempts)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n >= 1 && n <= 10) {
            this.plugin.settings.maxAttempts = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Request timeout (seconds)")
      .setDesc("Per-attempt timeout for the model's first response. Streaming is not bounded after that.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.requestTimeoutSec)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n >= 1 && n <= 300) {
            this.plugin.settings.requestTimeoutSec = n;
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

    if (isStaleDefaultPrompt(this.plugin.settings)) {
      const banner = containerEl.createDiv({ cls: "ai-prompt-update-banner" });
      banner.createDiv({
        cls: "ai-prompt-update-text",
        text:
          "The shipped default system prompt has been updated since you last accepted it. " +
          "Your current prompt is unchanged from the old default, so you can safely review " +
          "the new one. Opening the editor will preload the new default — nothing is saved " +
          "until you click Save.",
      });
      const btnRow = banner.createDiv({ cls: "ai-prompt-update-buttons" });
      const reviewBtn = btnRow.createEl("button", { cls: "mod-cta", text: "Review new default" });
      reviewBtn.onclick = () => {
        new SystemPromptModal(this.app, this.plugin, () => this.display(), DEFAULT_SYSTEM_PROMPT).open();
      };
      const dismissBtn = btnRow.createEl("button", { text: "Keep current" });
      dismissBtn.onclick = async () => {
        // Re-baseline to the user's current prompt: they've seen the update
        // and chose to stay. Don't nag again until the next default change.
        this.plugin.settings.systemPromptBaselineHash = hashPrompt(this.plugin.settings.systemPrompt);
        await this.plugin.saveSettings();
        banner.remove();
      };
    }

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

    new Setting(containerEl)
      .setName("Notify when default system prompt changes")
      .setDesc(
        "When a new plugin version ships a different default, show a one-time notice and a banner here. Off = no nagging.",
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.notifyOnPromptUpdate).onChange(async (v) => {
          this.plugin.settings.notifyOnPromptUpdate = v;
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
