import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type AIAssistantPlugin from "../main";
import { Agent } from "../llm/agent";
import type { ChatMessage, UiMessage, UiToolCall } from "../llm/types";
import { MessageRenderer } from "./MessageRenderer";

export const VIEW_TYPE_AI_CHAT = "ai-assistant-chat";

const MAX_ACTIVE_NOTE_CHARS = 12_000;

export class ChatView extends ItemView {
  private messageElements = new Map<string, HTMLElement>();
  private renderer!: MessageRenderer;

  private get history(): ChatMessage[] {
    return this.plugin.chat.history;
  }
  private set history(v: ChatMessage[]) {
    this.plugin.chat.history = v;
  }
  private get uiMessages(): UiMessage[] {
    return this.plugin.chat.uiMessages;
  }
  private set uiMessages(v: UiMessage[]) {
    this.plugin.chat.uiMessages = v;
  }

  private persist(): void {
    this.plugin.scheduleChatSave();
  }

  private messagesEl!: HTMLElement;
  private contextBarEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private newChatBtn!: HTMLButtonElement;

  private abortController: AbortController | null = null;
  private generating = false;

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

    this.messagesEl = root.createDiv({ cls: "ai-chat-messages" });

    const inputWrap = root.createDiv({ cls: "ai-chat-input-wrap" });
    this.contextBarEl = inputWrap.createDiv({ cls: "ai-chat-context-bar" });
    this.updateContextBar();

    this.inputEl = inputWrap.createEl("textarea", { cls: "ai-chat-input" });
    this.inputEl.placeholder = "Ask anything. Enter to send, Shift+Enter for newline.";
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.send();
      }
    });

    const buttons = inputWrap.createDiv({ cls: "ai-chat-buttons" });
    this.newChatBtn = buttons.createEl("button", { text: "New chat" });
    this.newChatBtn.onclick = () => this.resetChat();
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

    // Restore previously persisted messages.
    for (const msg of this.uiMessages) {
      // Clear streaming flag — anything mid-flight at last shutdown is now stale.
      if (msg.streaming) msg.streaming = false;
      this.renderMessage(msg);
    }
  }

  async onClose(): Promise<void> {
    this.stop();
    this.messageElements.clear();
  }

  private updateContextBar(): void {
    if (!this.contextBarEl) return;
    if (!this.plugin.settings.includeActiveNoteInContext) {
      this.contextBarEl.setText("");
      return;
    }
    const f = this.app.workspace.getActiveFile();
    this.contextBarEl.setText(f ? `Context: ${f.path}` : "Context: (no active note)");
  }

  private resetChat(): void {
    this.stop();
    this.history = [];
    this.uiMessages = [];
    this.messageElements.clear();
    this.messagesEl.empty();
    this.persist();
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

    this.inputEl.value = "";

    const userUi: UiMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
    };
    this.uiMessages.push(userUi);
    this.renderMessage(userUi);
    this.persist();

    this.abortController = new AbortController();
    this.setGenerating(true);

    const agent = new Agent(
      this.app,
      this.plugin.settings,
      () => this.history,
      (h) => {
        this.history = h;
      },
    );

    const hint = await this.activeNoteHint();

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
          this.uiMessages.push(ui);
          this.renderMessage(ui);
        },
        onContentDelta: (id, delta) => {
          const ui = this.getUi(id);
          if (!ui) return;
          ui.content += delta;
          this.renderMessage(ui);
        },
        onToolCallStart: (id, callId, name, args) => {
          const ui = this.getUi(id);
          if (!ui) return;
          const tc: UiToolCall = { id: callId, name, args, status: "running", startedAt: Date.now() };
          ui.toolCalls = [...(ui.toolCalls ?? []), tc];
          this.renderMessage(ui);
        },
        onToolCallResult: (id, callId, ok, result) => {
          const ui = this.getUi(id);
          if (!ui || !ui.toolCalls) return;
          const tc = ui.toolCalls.find((t) => t.id === callId);
          if (!tc) return;
          tc.status = ok ? "done" : "error";
          tc.result = result;
          tc.endedAt = Date.now();
          this.renderMessage(ui);
          this.persist();
        },
        onAssistantEnd: (id) => {
          const ui = this.getUi(id);
          if (!ui) return;
          ui.streaming = false;
          this.renderMessage(ui);
          this.persist();
        },
        onError: (err) => {
          const errUi: UiMessage = {
            id: `e_${Date.now()}`,
            role: "error",
            content: `${err.name || "Error"}: ${err.message}`,
          };
          this.uiMessages.push(errUi);
          this.renderMessage(errUi);
          this.persist();
        },
      },
      this.abortController.signal,
    );

    this.setGenerating(false);
    this.abortController = null;
  }
}
