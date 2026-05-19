import type { App } from "obsidian";
import type { PluginSettings } from "../settings";

export interface ToolContext {
  app: App;
  settings: PluginSettings;
  saveSettings: () => Promise<void>;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolDefinition {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class ToolError extends Error {}

export function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") {
    throw new ToolError(`Argument "${key}" must be a string`);
  }
  return v;
}

export function optionalString(args: Record<string, unknown>, key: string, fallback = ""): string {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string") {
    throw new ToolError(`Argument "${key}" must be a string`);
  }
  return v;
}

export function optionalBool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "boolean") {
    throw new ToolError(`Argument "${key}" must be a boolean`);
  }
  return v;
}
