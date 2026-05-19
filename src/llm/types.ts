export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: ToolCall[];
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
      name?: string;
    };

export interface UiToolCall {
  id: string;
  name: string;
  args: string;
  status: "running" | "done" | "error";
  result?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  toolCalls?: UiToolCall[];
  streaming?: boolean;
}
