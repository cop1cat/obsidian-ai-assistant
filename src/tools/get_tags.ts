import { TFile, getAllTags } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, optionalString } from "./types";

export const get_tags: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "get_tags",
      description:
        "If path is provided: list the tags of that note. Otherwise: list all tags across the vault with their frequency.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional. Path to a specific note." },
        },
        required: [],
      },
    },
  },

  async execute(args, { app }) {
    const rawPath = optionalString(args, "path", "");
    if (rawPath) {
      const path = safePath(rawPath);
      const file = app.vault.getAbstractFileByPath(path);
      if (!file) throw new ToolError(`File not found: ${path}`);
      if (!(file instanceof TFile)) throw new ToolError(`Not a file: ${path}`);
      const cache = app.metadataCache.getFileCache(file);
      const tags = cache ? getAllTags(cache) ?? [] : [];
      return JSON.stringify({ path, tags: Array.from(new Set(tags)).sort() }, null, 2);
    }

    const counts = new Map<string, number>();
    for (const f of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(f);
      if (!cache) continue;
      const tags = getAllTags(cache) ?? [];
      for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return JSON.stringify({ count: sorted.length, tags: sorted }, null, 2);
  },
};
