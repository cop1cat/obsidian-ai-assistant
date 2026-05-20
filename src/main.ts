import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { ChatView, VIEW_TYPE_AI_CHAT } from "./view/ChatView";
import {
  AIAssistantSettingTab,
  DEFAULT_SETTINGS,
  PluginSettings,
  hashPrompt,
  isStaleDefaultPrompt,
  validateSettings,
} from "./settings";
import type { ChatMessage, UiMessage } from "./llm/types";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  history: ChatMessage[];
  uiMessages: UiMessage[];
}

interface PersistedData {
  settings?: unknown;
  // current shape
  sessions?: unknown;
  activeSessionId?: unknown;
  // legacy: single chat persisted at top level
  chat?: unknown;
}

function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeSession(title = "New chat"): ChatSession {
  const now = Date.now();
  return {
    id: newSessionId(),
    title,
    createdAt: now,
    updatedAt: now,
    history: [],
    uiMessages: [],
  };
}

function validateSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ChatSession>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    title: typeof r.title === "string" ? r.title : "Untitled",
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
    history: Array.isArray(r.history) ? (r.history as ChatMessage[]) : [],
    uiMessages: Array.isArray(r.uiMessages) ? (r.uiMessages as UiMessage[]) : [],
  };
}

export type SessionsChangeListener = () => void;

