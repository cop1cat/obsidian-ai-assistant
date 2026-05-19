# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.6] — 2026-05-20

### Fixed
- Search input in the sessions list now aligns horizontally with the active-chat highlight underneath. The search wrapper's horizontal padding (`6px`) matches the row's `margin: 1px 6px`, so left/right edges line up.
- Hover state of the per-row trash button no longer fills the button solid red (which hid the icon). Background stays `--background-primary`; border and icon turn `--text-error` for a clear "danger" cue with the icon still visible.

## [0.3.5] — 2026-05-20

### Fixed
- Messages no longer get clipped and the chat pane scrolls correctly. The 0.3.4 width fix added `overflow: hidden` to `.ai-chat-msg`, which clipped tall content and broke vertical scrolling; replaced with `flex-shrink: 0` so bubbles take their natural height while still being bounded width-wise.
- User message bubbles now show their full rounded corners again (overflow clipping was hiding part of the radius under the accent border-left).

### Changed
- Active session in the chat list is now a rounded block (6px radius, 6px side margins, inset accent border) instead of an edge-to-edge rectangle with a 2px left bar. Hover keeps the simple fill; active adds the accent outline.

## [0.3.4] — 2026-05-20

### Added
- Syntax highlighting for fenced code blocks in assistant messages. Uses Obsidian's bundled Prism (`window.Prism`); unknown languages fall back to plain monospace. Each block is wrapped with a small header showing the language and a **Copy** button.

### Changed
- Scroll-to-bottom button is bigger and louder: 36×36 (was 32), icon 20×20 (was 16), fully opaque. On hover it fills with the accent colour (background + border + icon) instead of just dimming.
- "New chat" button height locked to 28px with `line-height: 1` so it aligns with the square ⚙ next to it — no more vertical misalignment in the header.
- Per-row trash button restyled: 28×28 with a border and primary background; on hover the border and icon turn `--text-error`. Removed the pill wrapper that made the action area look like an awkward bar.

### Fixed
- Assistant messages with long code blocks or unbroken strings no longer stretch the chat pane past the container width. The message bubble (`.ai-chat-msg`), its content area, and the messages container now propagate `min-width: 0` / `max-width: 100%` properly; long code scrolls horizontally inside the code block instead of pushing the bubble out.

## [0.3.3] — 2026-05-20

### Added
- Trash icon on hover for each session row in the list — one-click delete with a confirm prompt. Stops generation first if the active session is being deleted.
- Double-click a chat title to rename it in place. Works in both the chat-header title and in any list row. Enter / blur commits, Escape reverts.

### Changed
- Header icon buttons (✕ back, ⋯ chat menu, ⚙ settings) and composer buttons (Send / Stop) are now consistent 28×28 squares with a 6px radius and 16×16 icons — no more "squished" / asymmetric look. The list-mode-only override is gone; one rule covers both modes.

## [0.3.2] — 2026-05-20

### Added
- Search box at the top of the sessions list. Live-filters as you type, matching session titles *and* the contents of any message in the session. Matched substrings are highlighted with `<mark>` in both the title and a short snippet (±24/40 chars around the match, clamped to two lines). A small marker on the meta row (`in title` / `in message` / `in title + message`) tells you where the hit was found. `Esc` clears the query.
- Sessions now show the **absolute timestamp** of the last update instead of a relative "5 minutes ago" — same-day: `14:23`; yesterday: `Yesterday 14:23`; this year: `12 May, 14:23`; older: `12 May 2025, 14:23`. Locale-aware. Hover the meta row to see the full date/time.

### Changed
- List-mode header re-balanced: gap between "New chat" and ⚙ widened to 8px; the ⚙ button is now a square 28×28 with a 6px radius so it doesn't look "rectangular-glued" to the accent button.

## [0.3.1] — 2026-05-20

### Added
- Default system prompt gains a **Style** section: match the user's language, plain neutral tone, no sycophancy ("отличный план", "great idea", etc.), no emoji or decorative symbols, no exclamation marks, no filler openers/closers ("Конечно!", "С чего начнём?", "Hope this helps"), no unprompted menus of next-step options, no announcing intent — answer or act directly. Aim for the tone of an engineer's PR comment.
- Notice on plugin load + banner in Settings → AI Assistant when the shipped default prompt changes and the user hasn't customised theirs. Detection is hash-based (FNV-1a of the prompt): a `systemPromptBaselineHash` is stored when the user last accepted/saved a prompt, and we only warn when `hash(current) === baseline && baseline !== hash(new default)` — so custom prompts are never flagged. The banner's "Review new default" button opens the editor preloaded with the new default; nothing is saved until the user clicks Save. "Keep current" re-baselines so the warning doesn't reappear. New toggle "Notify when default system prompt changes" lets users disable the nag entirely.
- Sticky-bottom autoscroll: the messages pane only auto-scrolls when the user is already near the bottom (within 32px). Scrolling up while the assistant streams no longer fights with the user.
- "Scroll to latest" floating button (circular, bottom-right of the messages area) appears whenever the user is scrolled up; click pins back to the bottom.
- "New chat" button in the list-mode header is now a labelled accent-coloured button (icon + text), not a bare `+`.

## [0.3.0] — 2026-05-20

