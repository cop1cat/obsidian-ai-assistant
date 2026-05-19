import { TFile } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

export const get_backlinks: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "get_backlinks",
      description: "List files that link to the given note via [[wikilinks]] or markdown links.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the target note." },
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

    const cache = app.metadataCache as unknown as {
      getBacklinksForFile?: (f: TFile) => { data: Map<string, unknown> };
    };
    if (typeof cache.getBacklinksForFile !== "function") {
      throw new ToolError("Backlinks API is not available in this Obsidian version.");
    }
    const backlinks = cache.getBacklinksForFile(file);
    const paths = Array.from(backlinks.data.keys()).sort();
    return JSON.stringify({ count: paths.length, backlinks: paths }, null, 2);
  },
};
