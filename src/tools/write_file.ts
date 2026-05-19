import { TFile, TFolder } from "obsidian";
import { dirname, safePath } from "../utils/paths";
import { ToolDefinition, ToolError, optionalBool, requireString } from "./types";

async function ensureParentFolder(app: import("obsidian").App, path: string): Promise<void> {
  const dir = dirname(path);
  if (!dir) return;
  const existing = app.vault.getAbstractFileByPath(dir);
  if (existing) {
    if (!(existing instanceof TFolder)) {
      throw new ToolError(`Parent path exists and is not a folder: ${dir}`);
    }
    return;
  }
  await app.vault.createFolder(dir);
}

export const write_file: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file. Fails if the file exists and overwrite=false. Intermediate folders are created automatically.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root." },
          content: { type: "string", description: "Full content of the file." },
          overwrite: {
            type: "boolean",
            description: "Allow overwriting an existing file. Defaults to false.",
          },
        },
        required: ["path", "content"],
      },
    },
  },

  async execute(args, { app }) {
    const path = safePath(requireString(args, "path"));
    const content = requireString(args, "content");
    const overwrite = optionalBool(args, "overwrite", false);

    const existing = app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (!(existing instanceof TFile)) {
        throw new ToolError(`Path exists and is not a file: ${path}`);
      }
      if (!overwrite) {
        throw new ToolError(
          `File already exists: ${path}. Pass overwrite=true to replace it (read it first!).`,
        );
      }
      await app.vault.modify(existing, content);
      return `Overwrote ${path} (${content.length} chars).`;
    }

    await ensureParentFolder(app, path);
    await app.vault.create(path, content);
    return `Created ${path} (${content.length} chars).`;
  },
};
