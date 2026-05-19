import { normalizePath } from "obsidian";

export class PathError extends Error {}

/**
 * Normalize a user-supplied path and ensure it stays inside the vault.
 * Rejects absolute paths, `..` traversal, and empty/whitespace-only input
 * (when `allowEmpty` is false).
 */
export function safePath(input: string, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof input !== "string") {
    throw new PathError("Path must be a string");
  }
  const trimmed = input.trim();
  if (!trimmed) {
    if (opts.allowEmpty) return "";
    throw new PathError("Path is empty");
  }

  if (trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new PathError(`Absolute paths are not allowed: ${input}`);
  }

  const normalized = normalizePath(trimmed);

  const parts = normalized.split("/");
  if (parts.some((p) => p === "..")) {
    throw new PathError(`Path traversal is not allowed: ${input}`);
  }

  return normalized;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