export default class AIAssistantPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  sessions: ChatSession[] = [];
  activeSessionId: string | null = null;

  private saveQueued = false;
  private sessionListeners = new Set<SessionsChangeListener>();

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

    this.addCommand({
      id: "new-chat-session",
      name: "New chat session",
      callback: () => {
        this.createSession();
      },
    });

    this.addSettingTab(new AIAssistantSettingTab(this.app, this));

    // First-run / legacy backfill: anchor the baseline to the current prompt
    // so we never warn users about a default they're seeing for the first time.
    if (!this.settings.systemPromptBaselineHash) {
      this.settings.systemPromptBaselineHash = hashPrompt(this.settings.systemPrompt);
      await this.saveSettings();
    }

    if (isStaleDefaultPrompt(this.settings)) {
      new Notice(
        "AI Assistant: the default system prompt has changed. Open Settings → AI Assistant to review.",
        10_000,
      );
    }
  }

  onunload(): void {
    // Obsidian handles view teardown via registerView.
  }

  private async loadAll(): Promise<void> {
    const raw = ((await this.loadData()) ?? {}) as PersistedData;
    // Backwards compat: older versions wrote settings at the top level.
    const settingsRaw = raw.settings ?? raw;
    this.settings = validateSettings(settingsRaw);

    const sessionsRaw = Array.isArray(raw.sessions) ? raw.sessions : [];
    this.sessions = sessionsRaw
      .map(validateSession)
      .filter((s): s is ChatSession => s !== null);

    // Legacy migration: pre-multisession blob.
    if (this.sessions.length === 0 && raw.chat && typeof raw.chat === "object") {
      const legacy = raw.chat as { history?: unknown; uiMessages?: unknown };
      const migrated = makeSession("Chat 1");
      migrated.history = Array.isArray(legacy.history) ? (legacy.history as ChatMessage[]) : [];
      migrated.uiMessages = Array.isArray(legacy.uiMessages)
        ? (legacy.uiMessages as UiMessage[])
        : [];
      if (migrated.history.length || migrated.uiMessages.length) {
        this.sessions.push(migrated);
      }
    }

    if (this.sessions.length === 0) {
      this.sessions.push(makeSession("New chat"));
    }

    const wantedId = typeof raw.activeSessionId === "string" ? raw.activeSessionId : null;
    this.activeSessionId =
      (wantedId && this.sessions.find((s) => s.id === wantedId)?.id) || this.sessions[0].id;
  }

  private async persist(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      sessions: this.sessions,
      activeSessionId: this.activeSessionId,
    });
  }

  async saveSettings(): Promise<void> {
    // Keep the active profile in sync with the live fields so a future
    // profile switch and back doesn't lose recent edits.
    this.syncActiveProfile();
    await this.persist();
  }

  /** Make `profileId` active by mirroring its fields into the top-level
   *  settings (which is what the LLMClient reads). No-op if the id is unknown
   *  or already active. */
  async switchProfile(profileId: string): Promise<void> {
    const p = this.settings.profiles.find((x) => x.id === profileId);
    if (!p) return;
    if (this.settings.activeProfileId === profileId) return;
    this.settings.activeProfileId = profileId;
    this.settings.baseUrl = p.baseUrl;
    this.settings.apiKey = p.apiKey;
    this.settings.model = p.model;
    this.settings.temperature = p.temperature;
    this.settings.topP = p.topP;
    this.settings.extraBody = p.extraBody;
    await this.saveSettings();
    this.emitSessionsChange(); // ChatView listens for this to redraw the header
  }

  /** Persist the live top-level fields back into the active profile. Called
   *  whenever the user edits baseUrl/model/etc. from the settings tab so the
   *  profile and the live values don't drift apart. */
  syncActiveProfile(): void {
    const idx = this.settings.profiles.findIndex((p) => p.id === this.settings.activeProfileId);
    if (idx < 0) return;
    this.settings.profiles[idx] = {
      ...this.settings.profiles[idx],
      baseUrl: this.settings.baseUrl,
      apiKey: this.settings.apiKey,
      model: this.settings.model,
      temperature: this.settings.temperature,
      topP: this.settings.topP,
      extraBody: this.settings.extraBody,
    };
  }

  /**
   * Coalesced save — multiple calls within the same tick produce one write.
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

  // -- sessions API --

  onSessionsChange(fn: SessionsChangeListener): () => void {
    this.sessionListeners.add(fn);
    return () => this.sessionListeners.delete(fn);
  }

  private emitSessionsChange(): void {
    for (const fn of this.sessionListeners) {
      try {
        fn();
      } catch (e) {
        console.error("AI Assistant: session listener failed", e);
      }
    }
  }

  getActiveSession(): ChatSession {
    const s = this.sessions.find((x) => x.id === this.activeSessionId);
    if (s) return s;
    // Defensive: re-anchor to the first session if active id drifted.
    this.activeSessionId = this.sessions[0]?.id ?? null;
    if (!this.sessions[0]) {
      const fresh = makeSession();
      this.sessions.push(fresh);
      this.activeSessionId = fresh.id;
    }
    return this.sessions[0];
  }

  touchActive(): void {
    const s = this.getActiveSession();
    s.updatedAt = Date.now();
  }

  createSession(): ChatSession {
    const s = makeSession("New chat");
    this.sessions.unshift(s);
    this.activeSessionId = s.id;
    this.scheduleChatSave();
    this.emitSessionsChange();
    return s;
  }

  switchSession(id: string): void {
    if (!this.sessions.find((s) => s.id === id)) return;
    if (this.activeSessionId === id) return;
    this.activeSessionId = id;
    this.scheduleChatSave();
    this.emitSessionsChange();
  }

  renameSession(id: string, title: string): void {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) return;
    s.title = title.trim() || "Untitled";
    s.updatedAt = Date.now();
    this.scheduleChatSave();
    this.emitSessionsChange();
  }

  deleteSession(id: string): void {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.sessions.splice(idx, 1);
    if (this.sessions.length === 0) {
      this.sessions.push(makeSession("New chat"));
    }
    if (this.activeSessionId === id) {
      this.activeSessionId = this.sessions[0].id;
    }
    this.scheduleChatSave();
    this.emitSessionsChange();
  }

  /** Auto-title from first user message if title is still the default. */
  maybeAutoTitle(session: ChatSession): void {
    if (session.title !== "New chat") return;
    const firstUser = session.uiMessages.find((m) => m.role === "user");
    if (!firstUser) return;
    const t = firstUser.content.replace(/\s+/g, " ").trim();
    if (!t) return;
    session.title = t.length > 40 ? t.slice(0, 40).trimEnd() + "…" : t;
    this.emitSessionsChange();
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
