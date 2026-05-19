import { Component, MarkdownRenderer } from "obsidian";
import type AIAssistantPlugin from "../main";
import type { UiMessage, UiToolCall } from "../llm/types";

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

    if (msg.toolCalls && msg.toolCalls.length) {
      const toolsWrap = container.createDiv();
      for (const tc of msg.toolCalls) {
        this.renderToolCall(toolsWrap, tc);
      }
    }

    const contentEl = container.createDiv({ cls: "ai-chat-content" });
    if (msg.streaming && !msg.content) {
      contentEl.addClass("ai-chat-streaming-cursor");
    } else {
      this.renderMarkdown(contentEl, msg.content || "");
      if (msg.streaming) contentEl.addClass("ai-chat-streaming-cursor");
    }
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
    // sourcePath is empty — wiki-links resolve against vault root, which is fine for chat.
    MarkdownRenderer.render(
      this.plugin.app,
      source,
      target,
      "",
      this.host,
    ).catch(() => {
      target.setText(source);
    });
  }
}
