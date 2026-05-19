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

  private rootEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private sessionsListEl: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private scrollBottomBtn: HTMLButtonElement | null = null;
  /** True when the messages container is scrolled (≈) to the bottom and we
   *  should keep it pinned as new content streams in. Flipped to false the
   *  moment the user scrolls up. */
  private stickToBottom = true;
  private readonly STICK_THRESHOLD_PX = 32;
  private composerEl: HTMLElement | null = null;
  private contextBarEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private emptyHintEl: HTMLElement | null = null;

  private abortController: AbortController | null = null;
  private generating = false;
  private detachSessions: (() => void) | null = null;
  private mode: "list" | "chat" = "list";

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
    this.rootEl = root;

    this.headerEl = root.createDiv({ cls: "ai-chat-header" });
    this.bodyEl = root.createDiv({ cls: "ai-chat-body" });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateContextBar()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateContextBar()));
    this.detachSessions = this.plugin.onSessionsChange(() => {
      if (this.mode === "list") {
        this.renderSessionsList();
      } else {
        this.renderHeader();
        this.renderActiveSessionMessages();
        this.updateEmptyState();
      }
    });

    this.render();
  }

  private render(): void {
    this.renderHeader();
    this.renderBody();
  }

  private setMode(m: "list" | "chat"): void {
    if (this.mode === m) return;
    this.mode = m;
    this.render();
    if (m === "chat") {
      // Defer focus until the textarea is in the DOM.
      requestAnimationFrame(() => this.inputEl?.focus());
    }
  }

  async onClose(): Promise<void> {
    this.stop();
    this.detachSessions?.();
    this.detachSessions = null;
    this.messageElements.clear();
  }

  // -- Header --

  private renderHeader(): void {
    const h = this.headerEl;
    h.empty();
    h.toggleClass("is-list", this.mode === "list");
    h.toggleClass("is-chat", this.mode === "chat");

    const left = h.createDiv({ cls: "ai-chat-header-left" });
    const right = h.createDiv({ cls: "ai-chat-header-right" });

    if (this.mode === "list") {
      left.createSpan({ cls: "ai-chat-header-title", text: "Chats" });
      left.createSpan({ cls: "ai-chat-header-count", text: `${this.plugin.sessions.length}` });

      const newBtn = right.createEl("button", { cls: "ai-chat-header-btn ai-chat-header-new mod-cta" });
      newBtn.setAttr("aria-label", "New chat");
      newBtn.title = "New chat";
      const newIcon = newBtn.createSpan({ cls: "ai-chat-header-new-icon" });
      setIcon(newIcon, "plus");
      newBtn.createSpan({ cls: "ai-chat-header-new-label", text: "New chat" });
      newBtn.onclick = () => {
        const empty = this.plugin.sessions.find(
          (s) => s.uiMessages.length === 0 && s.history.length === 0,
        );
        if (empty) {
          this.plugin.switchSession(empty.id);
        } else {
          this.stop();
          this.plugin.createSession();
        }
        this.setMode("chat");
      };

      const settingsBtn = right.createEl("button", { cls: "ai-chat-header-btn" });
      settingsBtn.setAttr("aria-label", "Plugin settings");
      settingsBtn.title = "Plugin settings";
      setIcon(settingsBtn, "settings");
      settingsBtn.onclick = () => this.openPluginSettings();
    } else {
      const back = left.createEl("button", { cls: "ai-chat-header-btn ai-chat-header-back" });
      back.setAttr("aria-label", "Back to chats");
      back.title = "Back to chats";
      setIcon(back, "x");
      back.onclick = () => this.setMode("list");

      const s = this.session();
      const title = left.createSpan({ cls: "ai-chat-header-title is-chat-title" });
      title.setText(s.title || "Untitled");
      title.title = s.title || "Untitled";

      const more = right.createEl("button", { cls: "ai-chat-header-btn" });
      more.setAttr("aria-label", "Chat options");
      more.title = "Chat options";
      setIcon(more, "more-horizontal");
      more.onclick = (e) => {
        e.stopPropagation();
        this.openSessionMenu(e, s);
      };
    }
  }

  private openPluginSettings(): void {
    const obsApp = this.app as unknown as {
      setting?: { open: () => void; openTabById: (id: string) => void };
    };
    obsApp.setting?.open?.();
    obsApp.setting?.openTabById?.(this.plugin.manifest.id);
  }

  // -- Body --

  private renderBody(): void {
    const body = this.bodyEl;
    body.empty();
    body.toggleClass("is-list", this.mode === "list");
    body.toggleClass("is-chat", this.mode === "chat");

    this.sessionsListEl = null;
    this.messagesEl = null;
    this.composerEl = null;
    this.contextBarEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.stopBtn = null;
    this.emptyHintEl = null;
    this.scrollBottomBtn = null;
    this.messageElements.clear();
    this.stickToBottom = true;

    if (this.mode === "list") {
      this.sessionsListEl = body.createDiv({ cls: "ai-sessions-list" });
      this.renderSessionsList();
    } else {
      const messagesWrap = body.createDiv({ cls: "ai-chat-messages-wrap" });
      const messagesEl = messagesWrap.createDiv({ cls: "ai-chat-messages" });
      this.messagesEl = messagesEl;
      messagesEl.addEventListener("scroll", () => this.onMessagesScroll());

      const scrollBtn = messagesWrap.createEl("button", { cls: "ai-scroll-bottom-btn" });
      scrollBtn.setAttr("aria-label", "Scroll to latest");
      scrollBtn.title = "Scroll to latest";
      setIcon(scrollBtn, "arrow-down");
      scrollBtn.onclick = () => {
        if (!this.messagesEl) return;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        this.stickToBottom = true;
        this.updateScrollBtn();
      };
      scrollBtn.toggleClass("is-hidden", true);
      this.scrollBottomBtn = scrollBtn;

      this.buildComposer(body);
      this.renderActiveSessionMessages();
      this.updateEmptyState();
      this.updateContextBar();
      // Initial pin to bottom after layout.
      requestAnimationFrame(() => {
        if (!this.messagesEl) return;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        this.updateScrollBtn();
      });
    }
  }

  private onMessagesScroll(): void {
    const el = this.messagesEl;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.stickToBottom = distFromBottom <= this.STICK_THRESHOLD_PX;
    this.updateScrollBtn();
  }

  private updateScrollBtn(): void {
    const btn = this.scrollBottomBtn;
    const el = this.messagesEl;
    if (!btn || !el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const hasOverflow = el.scrollHeight > el.clientHeight + 1;
    btn.toggleClass("is-hidden", !hasOverflow || distFromBottom <= this.STICK_THRESHOLD_PX);
  }

  private buildComposer(parent: HTMLElement): void {
    this.composerEl = parent.createDiv({ cls: "ai-composer" });
    this.contextBarEl = this.composerEl.createDiv({ cls: "ai-composer-context" });

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
    modelChip.onclick = () => this.openPluginSettings();

    const composerRight = composerBar.createDiv({ cls: "ai-composer-right" });

    this.stopBtn = composerRight.createEl("button", { cls: "ai-composer-btn ai-composer-stop" });
    this.stopBtn.setAttr("aria-label", "Stop");
    this.stopBtn.title = "Stop";
    setIcon(this.stopBtn, "square");
    this.stopBtn.disabled = !this.generating;
    this.stopBtn.onclick = () => this.stop();

    this.sendBtn = composerRight.createEl("button", { cls: "ai-composer-btn ai-composer-send mod-cta" });
    this.sendBtn.setAttr("aria-label", "Send");
    this.sendBtn.title = "Send (Enter)";
    setIcon(this.sendBtn, "arrow-up");
    this.sendBtn.disabled = this.generating;
    this.sendBtn.onclick = () => this.send();

    this.composerEl.toggleClass("is-generating", this.generating);
  }

  private renderSessionsList(): void {
    const list = this.sessionsListEl;
    if (!list) return;
    list.empty();

    const activeId = this.session().id;
    const sorted = [...this.plugin.sessions].sort((a, b) => b.updatedAt - a.updatedAt);

    if (sorted.length === 0) {
      list.createDiv({ cls: "ai-sessions-empty", text: "No chats yet — click + to start one." });
      return;
    }

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

      row.onclick = () => {
        if (s.id !== activeId) {
          this.stop();
          this.plugin.switchSession(s.id);
        }
        this.setMode("chat");
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        this.openSessionMenu(e, s);
      };
    }
  }

  private openSessionMenu(evt: MouseEvent, s: ChatSession): void {
    const menu = new Menu();
    if (this.mode === "list") {
      menu.addItem((mi) => mi.setTitle("Open").setIcon("check").onClick(() => {
        this.stop();
        this.plugin.switchSession(s.id);
        this.setMode("chat");
      }));
    }
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
          const wasActive = s.id === this.session().id;
          if (wasActive) this.stop();
          this.plugin.deleteSession(s.id);
          if (wasActive && this.mode === "chat") this.setMode("list");
        }),
    );
    menu.showAtMouseEvent(evt);
  }

  private renderActiveSessionMessages(): void {
    const messagesEl = this.messagesEl;
    if (!messagesEl) return;
    messagesEl.empty();
    this.messageElements.clear();
    this.emptyHintEl = null;
    for (const msg of this.uiMessages) {
      if (msg.streaming) msg.streaming = false;
      this.renderMessage(msg);
    }
  }

  private updateEmptyState(): void {
    const messagesEl = this.messagesEl;
    if (!messagesEl) return;
    if (this.uiMessages.length === 0) {
      let hint = this.emptyHintEl;
      if (!hint || !hint.isConnected) {
        hint = messagesEl.createDiv({ cls: "ai-chat-empty" });
        this.emptyHintEl = hint;
      } else {
        hint.empty();
      }
      hint.createDiv({ cls: "ai-chat-empty-title", text: "Start a new conversation" });
      hint.createDiv({
        cls: "ai-chat-empty-sub",
        text:
          "Ask about your vault. The model can list, read, search, write and move notes via tools. " +
          "It remembers vault facts in your memory note (see settings).",
      });
    } else if (this.emptyHintEl?.isConnected) {
      this.emptyHintEl.remove();
      this.emptyHintEl = null;
    }
  }

  // -- Input handling --

  private autoGrowInput(): void {
    const ta = this.inputEl;
    if (!ta) return;
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
    if (!ta) return false;
    if (ta.value.length === 0) return true;
    return ta.selectionStart === 0 && ta.selectionEnd === 0 && !ta.value.slice(0, ta.selectionStart).includes("\n");
  }

  private canRecallForward(): boolean {
    return this.inputHistoryIdx !== null;
  }

  private recallBack(): void {
    const ta = this.inputEl;
    if (!ta) return;
    if (this.inputHistoryIdx === null) {
      this.inputDraft = ta.value;
      this.inputHistoryIdx = this.inputHistory.length - 1;
    } else {
      this.inputHistoryIdx = Math.max(0, this.inputHistoryIdx - 1);
    }
    const v = this.inputHistory[this.inputHistoryIdx];
    ta.value = v;
    ta.setSelectionRange(v.length, v.length);
    this.autoGrowInput();
  }

  private recallForward(): void {
    const ta = this.inputEl;
    if (!ta) return;
    if (this.inputHistoryIdx === null) return;
    if (this.inputHistoryIdx >= this.inputHistory.length - 1) {
      this.inputHistoryIdx = null;
      ta.value = this.inputDraft;
      const len = this.inputDraft.length;
      ta.setSelectionRange(len, len);
      this.autoGrowInput();
      return;
    }
    this.inputHistoryIdx += 1;
    const v = this.inputHistory[this.inputHistoryIdx];
    ta.value = v;
    ta.setSelectionRange(v.length, v.length);
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
    if (this.sendBtn) this.sendBtn.disabled = on;
    if (this.stopBtn) this.stopBtn.disabled = !on;
    this.composerEl?.toggleClass("is-generating", on);
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
    if (!this.plugin.settings.includeMemoryInContext) return null;
    const trimmed = (this.plugin.settings.memoryText ?? "").trim();
    if (!trimmed) return null;
    const ts = this.plugin.settings.memoryUpdatedAt;
    const stamp = ts ? new Date(ts).toISOString() : "unknown";
    return `# Persistent memory (plugin-internal)\nLast updated: ${stamp}\nThis is what you previously recorded about this vault. Trust it as up-to-date unless you find conflicting evidence in the vault — in which case update via write_memory or append_memory.\n\n${trimmed}`;
  }

  /** Always-on temporal block so the model can reason about recency:
   *  current local time, when memory was last touched, and how long since the
   *  previous user message in this session. */
  private temporalContextHint(): string {
    const now = new Date();
    const lines: string[] = ["# Now", `Local time: ${now.toString()}`, `ISO: ${now.toISOString()}`];

    const memTs = this.plugin.settings.memoryUpdatedAt;
    if (memTs) {
      lines.push(`Memory last updated: ${new Date(memTs).toISOString()}`);
    } else {
      lines.push(`Memory: empty (never written).`);
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
    const messagesEl = this.messagesEl;
    if (!messagesEl) return;
    let el = this.messageElements.get(msg.id);
    const isNew = !el;
    if (!el) {
      el = messagesEl.createDiv();
      this.messageElements.set(msg.id, el);
    }
    this.renderer.render(el, msg);
    // Only pull the view to the bottom if the user is already pinned there.
    // A new user message always pins (we just sent it) — same for any newly
    // appended message; mid-stream deltas only scroll if the user hasn't moved.
    if (this.stickToBottom || isNew) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      this.stickToBottom = true;
    }
    this.updateScrollBtn();
  }

  private getUi(id: string): UiMessage | undefined {
    return this.uiMessages.find((m) => m.id === id);
  }

  private async send(): Promise<void> {
    if (this.generating) return;
    const ta = this.inputEl;
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;
    if (!this.plugin.settings.model) {
      new Notice("AI Assistant: model is not configured. Open settings.");
      return;
    }

    this.pushInputHistory(text);
    ta.value = "";
    this.autoGrowInput();

    const userUi: UiMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
    };
    this.uiMessages.push(userUi);
    this.renderMessage(userUi);
    this.plugin.maybeAutoTitle(this.session());
    this.renderHeader();
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
      () => this.plugin.saveSettings(),
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
    this.renderHeader();
  }
}
