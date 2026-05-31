import path from "node:path";
import { promises as fs } from "node:fs";
import { discoverCodeEntities, runGit } from "./local-analysis.mjs";
import { updateSkillsForAction } from "./skill-updates.mjs";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".monkeys-memory",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
]);

function normalizePath(value) {
  return String(value ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function splitLines(value) {
  return String(value ?? "")
    .split("\n")
    .map(normalizePath)
    .filter(Boolean);
}

async function listKnownPaths(workspaceRoot, options = {}) {
  const tracked = splitLines(await runGit(workspaceRoot, ["ls-files"]));
  if (tracked.length > 0) return tracked.slice(0, options.maxPaths ?? 5000).sort();

  const maxPaths = options.maxPaths ?? 5000;
  const paths = [];
  async function walk(dir) {
    if (paths.length >= maxPaths) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (paths.length >= maxPaths) return;
      if (DEFAULT_IGNORES.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        paths.push(normalizePath(path.relative(workspaceRoot, fullPath)));
      }
    }
  }
  await walk(workspaceRoot);
  return [...new Set(paths)].sort();
}

async function currentCommit(workspaceRoot) {
  return await runGit(workspaceRoot, ["rev-parse", "HEAD"]) || null;
}

async function currentBranch(workspaceRoot) {
  return await runGit(workspaceRoot, ["branch", "--show-current"]) || null;
}

async function changedPaths(workspaceRoot) {
  const outputs = await Promise.all([
    runGit(workspaceRoot, ["diff", "--name-only", "HEAD"]),
    runGit(workspaceRoot, ["diff", "--name-only", "--cached"]),
    runGit(workspaceRoot, ["ls-files", "--others", "--exclude-standard"]),
  ]);
  return [...new Set(outputs.flatMap(splitLines))].sort();
}

async function deletedPaths(workspaceRoot) {
  const outputs = await Promise.all([
    runGit(workspaceRoot, ["diff", "--name-only", "--diff-filter=D", "HEAD"]),
    runGit(workspaceRoot, ["diff", "--name-only", "--diff-filter=D", "--cached"]),
  ]);
  return [...new Set(outputs.flatMap(splitLines))].sort();
}

export async function scanRepositoryForAction(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? options.workspace ?? process.cwd());
  const known_paths = await listKnownPaths(workspaceRoot, { maxPaths: options.maxPaths });
  const [changed_paths, deleted_paths, code_entities, branch, commit] = await Promise.all([
    changedPaths(workspaceRoot),
    deletedPaths(workspaceRoot),
    discoverCodeEntities(workspaceRoot, { maxFiles: options.maxEntityFiles ?? 600 }),
    currentBranch(workspaceRoot),
    currentCommit(workspaceRoot),
  ]);

  return {
    schema_version: 1,
    scanned_at: new Date().toISOString(),
    branch,
    commit,
    known_paths,
    changed_paths,
    deleted_paths,
    renamed_paths: [],
    code_entities,
  };
}

export function hasAgentActions(response) {
  return Array.isArray(response?.agent_actions) && response.agent_actions.length > 0;
}

export async function reportAgentActionResult(action, result, options = {}) {
  if (action?.id?.startsWith("local-") && !options.endpoint && !process.env.MONKEYS_MEMORY_AGENT_ACTION_ENDPOINT) {
    return { id: action.id, status: "completed", local: true };
  }
  const endpoint = options.endpoint ?? process.env.MONKEYS_MEMORY_AGENT_ACTION_ENDPOINT;
  if (!endpoint) {
    throw new Error("MONKEYS_MEMORY_AGENT_ACTION_ENDPOINT is required to report non-local agent action results");
  }
  const token = options.token ?? process.env.MONKEYS_MEMORY_AGENT_ACTION_TOKEN;
  if (!token) throw new Error("MONKEYS_MEMORY_AGENT_ACTION_TOKEN is required to report non-local agent action results");

  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/api/v1/agent-actions/${encodeURIComponent(action.id)}/result`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "completed", result }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`agent action result failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function runAgentActions(actions, options = {}) {
  const results = [];
  for (const action of actions ?? []) {
    if (action?.type === "skill_update") {
      const result = await updateSkillsForAction(action, options);
      if (options.report === false) {
        results.push({ id: action.id, type: action.type, result, reported: false });
        continue;
      }
      const report = await reportAgentActionResult(action, result, options);
      results.push({ id: action.id, type: action.type, result, report, reported: true });
      continue;
    }
    if (action?.type !== "repo_scan") {
      results.push({ id: action?.id, type: action?.type, skipped: true, reason: "unsupported action type" });
      continue;
    }
    const scan = await scanRepositoryForAction(options);
    if (options.report === false) {
      results.push({ id: action.id, type: action.type, result: scan, reported: false });
      continue;
    }
    const report = await reportAgentActionResult(action, scan, options);
    results.push({ id: action.id, type: action.type, result: scan, report, reported: true });
  }
  return results;
}
