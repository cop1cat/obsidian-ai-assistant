import { TFolder } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

export const create_folder: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "create_folder",
      description:
        "Create a folder at the given path. Intermediate parent folders are created automatically. No-op if the folder already exists.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Folder path relative to vault root." },
        },
        required: ["path"],
      },
    },
  },

  async execute(args, { app }) {
    const path = safePath(requireString(args, "path"));
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (existing instanceof TFolder) return `Folder already exists: ${path}`;
      throw new ToolError(`Path exists and is not a folder: ${path}`);
    }
    await app.vault.createFolder(path);
    return `Created folder: ${path}`;
  },
};
