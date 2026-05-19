import { TFile } from "obsidian";
import { spawn } from "child_process";
import { ToolDefinition, ToolError, optionalBool, requireString } from "./types";

const MAX_MATCHES = 50;

interface Match {
  path: string;
  line_number: number;
  line_content: string;
}

async function jsSearch(
  app: import("obsidian").App,
  query: string,
  regex: boolean,
): Promise<Match[]> {
  const matches: Match[] = [];
  let pattern: RegExp;
  try {
    pattern = regex
      ? new RegExp(query, "m")
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch (e) {
    throw new ToolError(`Invalid regex: ${(e as Error).message}`);
  }

  const files = app.vault.getMarkdownFiles();
  for (const f of files) {
    if (matches.length >= MAX_MATCHES) break;
    const content = await app.vault.cachedRead(f);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        matches.push({
          path: f.path,
          line_number: i + 1,
          line_content: lines[i].slice(0, 300),
        });
        if (matches.length >= MAX_MATCHES) break;
      }
    }
  }
  return matches;
}

async function ripgrepSearch(
  rgPath: string,
  vaultPath: string,
  query: string,
  regex: boolean,
): Promise<Match[]> {
  return new Promise((resolve, reject) => {
    const args = [
      "--json",
      "--max-count",
      String(MAX_MATCHES),
      "--type",
      "md",
    ];
    if (!regex) args.push("--fixed-strings");
    args.push(query, vaultPath);

    const proc = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("error", (e) => reject(new ToolError(`ripgrep failed: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        return reject(new ToolError(`ripgrep exit ${code}: ${stderr.slice(0, 500)}`));
      }
      const matches: Match[] = [];
      for (const line of stdout.split("\n")) {
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "match" && matches.length < MAX_MATCHES) {
            const data = evt.data;
            const fullPath: string = data.path?.text ?? "";
            const rel = fullPath.startsWith(vaultPath)
              ? fullPath.slice(vaultPath.length).replace(/^[\\/]/, "")
              : fullPath;
            matches.push({
              path: rel,
              line_number: data.line_number,
              line_content: (data.lines?.text ?? "").replace(/\n$/, "").slice(0, 300),
            });
          }
        } catch {
          // skip malformed json line
        }
      }
      resolve(matches);
    });
  });
}

export const search: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "search",
      description:
        "Search markdown content across the vault. Returns up to 50 matches as {path, line_number, line_content}.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (substring by default)." },
          regex: { type: "boolean", description: "Treat query as a regular expression." },
        },
        required: ["query"],
      },
    },
  },

  async execute(args, { app, settings }) {
    const query = requireString(args, "query");
    const regex = optionalBool(args, "regex", false);
    if (!query) throw new ToolError("Query is empty");

    let matches: Match[] = [];

    const rg = settings.ripgrepPath?.trim();
    if (rg) {
      const adapter = app.vault.adapter as unknown as { getBasePath?: () => string };
      const basePath = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
      if (basePath) {
        try {
          matches = await ripgrepSearch(rg, basePath, query, regex);
        } catch (e) {
          matches = await jsSearch(app, query, regex);
        }
      } else {
        matches = await jsSearch(app, query, regex);
      }
    } else {
      matches = await jsSearch(app, query, regex);
    }

    // Filter to existing markdown files (ripgrep may return paths outside the cache view).
    const valid = matches.filter((m) => {
      const f = app.vault.getAbstractFileByPath(m.path);
      return f instanceof TFile;
    });

    return JSON.stringify(
      {
        count: valid.length,
        truncated: valid.length >= MAX_MATCHES,
        matches: valid,
      },
      null,
      2,
    );
  },
};
