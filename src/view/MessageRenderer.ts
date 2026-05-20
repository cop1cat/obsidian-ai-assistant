import { Component, MarkdownRenderer } from "obsidian";
import type AIAssistantPlugin from "../main";
import type { UiMessage, UiToolCall } from "../llm/types";

export interface MessageRendererHost {
  onRegenerate(messageId: string): void;
  onEdit(messageId: string, newText: string): void;
  isGenerating(): boolean;
}

interface PrismLike {
  languages: Record<string, unknown>;
  highlightElement(el: HTMLElement): void;
}

function shortArgs(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      let s: string;
      if (typeof v === "string") s = JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v);
      else s = JSON.stringify(v);
      parts.push(`${k}: ${s}`);
      if (parts.join(", ").length > 80) break;
    }
    return parts.join(", ");
  } catch {
    return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
  }
}

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export class MessageRenderer {
  constructor(
    private plugin: AIAssistantPlugin,
    private host: Component,
    private hostApi?: MessageRendererHost,
  ) {}

  render(container: HTMLElement, msg: UiMessage): void {
    container.empty();
    container.addClass("ai-chat-msg", msg.role);

    const header = container.createDiv({ cls: "ai-chat-msg-header" });
    const role = header.createDiv({ cls: "ai-chat-role" });
    role.setText(msg.role === "user" ? "You" : msg.role === "error" ? "Error" : "Assistant");

    // Copy button — only meaningful once there's some text to copy and we're
    // not mid-stream. Tool-call previews are not included in the copy payload
    // since they're rendered as separate blocks.
    if (!msg.streaming && msg.content) {
      const copy = header.createEl("button", { cls: "ai-chat-copy-btn", text: "Copy" });
      copy.setAttr("aria-label", "Copy message");
      copy.onclick = async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(msg.content);
          copy.setText("Copied");
          window.setTimeout(() => copy.setText("Copy"), 1200);
        } catch {
          copy.setText("Failed");
          window.setTimeout(() => copy.setText("Copy"), 1200);
        }
      };
    }

    // Regenerate — only meaningful for assistant/error replies once the turn
    // has settled (no point offering it mid-stream or on user bubbles).
    if (
      !msg.streaming &&
      (msg.role === "assistant" || msg.role === "error") &&
      this.hostApi
    ) {
      const api = this.hostApi;
      const regen = header.createEl("button", { cls: "ai-chat-regen-btn", text: "Regenerate" });
      regen.setAttr("aria-label", "Regenerate response");
      regen.title = "Regenerate response";
      regen.onclick = (e) => {
        e.stopPropagation();
        if (api.isGenerating()) return;
        api.onRegenerate(msg.id);
      };
    }

    // Edit — only for user messages.
    if (msg.role === "user" && this.hostApi) {
      const api = this.hostApi;
      const edit = header.createEl("button", { cls: "ai-chat-regen-btn", text: "Edit" });
      edit.setAttr("aria-label", "Edit message");
      edit.title = "Edit & resend";
      edit.onclick = (e) => {
        e.stopPropagation();
        if (api.isGenerating()) return;
        this.openEditor(container, msg, api);
      };
    }

    if (msg.toolCalls && msg.toolCalls.length) {
      const toolsWrap = container.createDiv();
      for (const tc of msg.toolCalls) {
        this.renderToolCall(toolsWrap, tc);
      }
    }

    const contentEl = container.createDiv({ cls: "ai-chat-content" });
    if (msg.streaming && !msg.content) {
      // No text yet — show a typing indicator instead of an invisible block,
      // unless a tool is currently running (the tool row already animates).
      const toolRunning = msg.toolCalls?.some((t) => t.status === "running");
      if (!toolRunning) {
        const dots = contentEl.createDiv({ cls: "ai-chat-typing" });
        dots.createSpan({ cls: "ai-chat-typing-dot" });
        dots.createSpan({ cls: "ai-chat-typing-dot" });
        dots.createSpan({ cls: "ai-chat-typing-dot" });
      }
    } else {
      this.renderMarkdown(contentEl, msg.content || "");
      if (msg.streaming) contentEl.addClass("ai-chat-streaming-cursor");
    }
  }

  private openEditor(container: HTMLElement, msg: UiMessage, api: MessageRendererHost): void {
    // Swap the rendered bubble for an inline textarea; on Save we hand the new
    // text back to the host (which truncates history and re-runs the agent).
    // On Cancel we re-render the original bubble.
    container.empty();
    container.addClass("ai-chat-msg", msg.role, "is-editing");
    const wrap = container.createDiv({ cls: "ai-chat-edit-wrap" });
    const ta = wrap.createEl("textarea", { cls: "ai-chat-edit-textarea" });
    ta.value = msg.content;
    ta.rows = Math.min(20, Math.max(3, msg.content.split("\n").length + 1));
    const btnRow = wrap.createDiv({ cls: "ai-chat-edit-buttons" });
    const cancel = btnRow.createEl("button", { cls: "ai-chat-edit-btn", text: "Cancel" });
    const save = btnRow.createEl("button", { cls: "ai-chat-edit-btn mod-cta", text: "Save & resend" });

    const restore = () => {
      container.removeClass("is-editing");
      this.render(container, msg);
    };
    cancel.onclick = (e) => {
      e.stopPropagation();
      restore();
    };
    save.onclick = (e) => {
      e.stopPropagation();
      const next = ta.value.trim();
      if (!next) return;
      if (next === msg.content) {
        restore();
        return;
      }
      api.onEdit(msg.id, next);
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        restore();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        save.click();
      }
    });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  private renderToolCall(parent: HTMLElement, tc: UiToolCall): void {
    const wrap = parent.createDiv({ cls: `ai-tool ai-tool-${tc.status}` });

    // Header: ⏺ tool_name(short_args)
    const header = wrap.createDiv({ cls: "ai-tool-header" });
    const dot = header.createSpan({ cls: "ai-tool-dot" });
    dot.setText(tc.status === "running" ? "◌" : tc.status === "done" ? "⏺" : "✕");
    const title = header.createSpan({ cls: "ai-tool-title" });
    title.createSpan({ cls: "ai-tool-name", text: tc.name });
    title.createSpan({ cls: "ai-tool-args", text: `(${shortArgs(tc.args)})` });
    if (tc.endedAt && tc.startedAt) {
      const ms = tc.endedAt - tc.startedAt;
      const dur = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
      header.createSpan({ cls: "ai-tool-duration", text: dur });
    }

    // Body: tree-branch with result preview + expand toggle.
    const body = wrap.createDiv({ cls: "ai-tool-body" });
    const branch = body.createSpan({ cls: "ai-tool-branch" });
    branch.setText("⎿");

    const preview = body.createDiv({ cls: "ai-tool-preview" });
    if (tc.status === "running") {
      preview.addClass("ai-tool-preview-running");
      preview.setText("Running…");
      return;
    }
    if (tc.result === undefined) {
      preview.setText("(no result)");
      return;
    }

    const lines = tc.result.split("\n");
    const FIRST_LINES = 3;
    const previewText = lines.slice(0, FIRST_LINES).join("\n");
    const hasMore = lines.length > FIRST_LINES || tc.result.length > 240;

    const previewEl = preview.createEl("pre", { cls: "ai-tool-preview-pre", text: previewText });
    if (hasMore) {
      const more = preview.createDiv({ cls: "ai-tool-more" });
      const remaining = lines.length - FIRST_LINES;
      const moreLabel = `… ${remaining > 0 ? `+${remaining} lines` : "show full"}`;
      const toggle = more.createEl("a", { cls: "ai-tool-toggle", text: moreLabel });
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        const expanded = wrap.hasClass("ai-tool-expanded");
        if (expanded) {
          wrap.removeClass("ai-tool-expanded");
          previewEl.setText(previewText);
          toggle.setText(moreLabel);
        } else {
          wrap.addClass("ai-tool-expanded");
          previewEl.setText(tc.result ?? "");
          toggle.setText("collapse");
        }
      });
      // Args toggle (hidden by default — clickable via title).
      const argsLink = more.createEl("a", { cls: "ai-tool-args-toggle", text: " · args" });
      let argsShown = false;
      let argsEl: HTMLElement | null = null;
      argsLink.addEventListener("click", (e) => {
        e.preventDefault();
        argsShown = !argsShown;
        if (argsShown) {
          if (!argsEl) {
            argsEl = preview.createEl("pre", { cls: "ai-tool-args-pre", text: prettyArgs(tc.args) });
          } else {
            argsEl.style.display = "";
          }
          argsLink.setText(" · hide args");
        } else if (argsEl) {
          argsEl.style.display = "none";
          argsLink.setText(" · args");
        }
      });
    } else if (tc.args && tc.args !== "{}") {
      // Short result → still allow seeing args.
      const more = preview.createDiv({ cls: "ai-tool-more" });
      const argsLink = more.createEl("a", { cls: "ai-tool-args-toggle", text: "args" });
      let argsShown = false;
      let argsEl: HTMLElement | null = null;
      argsLink.addEventListener("click", (e) => {
        e.preventDefault();
        argsShown = !argsShown;
        if (argsShown) {
          if (!argsEl) {
            argsEl = preview.createEl("pre", { cls: "ai-tool-args-pre", text: prettyArgs(tc.args) });
          } else {
            argsEl.style.display = "";
          }
          argsLink.setText("hide args");
        } else if (argsEl) {
          argsEl.style.display = "none";
          argsLink.setText("args");
        }
      });
    }
  }

  private renderMarkdown(target: HTMLElement, source: string): void {
    target.empty();
    if (!source) return;
    const sourcePath = this.plugin.app.workspace.getActiveFile()?.path ?? "";
    MarkdownRenderer.render(this.plugin.app, source, target, sourcePath, this.host)
      .then(() => {
        this.wireInternalLinks(target, sourcePath);
        this.decorateCodeBlocks(target);
      })
      .catch(() => {
        target.setText(source);
      });
  }

  /** Obsidian's MarkdownRenderer emits <pre><code class="language-X"> but does
   *  not apply Prism highlighting outside of the editor preview. Obsidian
   *  ships Prism on `window.Prism`; if a language is known, highlight in place.
   *  Also wraps each block with a small header (language + Copy button). */
  private decorateCodeBlocks(target: HTMLElement): void {
    const prism = (window as unknown as { Prism?: PrismLike }).Prism;
    const blocks = target.querySelectorAll("pre > code");
    blocks.forEach((codeNode) => {
      const code = codeNode as HTMLElement;
      const pre = code.parentElement as HTMLPreElement | null;
      if (!pre || pre.dataset.aiHighlighted === "1") return;
      pre.dataset.aiHighlighted = "1";

      const langClass = Array.from(code.classList).find((c) => c.startsWith("language-"));
      const lang = langClass ? langClass.slice("language-".length) : "";

      if (prism && lang && prism.languages && prism.languages[lang]) {
        try {
          prism.highlightElement(code);
        } catch {
          // Best-effort; if Prism throws on bad input, leave the code as-is.
        }
      }

      // Wrap pre in a container with a small header (language + copy button).
      const wrap = pre.doc.createElement("div");
      wrap.className = "ai-code-block";
      pre.parentNode?.insertBefore(wrap, pre);

      const head = wrap.createDiv({ cls: "ai-code-head" });
      head.createSpan({ cls: "ai-code-lang", text: lang || "text" });
      const copyBtn = head.createEl("button", { cls: "ai-code-copy", text: "Copy" });
      copyBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(code.innerText);
          copyBtn.setText("Copied");
          window.setTimeout(() => copyBtn.setText("Copy"), 1200);
        } catch {
          copyBtn.setText("Failed");
          window.setTimeout(() => copyBtn.setText("Copy"), 1200);
        }
      };

      wrap.appendChild(pre);
    });
  }

  private wireInternalLinks(target: HTMLElement, sourcePath: string): void {
    // Obsidian's MarkdownRenderer produces <a class="internal-link" data-href="..."> for
    // [[wikilinks]], but doesn't auto-wire navigation inside custom ItemViews. Delegate
    // clicks to workspace.openLinkText, and forward hover for native link previews.
    const app = this.plugin.app;
    target.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a.internal-link") as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("data-href") || a.getAttribute("href") || a.textContent || "";
      if (!href) return;
      const newLeaf = e.ctrlKey || e.metaKey;
      app.workspace.openLinkText(href, sourcePath, newLeaf);
    });
    target.addEventListener("mouseover", (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a.internal-link") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("data-href") || a.getAttribute("href") || a.textContent || "";
      if (!href) return;
      app.workspace.trigger("hover-link", {
        event: e,
        source: "ai-assistant-chat",
        hoverParent: this.host,
        targetEl: a,
        linktext: href,
        sourcePath,
      });
    });
  }
}
