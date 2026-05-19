import { Tiktoken, getEncoding } from "js-tiktoken";
import type { ChatMessage } from "./types";

let enc: Tiktoken | null = null;

function encoder(): Tiktoken {
  if (!enc) {
    // cl100k_base covers GPT-3.5/4. For Llama/Qwen tokenizers it's an approximation,
    // which is fine for the summarization threshold.
    enc = getEncoding("cl100k_base");
  }
  return enc;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encoder().encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function countMessageTokens(message: ChatMessage): number {
  // ~4 tokens of structural overhead per message (role, separators).
  let total = 4;
  if (typeof message.content === "string") {
    total += countTokens(message.content);
  }
  if (message.role === "assistant" && message.tool_calls) {
    for (const tc of message.tool_calls) {
      total += countTokens(tc.function.name);
      total += countTokens(tc.function.arguments);
      total += 6;
    }
  }
  if (message.role === "tool") {
    total += countTokens(message.tool_call_id ?? "");
  }
  return total;
}

export function countHistoryTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + countMessageTokens(m), 0);
}
