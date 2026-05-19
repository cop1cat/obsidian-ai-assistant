# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
