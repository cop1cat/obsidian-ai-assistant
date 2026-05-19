import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type AIAssistantPlugin from "../main";
import type { ChatSession } from "../main";
import { Agent } from "../llm/agent";
import type { ChatMessage, UiMessage, UiToolCall } from "../llm/types";
import { MessageRenderer } from "./MessageRenderer";

export const VIEW_TYPE_AI_CHAT = "ai-assistant-chat";

const MAX_ACTIVE_NOTE_CHARS = 12_000;
const MAX_INPUT_HISTORY = 50;

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}

export class ChatView extends ItemView {
  private messageElements = new Map<string, HTMLElement>();
  private renderer!: MessageRenderer;

  private session(): ChatSession {
    return this.plugin.getActiveSession();
  }
  private get history(): ChatMessage[] {
    return this.session().history;
  }
  private set history(v: ChatMessage[]) {
    this.session().history = v;
  }
  private get uiMessages(): UiMessage[] {
    return this.session().uiMessages;
  }
  private set uiMessages(v: UiMessage[]) {
    this.session().uiMessages = v;
  }

  private persist(): void {
    this.plugin.touchActive();
    this.plugin.scheduleChatSave();
  }

  private sessionsHeaderEl!: HTMLElement;
  private sessionsListEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private composerEl!: HTMLElement;
  private contextBarEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private emptyHintEl!: HTMLElement;

  private abortController: AbortController | null = null;
  private generating = false;
  private detachSessions: (() => void) | null = null;
  private sessionsOpen = true;

  // Per-view input history (in-memory only).
  private inputHistory: string[] = [];
  private inputHistoryIdx: number | null = null;
  private inputDraft = "";

  constructor(leaf: WorkspaceLeaf, private plugin: AIAssistantPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_AI_CHAT;
  }

