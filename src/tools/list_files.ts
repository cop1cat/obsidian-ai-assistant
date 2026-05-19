import { TFile, TFolder } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, optionalBool, optionalString } from "./types";

export const list_files: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List markdown files in the vault under an optional folder path. Returns path, size (bytes), and last-modified timestamp.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Folder path relative to vault root. Empty string for the root.",
          },
          recursive: {
            type: "boolean",
            description: "If true, recurse into subfolders.",
          },
        },
        required: [],
      },
    },
  },

  async execute(args, { app }) {
    const rawPath = optionalString(args, "path", "");
    const recursive = optionalBool(args, "recursive", false);
    const path = safePath(rawPath, { allowEmpty: true });

    const root =
      path === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(path);

    if (!root) {
      throw new ToolError(`Folder not found: ${path}`);
    }
    if (!(root instanceof TFolder)) {
      throw new ToolError(`Not a folder: ${path}`);
    }

    const results: Array<{ path: string; size: number; mtime: string }> = [];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFile) {
          if (child.extension === "md") {
            results.push({
              path: child.path,
              size: child.stat.size,
              mtime: new Date(child.stat.mtime).toISOString(),
            });
          }
        } else if (child instanceof TFolder && recursive) {
          walk(child);
        }
      }
    };
    walk(root);

    results.sort((a, b) => a.path.localeCompare(b.path));
    return JSON.stringify({ count: results.length, files: results }, null, 2);
  },
};
