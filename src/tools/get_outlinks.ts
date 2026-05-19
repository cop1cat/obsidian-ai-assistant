import { TFile } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

export const get_outlinks: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "get_outlinks",
      description: "List outgoing links and embeds from a note, resolved to vault paths where possible.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the source note." },
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

    const cache = app.metadataCache.getFileCache(file);
    const out: Array<{ link: string; resolved: string | null; type: "link" | "embed" }> = [];
    const collect = (
      items: Array<{ link: string }> | undefined,
      type: "link" | "embed",
    ) => {
      if (!items) return;
      for (const it of items) {
        const dest = app.metadataCache.getFirstLinkpathDest(it.link, file.path);
        out.push({ link: it.link, resolved: dest ? dest.path : null, type });
      }
    };
    collect(cache?.links, "link");
    collect(cache?.embeds, "embed");

    return JSON.stringify({ count: out.length, links: out }, null, 2);
  },
};
