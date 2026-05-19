import { TFile } from "obsidian";
import { safePath } from "../utils/paths";
import { ToolDefinition, ToolError, requireString } from "./types";

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

export const edit_file: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace a unique occurrence of old_string with new_string in a file. Fails if old_string is missing or appears more than once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to vault root." },
          old_string: {
            type: "string",
            description: "Exact text to find. Must match once. Include surrounding context to disambiguate.",
          },
          new_string: { type: "string", description: "Replacement text." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },

  async execute(args, { app }) {
    const path = safePath(requireString(args, "path"));
    const oldStr = requireString(args, "old_string");
    const newStr = requireString(args, "new_string");

    if (oldStr === newStr) {
      throw new ToolError("old_string and new_string are identical — nothing to do.");
    }

    const file = app.vault.getAbstractFileByPath(path);
    if (!file) throw new ToolError(`File not found: ${path}`);
    if (!(file instanceof TFile)) throw new ToolError(`Not a file: ${path}`);

    const content = await app.vault.read(file);
    const occurrences = countOccurrences(content, oldStr);

    if (occurrences === 0) {
      throw new ToolError(
        `old_string not found in ${path}. Read the file again to get the exact text.`,
      );
    }
    if (occurrences > 1) {
      throw new ToolError(
        `old_string is not unique in ${path} (found ${occurrences} times). Add surrounding context to disambiguate.`,
      );
    }

    const updated = content.replace(oldStr, newStr);
    await app.vault.modify(file, updated);
    return `Edited ${path} (replaced 1 occurrence).`;
  },
};
