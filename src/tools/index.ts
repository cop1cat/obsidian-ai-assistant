import type { ToolDefinition } from "./types";
import { list_files } from "./list_files";
import { read_file } from "./read_file";
import { write_file } from "./write_file";
import { edit_file } from "./edit_file";
import { append_to_file } from "./append_to_file";
import { delete_file } from "./delete_file";
import { search } from "./search";
import { get_backlinks } from "./get_backlinks";
import { get_outlinks } from "./get_outlinks";
import { get_tags } from "./get_tags";

export const ALL_TOOLS: Record<string, ToolDefinition> = {
  list_files,
  read_file,
  write_file,
  edit_file,
  append_to_file,
  delete_file,
  search,
  get_backlinks,
  get_outlinks,
  get_tags,
};

export const ALL_TOOL_NAMES = Object.keys(ALL_TOOLS) as ToolName[];

export type ToolName =
  | "list_files"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "append_to_file"
  | "delete_file"
  | "search"
  | "get_backlinks"
  | "get_outlinks"
  | "get_tags";

export { ToolError } from "./types";
export type { ToolContext, ToolDefinition, ToolSchema } from "./types";
