import { TFile, TFolder } from "obsidian";
import { dirname, safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

async function ensureMemoryFile(
  app: import("obsidian").App,
  path: string,
  initial = "",
): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  if (existing) {
    throw new ToolError(`Memory path exists and is not a file: ${path}`);
  }
  const parent = dirname(path);
  if (parent) {
    const parentItem = app.vault.getAbstractFileByPath(parent);
    if (!parentItem) {
      await app.vault.createFolder(parent);
    } else if (!(parentItem instanceof TFolder)) {
      throw new ToolError(`Memory parent is not a folder: ${parent}`);
    }
  }
  return app.vault.create(path, initial);
}

function memoryPath(settings: { memoryNotePath: string }): string {
  const p = settings.memoryNotePath?.trim();
  if (!p) {
    throw new ToolError(
      "Memory is disabled. Set 'Memory note path' in AI Assistant settings to enable.",
    );
  }
  return safePath(p);
}

export const read_memory: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "read_memory",
      description:
        "Read the assistant's persistent memory note for this vault. Returns the full contents, or an empty string if the note doesn't exist yet. Use at the start of a conversation to recall what you previously learned about this vault.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  async execute(_args, { app, settings }) {
    const path = memoryPath(settings);
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) return "";
    if (!(file instanceof TFile)) {
      throw new ToolError(`Memory path is not a file: ${path}`);
    }
    return app.vault.cachedRead(file);
  },
};

export const write_memory: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "write_memory",
      description:
        "Overwrite the assistant's memory note with new content. Creates the note (and any parent folders) if missing. Use to record durable facts about the vault: folder conventions, naming patterns, recurring topics, important MOCs/index notes, user preferences.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Full new content of the memory note." },
        },
        required: ["content"],
      },
    },
  },
  async execute(args, { app, settings }) {
    const path = memoryPath(settings);
    const content = requireString(args, "content");
    const file = await ensureMemoryFile(app, path, "");
    await app.vault.modify(file, content);
    return `Wrote memory (${content.length} chars) to ${path}.`;
  },
};

export const append_memory: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "append_memory",
      description:
        "Append text to the assistant's memory note (creating it if missing). Prefer this over write_memory for incremental additions so previously recorded facts are preserved.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to append (a leading newline is added automatically if the file is non-empty)." },
        },
        required: ["text"],
      },
    },
  },
  async execute(args, { app, settings }) {
    const path = memoryPath(settings);
    const text = requireString(args, "text");
    const file = await ensureMemoryFile(app, path, "");
    const existing = await app.vault.read(file);
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    await app.vault.modify(file, existing + sep + text);
    return `Appended ${text.length} chars to ${path}.`;
  },
};
