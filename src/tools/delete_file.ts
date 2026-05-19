import { TFile } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

export const delete_file: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "delete_file",
      description: "Move a file to the system trash (recoverable). Never permanently deletes.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root." },
        },
        required: ["path"],
      },
    },
  },

  async execute(args, { app }) {
    const path = safePath(requireString(args, "path"));
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) throw new ToolError(`File not found: ${path}`);
    if (!(file instanceof TFile)) throw new ToolError(`Not a file: ${path}`);

    await app.vault.trash(file, true);
    return `Moved ${path} to system trash.`;
  },
};
