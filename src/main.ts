import { Plugin, WorkspaceLeaf } from "obsidian";
import { ChatView, VIEW_TYPE_AI_CHAT } from "./view/ChatView";
import {
  AIAssistantSettingTab,
  DEFAULT_SETTINGS,
  PluginSettings,
  validateSettings,
} from "./settings";
import type { ChatMessage, UiMessage } from "./llm/types";

export interface PersistedChat {
  history: ChatMessage[];
  uiMessages: UiMessage[];
}

const EMPTY_CHAT: PersistedChat = { history: [], uiMessages: [] };

interface PersistedData {
  settings?: unknown;
  chat?: unknown;
}

function validateChat(raw: unknown): PersistedChat {
  if (!raw || typeof raw !== "object") return { ...EMPTY_CHAT };
  const r = raw as { history?: unknown; uiMessages?: unknown };
  return {
    history: Array.isArray(r.history) ? (r.history as ChatMessage[]) : [],
    uiMessages: Array.isArray(r.uiMessages) ? (r.uiMessages as UiMessage[]) : [],
  };
}

export default class AIAssistantPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  chat: PersistedChat = { ...EMPTY_CHAT };

  private saveQueued = false;

  async onload(): Promise<void> {
    await this.loadAll();

    this.registerView(
      VIEW_TYPE_AI_CHAT,
      (leaf: WorkspaceLeaf) => new ChatView(leaf, this),
    );

    this.addRibbonIcon("bot", "Open AI Chat", () => this.activateView());

    this.addCommand({
      id: "open-ai-chat",
      name: "Open AI Chat",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new AIAssistantSettingTab(this.app, this));
  }

  onunload(): void {
    // Obsidian handles view teardown via registerView.
  }

  private async loadAll(): Promise<void> {
    const raw = ((await this.loadData()) ?? {}) as PersistedData;
    // Backwards compat: older versions wrote settings at the top level.
    const settingsRaw = raw.settings ?? raw;
    this.settings = validateSettings(settingsRaw);
    this.chat = validateChat(raw.chat);
  }

  private async persist(): Promise<void> {
    await this.saveData({ settings: this.settings, chat: this.chat });
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  /**
   * Coalesced chat save — multiple calls within the same tick produce one write.
   * Use this from streaming/event handlers.
   */
  scheduleChatSave(): void {
    if (this.saveQueued) return;
    this.saveQueued = true;
    queueMicrotask(async () => {
      this.saveQueued = false;
      try {
        await this.persist();
      } catch (e) {
        console.error("AI Assistant: failed to save chat", e);
      }
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_AI_CHAT)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_AI_CHAT, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}