### Changed
- **Breaking — memory storage moved out of the vault.** The assistant's persistent memory now lives inside the plugin's `data.json` (alongside settings and sessions) rather than in a `_AI/memory.md` note. The `memoryNotePath` setting is gone; a new `memoryText` (plus `memoryUpdatedAt`) field holds the contents. Settings tab gains a full-width textarea editor with Clear / Copy and a "last updated" timestamp. Existing `_AI/memory.md` content is not auto-migrated — copy it into Settings → Memory once if you want to keep it.
- `read_memory` / `write_memory` / `append_memory` rewritten to read and write `settings.memoryText` directly and persist via a new `saveSettings` callback exposed on `ToolContext`.
- Chat view restructured around two modes: **list mode** (full-height sessions list, default) and **chat mode** (header with ✕ back-button, current session title, ⋯ rename/delete menu, messages and composer). Clicking a session row enters chat mode; ✕ returns to the list. Replaces the previous always-visible sessions sidebar at the top of the chat view.
- "Extra body (JSON)" rebuilt as a dedicated full-width editor (monospace textarea, vertical resize, `white-space: pre`) with a live status line — `empty` / `valid JSON` / `invalid JSON: <error>` updated on every keystroke. Replaces the cramped `Setting` row.

### Fixed
- Composer no longer renders a "double purple border": added internal padding to `.ai-composer`, suppressed textarea focus outline/box-shadow with `!important`, and tightened context-chip / button-bar padding so the file-path chip no longer touches the container border.
- Message bubbles now have symmetric top/bottom padding: `.ai-chat-msg` switched to a flex column with `gap`, header and content margins zeroed out, so the gap above "You/Assistant" matches the gap below the last line.
- Removed the per-row ⋯ button from session rows (right-click menu still works), cutting down on hover transitions and re-renders that made the menu feel laggy.

## [0.2.1] — 2026-05-19

### Added
- Sessions sidebar at the top of the chat view, in the style of the Claude Code VS Code extension: vertical list of sessions with active-indicator, title, message count and relative-time meta, hover-revealed action menu, and a header strip with collapse toggle, new-chat (+) and settings (⚙) icons.
- Composer rebuilt as a single bordered container: active-note context chip at the top, auto-growing textarea, model name chip (click → open settings) and icon-only Send / Stop buttons. Focus and generating states are highlighted via the border colour.
- Empty-state hint in the messages area when a session has no messages yet.
- Typing-indicator animation (three pulsing dots) shown while the assistant has accepted the turn but hasn't streamed any text yet.
- Temporal context block injected into the system message on every turn: current local time and ISO time, the memory note's last-modified timestamp, and the elapsed time since the previous user message. Lets the model reason about recency.
- Destructive-safety rules added to the default system prompt: never delete, overwrite, revert or move things the user did not explicitly ask about; prefer asking a clarifying question over a destructive action; treat the current vault content as the user's source of truth.

### Fixed
- Wikilinks (`[[...]]`) inside assistant replies are now clickable — the renderer delegates clicks to `workspace.openLinkText` and forwards hover for native link previews. `Ctrl`/`Cmd` + click opens in a new pane.
- Clicking "+ New" while already in an empty chat focuses the input instead of creating an indistinguishable duplicate session.

## [0.2.0] — 2026-05-19

### Added
- Multi-session chat: sessions dropdown in the chat header with New / Rename / Delete actions, "New chat session" command in the palette, and automatic migration of the pre-0.2 single-chat blob to a session named "Chat 1".
- Input history recall: `↑` / `↓` in the chat input cycles through previously sent messages (in-memory, per view).
- Copy buttons on user, assistant, and error messages (appear on hover).
- System prompt editor opens in a full-window modal with Copy, Reset to default, Save and Cancel buttons. The settings page now shows a single-line preview and a Copy action.
- Tool descriptions are now rendered next to each toggle in settings.
- New file/folder tools: `move_path` (move or rename files and folders via `fileManager.renameFile`, which updates links) and `create_folder` (with parents).
- Persistent memory: `memoryNotePath` setting (default `_AI/memory.md`), tools `read_memory` / `write_memory` / `append_memory`, and automatic injection of the memory note's contents into the system message on every turn. Updated the default system prompt to teach the model to use memory for durable vault facts.
- "Extra request params" setting: a free-form JSON object merged into every chat-completion request body. Lets users opt into server-specific extras such as disabling Qwen3 thinking via `{"chat_template_kwargs":{"enable_thinking":false}}` or setting `reasoning_effort` for OpenAI o-series. Invalid JSON is ignored with a console warning.

### Changed
- Default system prompt now mentions move/rename, folder creation, and the memory workflow.

### Fixed
- Assistant no longer appears hung after an error: the streaming flag is cleared on the in-progress assistant message and a fallback sweep guarantees no message stays in "streaming" state after the turn ends.
- Thinking-capable models (Qwen3, DeepSeek-R1, GLM, …): reasoning content is now captured from `delta.reasoning_content` / `delta.reasoning` during streaming and echoed back as `assistant.reasoning_content` on subsequent turns, so servers that require this round-trip no longer reject the request with "reasoning content in the thinking mode must be passed back".

## [0.1.0] — 2026-05-19

### Added
- Initial release.
- Streaming chat view in the Obsidian right panel with Markdown rendering and wikilink support.
- Tool calling against the vault: `list_files`, `read_file`, `write_file`, `edit_file`, `append_to_file`, `delete_file`, `search` (with optional ripgrep integration), `get_backlinks`, `get_outlinks`, `get_tags`.
- Active note context injection into the system prompt.
- Automatic history summarization when context grows past a configurable threshold.
- Per-tool toggles in settings.
- Path safety: all tool paths are normalized via `normalizePath`, absolute paths and `..` traversal are rejected, deletions go to the system trash.

[Unreleased]: https://github.com/cop1cat/obsidian-ai-assistant/compare/0.2.1...HEAD
[0.2.1]: https://github.com/cop1cat/obsidian-ai-assistant/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/cop1cat/obsidian-ai-assistant/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/cop1cat/obsidian-ai-assistant/releases/tag/0.1.0
