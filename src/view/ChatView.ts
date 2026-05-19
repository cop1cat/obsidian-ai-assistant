import { ItemView, Menu, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type AIAssistantPlugin from "../main";
import type { ChatSession } from "../main";
import { Agent } from "../llm/agent";
import type { ChatMessage, UiMessage, UiToolCall } from "../llm/types";
import { MessageRenderer } from "./MessageRenderer";

export const VIEW_TYPE_AI_CHAT = "ai-assistant-chat";

const MAX_ACTIVE_NOTE_CHARS = 12_000;
const MAX_INPUT_HISTORY = 50;

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

  private headerEl!: HTMLElement;
  private sessionLabelEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private contextBarEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;

  private abortController: AbortController | null = null;
  private generating = false;
  private detachSessions: (() => void) | null = null;

  // Per-session input history (in-memory only).
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

    this.headerEl = root.createDiv({ cls: "ai-chat-header" });
    this.renderHeader();

    this.messagesEl = root.createDiv({ cls: "ai-chat-messages" });

    const inputWrap = root.createDiv({ cls: "ai-chat-input-wrap" });
    this.contextBarEl = inputWrap.createDiv({ cls: "ai-chat-context-bar" });
    this.updateContextBar();

    this.inputEl = inputWrap.createEl("textarea", { cls: "ai-chat-input" });
    this.inputEl.placeholder = "Ask anything. Enter to send, Shift+Enter for newline. ↑/↓ for history.";
    this.inputEl.addEventListener("keydown", (e) => this.handleInputKey(e));
    this.inputEl.addEventListener("input", () => {
      // Once the user starts typing again, drop the history-navigation anchor.
      if (this.inputHistoryIdx !== null) {
        this.inputHistoryIdx = null;
      }
    });

    const buttons = inputWrap.createDiv({ cls: "ai-chat-buttons" });
    this.stopBtn = buttons.createEl("button", { text: "Stop" });
    this.stopBtn.disabled = true;
    this.stopBtn.onclick = () => this.stop();
    this.sendBtn = buttons.createEl("button", { text: "Send", cls: "mod-cta" });
    this.sendBtn.onclick = () => this.send();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.updateContextBar()),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateContextBar()),
    );
    this.detachSessions = this.plugin.onSessionsChange(() => {
      this.renderHeader();
      this.renderActiveSessionMessages();
    });

    this.renderActiveSessionMessages();
  }

  async onClose(): Promise<void> {
    this.stop();
    this.detachSessions?.();
    this.detachSessions = null;
    this.messageElements.clear();
  }

  // -- header / session dropdown --

  private renderHeader(): void {
    if (!this.headerEl) return;
    this.headerEl.empty();
    const left = this.headerEl.createDiv({ cls: "ai-chat-header-left" });

    const picker = left.createEl("button", { cls: "ai-chat-session-picker" });
    picker.setAttr("aria-label", "Switch chat session");
    this.sessionLabelEl = picker.createSpan({ cls: "ai-chat-session-label" });
    this.sessionLabelEl.setText(this.session().title);
    picker.createSpan({ cls: "ai-chat-session-caret", text: " ▾" });
    picker.onclick = (e) => this.openSessionMenu(e);

    const right = this.headerEl.createDiv({ cls: "ai-chat-header-right" });
    const newBtn = right.createEl("button", { cls: "ai-chat-icon-btn", text: "+ New" });
    newBtn.setAttr("aria-label", "New chat");
    newBtn.onclick = () => {
      this.stop();
      this.plugin.createSession();
    };
  }

  private openSessionMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const active = this.session().id;
    for (const s of this.plugin.sessions) {
      menu.addItem((mi) => {
        mi.setTitle(s.title || "Untitled")
          .setChecked(s.id === active)
          .onClick(() => {
            this.stop();
            this.plugin.switchSession(s.id);
          });
      });
    }
    menu.addSeparator();
    menu.addItem((mi) =>
      mi.setTitle("Rename current…").setIcon("pencil").onClick(() => this.renameCurrent()),
    );
    menu.addItem((mi) =>
      mi
        .setTitle("Delete current")
        .setIcon("trash")
        .onClick(() => this.deleteCurrent()),
    );
    menu.showAtMouseEvent(evt);
  }

  private renameCurrent(): void {
    const cur = this.session();
    const next = window.prompt("Rename chat", cur.title);
    if (next === null) return;
    this.plugin.renameSession(cur.id, next);
  }

  private deleteCurrent(): void {
    const cur = this.session();
    if (!window.confirm(`Delete chat "${cur.title}"? This cannot be undone.`)) return;
    this.stop();
    this.plugin.deleteSession(cur.id);
  }

  private renderActiveSessionMessages(): void {
    if (!this.messagesEl) return;
    this.messagesEl.empty();
    this.messageElements.clear();
    if (this.sessionLabelEl) {
      this.sessionLabelEl.setText(this.session().title);
    }
    for (const msg of this.uiMessages) {
      if (msg.streaming) msg.streaming = false;
      this.renderMessage(msg);
    }
  }

  // -- input handling --

  private handleInputKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.send();
      return;
    }

    // ↑/↓ recall — only when the textarea is single-line empty, or the caret
    // is at the very start (↑) / very end (↓) of the buffer. This way arrow
    // keys keep their normal cursor-movement behavior inside multi-line drafts.
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
    // Allow if textarea is empty or caret at start with no newline before.
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
  }

  private recallForward(): void {
    if (this.inputHistoryIdx === null) return;
    if (this.inputHistoryIdx >= this.inputHistory.length - 1) {
      this.inputHistoryIdx = null;
      this.inputEl.value = this.inputDraft;
      const len = this.inputDraft.length;
      this.inputEl.setSelectionRange(len, len);
      return;
    }
    this.inputHistoryIdx += 1;
    const v = this.inputHistory[this.inputHistoryIdx];
    this.inputEl.value = v;
    this.inputEl.setSelectionRange(v.length, v.length);
  }

  private pushInputHistory(text: string): void {
    if (!text) return;
    // Avoid consecutive duplicates.
    if (this.inputHistory[this.inputHistory.length - 1] === text) return;
    this.inputHistory.push(text);
    if (this.inputHistory.length > MAX_INPUT_HISTORY) {
      this.inputHistory.splice(0, this.inputHistory.length - MAX_INPUT_HISTORY);
    }
    this.inputHistoryIdx = null;
    this.inputDraft = "";
  }

  // -- view helpers --

  private updateContextBar(): void {
    if (!this.contextBarEl) return;
    if (!this.plugin.settings.includeActiveNoteInContext) {
      this.contextBarEl.setText("");
      return;
    }
    const f = this.app.workspace.getActiveFile();
    this.contextBarEl.setText(f ? `Context: ${f.path}` : "Context: (no active note)");
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
    this.inputEl.disabled = on;
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
      return `# Persistent memory (from ${path})\nThis is what you previously recorded about this vault. Trust it as up-to-date unless you find conflicting evidence in the vault — in which case update the memory note via write_memory or append_memory.\n\n${trimmed}`;
    } catch {
      return null;
    }
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

    const userUi: UiMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
    };
    this.uiMessages.push(userUi);
    this.renderMessage(userUi);
    this.plugin.maybeAutoTitle(this.session());
    if (this.sessionLabelEl) this.sessionLabelEl.setText(this.session().title);
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
    const hint = [memHint, activeHint].filter((x): x is string => !!x).join("\n\n") || null;

    const finalizeAssistantUi = (id: string | null) => {
      if (!id) return;
      const ui = this.getUi(id);
      if (!ui) return;
      ui.streaming = false;
      this.renderMessage(ui);
    };

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
          // Only render if user hasn't switched away.
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
          // Clear the streaming flag so the UI doesn't look hung.
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

    // Belt-and-braces: clear any lingering streaming flag on the last assistant
    // message in this turn (covers signal aborts and edge paths in the agent).
    const lastAssistant = [...sessionAtStart.uiMessages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant?.streaming) {
      lastAssistant.streaming = false;
      if (this.session().id === sessionAtStart.id) finalizeAssistantUi(lastAssistant.id);
      this.plugin.scheduleChatSave();
    }

    this.setGenerating(false);
    this.abortController = null;
  }
}
