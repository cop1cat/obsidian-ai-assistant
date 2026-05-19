import type { ChatMessage } from "./types";
import { LLMClient } from "./client";
import { countHistoryTokens } from "./tokenizer";

const KEEP_RECENT = 10;
const TOOL_RESULT_KEEP = 5;

const SUMMARIZE_PROMPT = `Compress the following conversation history into a concise summary.
Preserve:
- The user's overall task and current focus.
- Key decisions made.
- Files created, modified, or deleted (with paths).
- Important findings from tool calls (e.g., note structures, conventions).
Discard verbose tool output. Output a single dense paragraph, no headers.`;

/**
 * Drop tool messages and assistant tool_calls that are older than the most recent
 * TOOL_RESULT_KEEP messages. The model can re-read files if it needs to.
 */
export function pruneOldToolResults(messages: ChatMessage[]): ChatMessage[] {
  const cutoff = messages.length - TOOL_RESULT_KEEP;
  if (cutoff <= 0) return messages;
  return messages.filter((m, i) => {
    if (i >= cutoff) return true;
    if (m.role === "tool") return false;
    if (m.role === "assistant" && m.tool_calls && !m.content) return false;
    return true;
  });
}

export async function maybeSummarize(
  client: LLMClient,
  systemPrompt: string,
  history: ChatMessage[],
  maxTokens: number,
): Promise<ChatMessage[]> {
  const systemMsg: ChatMessage = { role: "system", content: systemPrompt };
  const full = [systemMsg, ...history];

  let total = countHistoryTokens(full);
  if (total <= maxTokens) return history;

  // First, try pruning old tool messages — often enough.
  let pruned = pruneOldToolResults(history);
  total = countHistoryTokens([systemMsg, ...pruned]);
  if (total <= maxTokens) return pruned;

  // Still too big — summarize everything except the last KEEP_RECENT messages.
  if (pruned.length <= KEEP_RECENT) return pruned;

  const toSummarize = pruned.slice(0, pruned.length - KEEP_RECENT);
  const tail = pruned.slice(pruned.length - KEEP_RECENT);

  const flat = toSummarize
    .map((m) => {
      if (m.role === "tool") return `[tool result] ${m.content.slice(0, 800)}`;
      if (m.role === "assistant") {
        const tc = m.tool_calls
          ? ` [called: ${m.tool_calls.map((t) => t.function.name).join(", ")}]`
          : "";
        return `[assistant] ${m.content ?? ""}${tc}`;
      }
      if (m.role === "user") return `[user] ${m.content}`;
      return `[${m.role}] ${typeof (m as { content?: unknown }).content === "string" ? (m as { content: string }).content : ""}`;
    })
    .join("\n\n");

  const summary = await client.complete([
    { role: "system", content: SUMMARIZE_PROMPT },
    { role: "user", content: flat },
  ]);

  return [
    {
      role: "user",
      content: `[Earlier conversation summary]\n${summary}`,
    },
    ...tail,
  ];
}
