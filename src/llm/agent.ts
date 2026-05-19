import type { App } from "obsidian";
import { ALL_TOOLS, ToolError, ToolSchema, ToolName } from "../tools";
import type { PluginSettings } from "../settings";
import { LLMClient, StreamChunk } from "./client";
import type { ChatMessage, ToolCall } from "./types";
import { maybeSummarize } from "./summarizer";

const MAX_TOOL_ITERATIONS = 20;

export interface AgentCallbacks {
  onAssistantStart: (id: string) => void;
  onContentDelta: (id: string, delta: string) => void;
  onToolCallStart: (id: string, callId: string, name: string, args: string) => void;
  onToolCallResult: (id: string, callId: string, ok: boolean, result: string) => void;
  onAssistantEnd: (id: string) => void;
  onError: (err: Error, currentAssistantId: string | null) => void;
}

export class Agent {
  private client: LLMClient;

  constructor(
    private app: App,
    private settings: PluginSettings,
    private getHistory: () => ChatMessage[],
    private setHistory: (h: ChatMessage[]) => void,
    private saveSettings: () => Promise<void>,
  ) {
    this.client = new LLMClient(settings);
  }

  private enabledToolSchemas(): ToolSchema[] {
    return Object.entries(ALL_TOOLS)
      .filter(([name]) => this.settings.enabledTools[name as ToolName])
      .map(([, def]) => def.schema);
  }

  async runTurn(
    userText: string,
    activeNoteHint: string | null,
    cb: AgentCallbacks,
    signal: AbortSignal,
  ): Promise<void> {
    let currentAssistantId: string | null = null;
    try {
      let history = this.getHistory();
      history = [...history, { role: "user", content: userText }];
      this.setHistory(history);

      const systemPrompt = activeNoteHint
        ? `${this.settings.systemPrompt}\n\n${activeNoteHint}`
        : this.settings.systemPrompt;

      history = await maybeSummarize(
        this.client,
        systemPrompt,
        history,
        this.settings.maxContextTokens,
      );
      this.setHistory(history);

      const schemas = this.enabledToolSchemas();

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const assistantUiId = `m_${Date.now()}_${iter}`;
        currentAssistantId = assistantUiId;
        cb.onAssistantStart(assistantUiId);

        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          ...this.getHistory(),
        ];

        const result = await this.client.streamChat(
          messages,
          schemas,
          (chunk: StreamChunk) => {
            if (chunk.contentDelta) {
              cb.onContentDelta(assistantUiId, chunk.contentDelta);
            }
          },
          signal,
        );

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: result.content || null,
          tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
          ...(result.reasoningContent ? { reasoning_content: result.reasoningContent } : {}),
        };
        this.setHistory([...this.getHistory(), assistantMsg]);

        if (!result.toolCalls.length) {
          cb.onAssistantEnd(assistantUiId);
          return;
        }

        // Execute each tool call.
        for (const tc of result.toolCalls) {
          cb.onToolCallStart(assistantUiId, tc.id, tc.function.name, tc.function.arguments);
          const toolResult = await this.executeToolCall(tc);
          cb.onToolCallResult(assistantUiId, tc.id, toolResult.ok, toolResult.text);
          this.setHistory([
            ...this.getHistory(),
            {
              role: "tool",
              content: toolResult.text,
              tool_call_id: tc.id,
              name: tc.function.name,
            },
          ]);
        }

        cb.onAssistantEnd(assistantUiId);

        if (signal.aborted) return;
      }

      cb.onError(
        new Error(
          `Tool-call loop exceeded ${MAX_TOOL_ITERATIONS} iterations without a final answer.`,
        ),
        currentAssistantId,
      );
    } catch (e) {
      if ((e as Error).name === "AbortError" || signal.aborted) return;
      cb.onError(e as Error, currentAssistantId);
    }
  }

  private async executeToolCall(tc: ToolCall): Promise<{ ok: boolean; text: string }> {
    const def = ALL_TOOLS[tc.function.name];
    if (!def) {
      return { ok: false, text: `Unknown tool: ${tc.function.name}` };
    }
    if (!this.settings.enabledTools[tc.function.name as ToolName]) {
      return { ok: false, text: `Tool is disabled in settings: ${tc.function.name}` };
    }

    let args: Record<string, unknown> = {};
    try {
      args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch (e) {
      return {
        ok: false,
        text: `Invalid JSON arguments: ${(e as Error).message}. Raw: ${tc.function.arguments.slice(0, 200)}`,
      };
    }

    try {
      const text = await def.execute(args, {
        app: this.app,
        settings: this.settings,
        saveSettings: this.saveSettings,
      });
      return { ok: true, text };
    } catch (e) {
      const err = e as Error;
      const tag = err instanceof ToolError ? "ToolError" : err.name || "Error";
      return { ok: false, text: `${tag}: ${err.message}` };
    }
  }
}
