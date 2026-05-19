import { TFile } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

export const read_file: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full content of a markdown (or any text) file from the vault.",
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
    const content = await app.vault.read(file);
    return content;
  },
};
