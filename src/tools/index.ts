import type { ToolDefinition } from "./types";
import { list_files } from "./list_files";
import { read_file } from "./read_file";
import { write_file } from "./write_file";
import { edit_file } from "./edit_file";
import { append_to_file } from "./append_to_file";
import { delete_file } from "./delete_file";
import { move_path } from "./move_path";
import { create_folder } from "./create_folder";
import { search } from "./search";
import { get_backlinks } from "./get_backlinks";
import { get_outlinks } from "./get_outlinks";
import { get_tags } from "./get_tags";
import { read_memory, write_memory, append_memory } from "./memory";

export const ALL_TOOLS: Record<string, ToolDefinition> = {
  list_files,
  read_file,
  write_file,
  edit_file,
  append_to_file,
  delete_file,
  move_path,
  create_folder,
  search,
  get_backlinks,
  get_outlinks,
  get_tags,
  read_memory,
  write_memory,
  append_memory,
};

export const ALL_TOOL_NAMES = Object.keys(ALL_TOOLS) as ToolName[];

export type ToolName =
  | "list_files"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "append_to_file"
  | "delete_file"
  | "move_path"
  | "create_folder"
  | "search"
  | "get_backlinks"
  | "get_outlinks"
  | "get_tags"
  | "read_memory"
  | "write_memory"
  | "append_memory";

/** Human-friendly descriptions shown in the settings UI. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_files:
    "List files and folders under a given path. Use for discovering what's in the vault. Read-only.",
  read_file: "Read a markdown file by path and return its full contents. Read-only.",
  write_file:
    "Create a new file or overwrite an existing one. Creates intermediate folders. Destructive when overwriting — disable for a read-only assistant.",
  edit_file:
    "Replace an exact substring in a file (find-and-replace, single occurrence). The model is instructed to read first. Destructive — disable for a read-only assistant.",
  append_to_file:
    "Append text to the end of an existing file. Creates the file if it does not exist. Destructive.",
  delete_file:
    "Move a file to the system trash (recoverable, never permanent). Destructive — disable to forbid deletion.",
  move_path:
    "Move or rename a file or folder. Refuses to overwrite an existing destination. Destructive (changes paths and links).",
  create_folder: "Create a folder, including parents. Non-destructive.",
  search:
    "Full-text search across markdown notes. Uses ripgrep if configured in settings, otherwise a JS fallback. Read-only.",
  get_backlinks:
    "List notes that link TO the given note (via Obsidian's metadata cache). Read-only.",
  get_outlinks: "List notes that the given note links OUT to. Read-only.",
  get_tags:
    "List the tags used in the given note (or all tags in the vault if no path is supplied). Read-only.",
  read_memory:
    "Read the assistant's persistent memory note (path set in settings). Use at the start of a turn to recall what you learned about this vault.",
  write_memory:
    "Overwrite the memory note. Use to durably record vault structure, naming conventions, recurring topics, MOC notes, user preferences.",
  append_memory:
    "Append a new entry to the memory note. Prefer over write_memory for incremental updates so prior facts are preserved.",
};

export { ToolError } from "./types";
export type { ToolContext, ToolDefinition, ToolSchema } from "./types";
