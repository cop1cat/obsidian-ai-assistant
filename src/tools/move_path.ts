import { TFolder } from "obsidian";
import { dirname, safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

export const move_path: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "move_path",
      description:
        "Move or rename a file or folder. Works for both. Intermediate parent folders are created automatically. Refuses to overwrite an existing destination.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Current path, relative to vault root." },
          to: { type: "string", description: "Target path, relative to vault root." },
        },
        required: ["from", "to"],
      },
    },
  },

  async execute(args, { app }) {
    const from = safePath(requireString(args, "from"));
    const to = safePath(requireString(args, "to"));
    if (from === to) return `No-op: source and destination are the same (${from}).`;

    const src = app.vault.getAbstractFileByPath(from);
    if (!src) throw new ToolError(`Path not found: ${from}`);

    const existing = app.vault.getAbstractFileByPath(to);
    if (existing) throw new ToolError(`Destination already exists: ${to}`);

    const parent = dirname(to);
    if (parent) {
      const parentItem = app.vault.getAbstractFileByPath(parent);
      if (!parentItem) {
        await app.vault.createFolder(parent);
      } else if (!(parentItem instanceof TFolder)) {
        throw new ToolError(`Destination parent is not a folder: ${parent}`);
      }
    }

    await app.fileManager.renameFile(src, to);
    return `Moved ${from} → ${to}`;
  },
};
