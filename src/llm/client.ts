import OpenAI from "openai";
import type { PluginSettings } from "../settings";
import type { ChatMessage, ToolCall } from "./types";
import type { ToolSchema } from "../tools";

export interface StreamChunk {
  contentDelta?: string;
  toolCallDeltas?: Array<{
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  }>;
}

export interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

export class LLMClient {
  private client: OpenAI;

  constructor(private settings: PluginSettings) {
    this.client = new OpenAI({
      baseURL: settings.baseUrl,
      apiKey: settings.apiKey || "EMPTY",
      dangerouslyAllowBrowser: true,
    });
  }

  async streamChat(
    messages: ChatMessage[],
    tools: ToolSchema[],
    onChunk: (c: StreamChunk) => void,
    signal: AbortSignal,
  ): Promise<StreamResult> {
    if (!this.settings.model) {
      throw new Error("Model name is not configured. Open settings and set the model.");
    }

    const params: Parameters<typeof this.client.chat.completions.create>[0] = {
      model: this.settings.model,
      messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: this.settings.temperature,
      top_p: this.settings.topP,
      stream: true,
    };
    if (tools.length) {
      params.tools = tools as unknown as OpenAI.Chat.ChatCompletionTool[];
      params.tool_choice = "auto";
    }

    const stream = await this.client.chat.completions.create(params, { signal });

    let content = "";
    const accumulated: Array<{ id: string; name: string; arguments: string }> = [];
    let finishReason: string | null = null;

    for await (const chunk of stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        content += delta.content;
        onChunk({ contentDelta: delta.content });
      }
      if (delta?.tool_calls) {
        const tcDeltas: NonNullable<StreamChunk["toolCallDeltas"]> = [];
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!accumulated[idx]) {
            accumulated[idx] = { id: "", name: "", arguments: "" };
          }
          if (tc.id) accumulated[idx].id = tc.id;
          if (tc.function?.name) accumulated[idx].name += tc.function.name;
          if (tc.function?.arguments) accumulated[idx].arguments += tc.function.arguments;
          tcDeltas.push({
            index: idx,
            id: tc.id,
            name: tc.function?.name,
            argumentsDelta: tc.function?.arguments,
          });
        }
        onChunk({ toolCallDeltas: tcDeltas });
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const toolCalls: ToolCall[] = accumulated
      .filter((a) => a && a.name)
      .map((a, i) => ({
        id: a.id || `call_${i}`,
        type: "function" as const,
        function: { name: a.name, arguments: a.arguments || "{}" },
      }));

    return { content, toolCalls, finishReason };
  }

  async complete(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    if (!this.settings.model) {
      throw new Error("Model name is not configured.");
    }
    const res = await this.client.chat.completions.create(
      {
        model: this.settings.model,
        messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature: 0.3,
        stream: false,
      },
      { signal },
    );
    return res.choices?.[0]?.message?.content ?? "";
  }
}
