import { TFile } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

export const append_to_file: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "append_to_file",
      description: "Append content to the end of an existing file. A newline is inserted if the file doesn't end with one.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root." },
          content: { type: "string", description: "Text to append." },
        },
        required: ["path", "content"],
      },
    },
  },

  async execute(args, { app }) {
    const path = safePath(requireString(args, "path"));
    const content = requireString(args, "content");

    const file = app.vault.getAbstractFileByPath(path);
    if (!file) throw new ToolError(`File not found: ${path}`);
    if (!(file instanceof TFile)) throw new ToolError(`Not a file: ${path}`);

    await app.vault.process(file, (current) => {
      const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
      return current + sep + content;
    });
    return `Appended ${content.length} chars to ${path}.`;
  },
};