  getDisplayText(): string {
    return "AI Assistant";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    this.renderer = new MessageRenderer(this.plugin, this);

    const root = this.contentEl;
    root.empty();
    root.addClass("ai-chat-view");

    // --- Sessions panel ---
    const sessionsWrap = root.createDiv({ cls: "ai-sessions" });
    this.sessionsHeaderEl = sessionsWrap.createDiv({ cls: "ai-sessions-header" });
    this.sessionsListEl = sessionsWrap.createDiv({ cls: "ai-sessions-list" });
    this.renderSessionsHeader();
    this.renderSessionsList();

    // --- Messages ---
    this.messagesEl = root.createDiv({ cls: "ai-chat-messages" });

    // --- Composer ---
    this.composerEl = root.createDiv({ cls: "ai-composer" });
    this.contextBarEl = this.composerEl.createDiv({ cls: "ai-composer-context" });
    this.updateContextBar();

    this.inputEl = this.composerEl.createEl("textarea", { cls: "ai-composer-input" });
    this.inputEl.placeholder = "Message AI Assistant…  (Enter to send · Shift+Enter newline · ↑/↓ history)";
    this.inputEl.rows = 2;
    this.inputEl.addEventListener("keydown", (e) => this.handleInputKey(e));
    this.inputEl.addEventListener("input", () => {
      if (this.inputHistoryIdx !== null) this.inputHistoryIdx = null;
      this.autoGrowInput();
    });

    const composerBar = this.composerEl.createDiv({ cls: "ai-composer-bar" });
    const composerLeft = composerBar.createDiv({ cls: "ai-composer-left" });
    const modelChip = composerLeft.createSpan({ cls: "ai-composer-model" });
    modelChip.setText(this.plugin.settings.model || "no model set");
    modelChip.title = "Configured model (change in settings).";
    modelChip.onclick = () => {
      // Quick path to settings.
      const obsApp = this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } };
      obsApp.setting?.open?.();
      obsApp.setting?.openTabById?.(this.plugin.manifest.id);
    };

    const composerRight = composerBar.createDiv({ cls: "ai-composer-right" });

    this.stopBtn = composerRight.createEl("button", { cls: "ai-composer-btn ai-composer-stop" });
    this.stopBtn.setAttr("aria-label", "Stop");
    this.stopBtn.title = "Stop";
    setIcon(this.stopBtn, "square");
    this.stopBtn.disabled = true;
    this.stopBtn.onclick = () => this.stop();

    this.sendBtn = composerRight.createEl("button", { cls: "ai-composer-btn ai-composer-send mod-cta" });
    this.sendBtn.setAttr("aria-label", "Send");
    this.sendBtn.title = "Send (Enter)";
    setIcon(this.sendBtn, "arrow-up");
    this.sendBtn.onclick = () => this.send();

    // --- Workspace listeners ---
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateContextBar()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateContextBar()));
    this.detachSessions = this.plugin.onSessionsChange(() => {
      this.renderSessionsHeader();
      this.renderSessionsList();
      this.renderActiveSessionMessages();
      this.updateEmptyState();
    });

    this.renderActiveSessionMessages();
    this.updateEmptyState();
  }

  async onClose(): Promise<void> {
    this.stop();
    this.detachSessions?.();
    this.detachSessions = null;
    this.messageElements.clear();
  }

  // -- Sessions panel --

  private renderSessionsHeader(): void {
    const h = this.sessionsHeaderEl;
    h.empty();

    const left = h.createDiv({ cls: "ai-sessions-header-left" });
    const toggle = left.createEl("button", { cls: "ai-sessions-toggle" });
    toggle.setAttr("aria-label", "Toggle sessions");
    setIcon(toggle, this.sessionsOpen ? "chevron-down" : "chevron-right");
    toggle.onclick = () => {
      this.sessionsOpen = !this.sessionsOpen;
      this.sessionsListEl.toggleClass("is-collapsed", !this.sessionsOpen);
      this.renderSessionsHeader();
    };
    left.createSpan({ cls: "ai-sessions-label", text: "SESSIONS" });
    left.createSpan({ cls: "ai-sessions-count", text: `(${this.plugin.sessions.length})` });

    const right = h.createDiv({ cls: "ai-sessions-header-right" });
    const newBtn = right.createEl("button", { cls: "ai-sessions-icon-btn" });
    newBtn.setAttr("aria-label", "New chat");
    newBtn.title = "New chat";
    setIcon(newBtn, "plus");
    newBtn.onclick = () => {
      const cur = this.session();
      if (cur.uiMessages.length === 0 && cur.history.length === 0) {
        this.inputEl?.focus();
        new Notice("Already in an empty chat.");
        return;
      }
      this.stop();
      this.plugin.createSession();
    };

    const settingsBtn = right.createEl("button", { cls: "ai-sessions-icon-btn" });
    settingsBtn.setAttr("aria-label", "Plugin settings");
    settingsBtn.title = "Plugin settings";
    setIcon(settingsBtn, "settings");
    settingsBtn.onclick = () => {
      const obsApp = this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } };
      obsApp.setting?.open?.();
      obsApp.setting?.openTabById?.(this.plugin.manifest.id);
    };
  }

  private renderSessionsList(): void {
    const list = this.sessionsListEl;
    list.empty();
    list.toggleClass("is-collapsed", !this.sessionsOpen);

    const activeId = this.session().id;
    // Most recent first.
    const sorted = [...this.plugin.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const s of sorted) {
      const row = list.createDiv({ cls: "ai-session-row" });
      if (s.id === activeId) row.addClass("is-active");

      const dot = row.createSpan({ cls: "ai-session-dot" });
      if (s.id === activeId) dot.addClass("is-active");

      const text = row.createDiv({ cls: "ai-session-text" });
      const title = text.createDiv({ cls: "ai-session-title" });
      title.setText(s.title || "Untitled");
      const meta = text.createDiv({ cls: "ai-session-meta" });
      const msgs = s.uiMessages.length;
      meta.setText(`${msgs} msg${msgs === 1 ? "" : "s"} · ${formatRelative(s.updatedAt)}`);

      row.onclick = (e) => {
        if ((e.target as HTMLElement).closest(".ai-session-row-actions")) return;
        if (s.id !== activeId) {
          this.stop();
          this.plugin.switchSession(s.id);
        }
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        this.openSessionMenu(e, s);
      };

      const actions = row.createDiv({ cls: "ai-session-row-actions" });
      const more = actions.createEl("button", { cls: "ai-session-action" });
      more.setAttr("aria-label", "Session options");
      setIcon(more, "more-horizontal");
      more.onclick = (e) => {
        e.stopPropagation();
        this.openSessionMenu(e, s);
      };
    }
  }

  private openSessionMenu(evt: MouseEvent, s: ChatSession): void {
    const menu = new Menu();
    menu.addItem((mi) => mi.setTitle("Switch to").setIcon("check").onClick(() => {
      this.stop();
      this.plugin.switchSession(s.id);
    }));
    menu.addItem((mi) =>
      mi.setTitle("Rename…").setIcon("pencil").onClick(() => {
        const next = window.prompt("Rename chat", s.title);
        if (next === null) return;
        this.plugin.renameSession(s.id, next);
      }),
    );
    menu.addSeparator();
    menu.addItem((mi) =>
      mi
        .setTitle("Delete")
        .setIcon("trash")
        .onClick(() => {
          if (!window.confirm(`Delete chat "${s.title}"? This cannot be undone.`)) return;
          if (s.id === this.session().id) this.stop();
          this.plugin.deleteSession(s.id);
        }),
    );
    menu.showAtMouseEvent(evt);
  }

  private renderActiveSessionMessages(): void {
    if (!this.messagesEl) return;
    this.messagesEl.empty();
    this.messageElements.clear();
    for (const msg of this.uiMessages) {
      if (msg.streaming) msg.streaming = false;
      this.renderMessage(msg);
    }
  }

  private updateEmptyState(): void {
    if (!this.messagesEl) return;
    if (this.uiMessages.length === 0) {
      if (!this.emptyHintEl || !this.emptyHintEl.isConnected) {
        this.emptyHintEl = this.messagesEl.createDiv({ cls: "ai-chat-empty" });
      } else {
        this.emptyHintEl.empty();
      }
      this.emptyHintEl.createDiv({ cls: "ai-chat-empty-title", text: "Start a new conversation" });
      this.emptyHintEl.createDiv({
        cls: "ai-chat-empty-sub",
        text:
          "Ask about your vault. The model can list, read, search, write and move notes via tools. " +
          "It remembers vault facts in your memory note (see settings).",
      });
    } else if (this.emptyHintEl?.isConnected) {
      this.emptyHintEl.remove();
    }
  }

  // -- Input handling --

  private autoGrowInput(): void {
    const ta = this.inputEl;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }

  private handleInputKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.send();
      return;
    }
    if (e.key === "ArrowUp" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (this.canRecallBack()) {
        e.preventDefault();
        this.recallBack();
      }
      return;
    }
    if (e.key === "ArrowDown" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (this.canRecallForward()) {
        e.preventDefault();
        this.recallForward();
      }
      return;
    }
  }

  private canRecallBack(): boolean {
    if (!this.inputHistory.length) return false;
    if (this.inputHistoryIdx !== null) return this.inputHistoryIdx > 0;
    const ta = this.inputEl;
    if (ta.value.length === 0) return true;
    return ta.selectionStart === 0 && ta.selectionEnd === 0 && !ta.value.slice(0, ta.selectionStart).includes("\n");
  }

  private canRecallForward(): boolean {
    return this.inputHistoryIdx !== null;
  }

  private recallBack(): void {
    if (this.inputHistoryIdx === null) {
      this.inputDraft = this.inputEl.value;
      this.inputHistoryIdx = this.inputHistory.length - 1;
    } else {
      this.inputHistoryIdx = Math.max(0, this.inputHistoryIdx - 1);
    }
    const v = this.inputHistory[this.inputHistoryIdx];
    this.inputEl.value = v;
    this.inputEl.setSelectionRange(v.length, v.length);
    this.autoGrowInput();
  }

  private recallForward(): void {
    if (this.inputHistoryIdx === null) return;
    if (this.inputHistoryIdx >= this.inputHistory.length - 1) {
      this.inputHistoryIdx = null;
      this.inputEl.value = this.inputDraft;
      const len = this.inputDraft.length;
      this.inputEl.setSelectionRange(len, len);
      this.autoGrowInput();
      return;
    }
    this.inputHistoryIdx += 1;
    const v = this.inputHistory[this.inputHistoryIdx];
    this.inputEl.value = v;
    this.inputEl.setSelectionRange(v.length, v.length);
    this.autoGrowInput();
  }

  private pushInputHistory(text: string): void {
    if (!text) return;
    if (this.inputHistory[this.inputHistory.length - 1] === text) return;
    this.inputHistory.push(text);
    if (this.inputHistory.length > MAX_INPUT_HISTORY) {
      this.inputHistory.splice(0, this.inputHistory.length - MAX_INPUT_HISTORY);
    }
    this.inputHistoryIdx = null;
    this.inputDraft = "";
  }

  // -- View helpers --

  private updateContextBar(): void {
    if (!this.contextBarEl) return;
    if (!this.plugin.settings.includeActiveNoteInContext) {
      this.contextBarEl.setText("");
      this.contextBarEl.toggleClass("is-hidden", true);
      return;
    }
    const f = this.app.workspace.getActiveFile();
    this.contextBarEl.empty();
    this.contextBarEl.toggleClass("is-hidden", false);
    if (f) {
      const icon = this.contextBarEl.createSpan({ cls: "ai-composer-context-icon" });
      setIcon(icon, "file-text");
      this.contextBarEl.createSpan({ cls: "ai-composer-context-path", text: f.path });
    } else {
      this.contextBarEl.setText("no active note");
    }
  }

  private stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.setGenerating(false);
  }

  private setGenerating(on: boolean): void {
    this.generating = on;
    this.sendBtn.disabled = on;
    this.stopBtn.disabled = !on;
    this.composerEl.toggleClass("is-generating", on);
  }

  private async activeNoteHint(): Promise<string | null> {
    if (!this.plugin.settings.includeActiveNoteInContext) return null;
    const f = this.app.workspace.getActiveFile();
    if (!f || !(f instanceof TFile)) return null;
    try {
      const content = await this.app.vault.cachedRead(f);
      const trimmed =
        content.length > MAX_ACTIVE_NOTE_CHARS
          ? content.slice(0, MAX_ACTIVE_NOTE_CHARS) + "\n…[truncated]"
          : content;
      return `# Active note context\nPath: ${f.path}\n\n\`\`\`\n${trimmed}\n\`\`\``;
    } catch {
      return `# Active note context\nPath: ${f.path} (could not read)`;
    }
  }

  private async memoryHint(): Promise<string | null> {
    const path = this.plugin.settings.memoryNotePath?.trim();
    if (!path) return null;
    if (!this.plugin.settings.includeMemoryInContext) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    try {
      const content = await this.app.vault.cachedRead(file);
      const trimmed = content.trim();
      if (!trimmed) return null;
      const mtime = file.stat?.mtime ? new Date(file.stat.mtime).toISOString() : "unknown";
      return `# Persistent memory (from ${path})\nLast modified: ${mtime}\nThis is what you previously recorded about this vault. Trust it as up-to-date unless you find conflicting evidence in the vault — in which case update the memory note via write_memory or append_memory.\n\n${trimmed}`;
    } catch {
      return null;
    }
  }

  /** Always-on temporal block so the model can reason about recency:
   *  current local time, when memory was last touched, and how long since the
   *  previous user message in this session. */
  private temporalContextHint(): string {
    const now = new Date();
    const lines: string[] = ["# Now", `Local time: ${now.toString()}`, `ISO: ${now.toISOString()}`];

    const memPath = this.plugin.settings.memoryNotePath?.trim();
    if (memPath) {
      const file = this.app.vault.getAbstractFileByPath(memPath);
      if (file instanceof TFile && file.stat?.mtime) {
        lines.push(`Memory note last modified: ${new Date(file.stat.mtime).toISOString()} (${memPath})`);
      } else {
        lines.push(`Memory note (${memPath}): not created yet.`);
      }
    }

    // Estimate "time since previous user turn" from session uiMessages — the prior
    // user message's id encodes its timestamp (u_<ms>). Best-effort, never throws.
    const session = this.session();
    const priorUser = [...session.uiMessages]
      .reverse()
      .find((m, idx) => m.role === "user" && idx > 0);
    if (priorUser?.id?.startsWith("u_")) {
      const ts = parseInt(priorUser.id.slice(2), 10);
      if (Number.isFinite(ts)) {
        const dt = now.getTime() - ts;
        if (dt > 0) {
          lines.push(`Previous user message: ${Math.round(dt / 1000)}s ago.`);
        }
      }
    }
    return lines.join("\n");
  }

  private renderMessage(msg: UiMessage): void {
    let el = this.messageElements.get(msg.id);
    if (!el) {
      el = this.messagesEl.createDiv();
      this.messageElements.set(msg.id, el);
    }
    this.renderer.render(el, msg);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private getUi(id: string): UiMessage | undefined {
    return this.uiMessages.find((m) => m.id === id);
  }

  private async send(): Promise<void> {
    if (this.generating) return;
    const text = this.inputEl.value.trim();
    if (!text) return;
    if (!this.plugin.settings.model) {
      new Notice("AI Assistant: model is not configured. Open settings.");
      return;
    }

    this.pushInputHistory(text);
    this.inputEl.value = "";
    this.autoGrowInput();

    const userUi: UiMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
    };
    this.uiMessages.push(userUi);
    this.renderMessage(userUi);
    this.plugin.maybeAutoTitle(this.session());
    this.renderSessionsList();
    this.updateEmptyState();
    this.persist();

    this.abortController = new AbortController();
    this.setGenerating(true);

    const sessionAtStart = this.session();
    const agent = new Agent(
      this.app,
      this.plugin.settings,
      () => sessionAtStart.history,
      (h) => {
        sessionAtStart.history = h;
      },
    );

    const [activeHint, memHint] = await Promise.all([this.activeNoteHint(), this.memoryHint()]);
    const temporal = this.temporalContextHint();
    const hint = [temporal, memHint, activeHint].filter((x): x is string => !!x).join("\n\n");

    await agent.runTurn(
      text,
      hint,
      {
        onAssistantStart: (id) => {
          const ui: UiMessage = {
            id,
            role: "assistant",
            content: "",
            toolCalls: [],
            streaming: true,
          };
          sessionAtStart.uiMessages.push(ui);
          if (this.session().id === sessionAtStart.id) this.renderMessage(ui);
        },
        onContentDelta: (id, delta) => {
          const ui = sessionAtStart.uiMessages.find((m) => m.id === id);
          if (!ui) return;
          ui.content += delta;
          if (this.session().id === sessionAtStart.id) this.renderMessage(ui);
        },
        onToolCallStart: (id, callId, name, args) => {
          const ui = sessionAtStart.uiMessages.find((m) => m.id === id);
          if (!ui) return;
          const tc: UiToolCall = { id: callId, name, args, status: "running", startedAt: Date.now() };
          ui.toolCalls = [...(ui.toolCalls ?? []), tc];
          if (this.session().id === sessionAtStart.id) this.renderMessage(ui);
        },
        onToolCallResult: (id, callId, ok, result) => {
          const ui = sessionAtStart.uiMessages.find((m) => m.id === id);
          if (!ui || !ui.toolCalls) return;
          const tc = ui.toolCalls.find((t) => t.id === callId);
          if (!tc) return;
          tc.status = ok ? "done" : "error";
          tc.result = result;
          tc.endedAt = Date.now();
          if (this.session().id === sessionAtStart.id) this.renderMessage(ui);
          this.plugin.scheduleChatSave();
        },
        onAssistantEnd: (id) => {
          const ui = sessionAtStart.uiMessages.find((m) => m.id === id);
          if (!ui) return;
          ui.streaming = false;
          if (this.session().id === sessionAtStart.id) this.renderMessage(ui);
          this.plugin.scheduleChatSave();
        },
        onError: (err, currentAssistantId) => {
          if (currentAssistantId) {
            const ui = sessionAtStart.uiMessages.find((m) => m.id === currentAssistantId);
            if (ui) {
              ui.streaming = false;
              if (this.session().id === sessionAtStart.id) this.renderMessage(ui);
            }
          }
          const errUi: UiMessage = {
            id: `e_${Date.now()}`,
            role: "error",
            content: `${err.name || "Error"}: ${err.message}`,
          };
          sessionAtStart.uiMessages.push(errUi);
          if (this.session().id === sessionAtStart.id) this.renderMessage(errUi);
          this.plugin.scheduleChatSave();
        },
      },
      this.abortController.signal,
    );

    const lastAssistant = [...sessionAtStart.uiMessages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant?.streaming) {
      lastAssistant.streaming = false;
      if (this.session().id === sessionAtStart.id) {
        const ui = this.getUi(lastAssistant.id);
        if (ui) this.renderMessage(ui);
      }
      this.plugin.scheduleChatSave();
    }

    this.setGenerating(false);
    this.abortController = null;
    this.renderSessionsList();
  }
}
