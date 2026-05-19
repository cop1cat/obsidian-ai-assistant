import { ToolDefinition, requireString } from "./types";

async function persist(
  ctx: { settings: { memoryText: string; memoryUpdatedAt: number }; saveSettings: () => Promise<void> },
  next: string,
): Promise<void> {
  ctx.settings.memoryText = next;
  ctx.settings.memoryUpdatedAt = Date.now();
  await ctx.saveSettings();
}

export const read_memory: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "read_memory",
      description:
        "Read the assistant's persistent memory (stored inside the plugin's settings, not in the vault). Returns the full contents, or an empty string if nothing has been recorded yet. Use at the start of a conversation to recall what you previously learned about this vault.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  async execute(_args, { settings }) {
    return settings.memoryText ?? "";
  },
};

export const write_memory: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "write_memory",
      description:
        "Overwrite the assistant's memory with new content. Stored inside the plugin's settings (data.json), not in the vault. Use to record durable facts about the vault: folder conventions, naming patterns, recurring topics, important MOCs/index notes, user preferences.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Full new content of the memory." },
        },
        required: ["content"],
      },
    },
  },
  async execute(args, ctx) {
    const content = requireString(args, "content");
    await persist(ctx, content);
    return `Wrote memory (${content.length} chars).`;
  },
};

export const append_memory: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "append_memory",
      description:
        "Append text to the assistant's memory (creating it if empty). Prefer this over write_memory for incremental additions so previously recorded facts are preserved.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to append (a leading newline is added automatically if memory is non-empty)." },
        },
        required: ["text"],
      },
    },
  },
  async execute(args, ctx) {
    const text = requireString(args, "text");
    const existing = ctx.settings.memoryText ?? "";
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    await persist(ctx, existing + sep + text);
    return `Appended ${text.length} chars to memory.`;
  },
};
