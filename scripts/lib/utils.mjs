import { promises as fs } from "node:fs";
import path from "node:path";

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

export async function listJsonFiles(rootDir) {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listJsonFiles(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        return [entryPath];
      }
      return [];
    }),
  );

  return files.flat().sort();
}

export async function listDirectories(rootDir) {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name))
    .sort();
}

export function normalizeText(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "memory-item";
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function maxIsoDate(values) {
  return values.filter(Boolean).sort().at(-1) ?? new Date(0).toISOString();
}

export function confidenceBucket(score) {
  if (score >= 0.8) {
    return "high";
  }
  if (score >= 0.6) {
    return "medium";
  }
  return "low";
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function globToRegExp(pattern) {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      regex += ".*";
      i += 2;
      if (pattern[i] === "/") i += 1;
    } else if (ch === "*") {
      regex += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      regex += "[^/]";
      i += 1;
    } else if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        regex += "\\[";
        i += 1;
      } else {
        regex += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else if ("|\\{}()^$+.".includes(ch)) {
      regex += `\\${ch}`;
      i += 1;
    } else {
      regex += ch;
      i += 1;
    }
  }
  return new RegExp(`^${regex}$`);
}

export function matchGlob(pattern, targetPath) {
  return globToRegExp(pattern).test(targetPath);
}

export function specificity(pattern) {
  let score = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") i += 1;
      continue;
    }
    if (ch === "?") {
      score += 0.5;
    } else if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close !== -1) {
        score += 0.5;
        i = close;
      } else {
        score += 1;
      }
    } else {
      score += 1;
    }
  }
  return score;
}

const TASK_TYPE_ALIASES = {
  "bugfix": "bugfix", "bug-fix": "bugfix", "bug_fix": "bugfix", "bugFix": "bugfix", "fix": "bugfix",
  "hotfix": "hotfix", "hot-fix": "hotfix", "hot_fix": "hotfix", "hotFix": "hotfix",
  "refactor": "refactor", "re-factor": "refactor", "refactoring": "refactor",
  "feature": "feature", "feat": "feature",
  "review": "review", "code-review": "review", "code_review": "review", "codeReview": "review",
};

export function normalizeTaskType(value) {
  if (!value) return "";
  const lower = value.trim().toLowerCase();
  return TASK_TYPE_ALIASES[lower] ?? lower.replace(/[-_\s]+/g, "");
}

const EVIDENCE_TYPE_ALIASES = {
  "mr": "mr", "merge-request": "mr", "merge_request": "mr",
  "pr": "pr", "pull-request": "pr", "pull_request": "pr",
  "doc": "doc", "document": "doc", "docs": "doc",
  "incident": "incident", "inc": "incident",
  "commit": "commit", "sha": "commit",
};

export function normalizeEvidenceType(value) {
  if (!value) return "";
  const lower = value.trim().toLowerCase();
  return EVIDENCE_TYPE_ALIASES[lower] ?? lower;
}

export function formatError(context, error) {
  const msg = error instanceof Error ? error.message : String(error);
  return `[monkeys-memory] ${context}: ${msg}`;
}

const _configCache = new Map();

export function clearConfigCache() {
  _configCache.clear();
}

export async function readConfig(projectRoot) {
  if (_configCache.has(projectRoot)) {
    return _configCache.get(projectRoot);
  }

  const configPath = path.join(projectRoot, "memory.config.json");
  let config;
  if (!(await pathExists(configPath))) {
    config = {
      org: "unknown-org",
      memoryRoot: ".monkeys-memory",
      onboardingRuleLimit: 10,
      runtimeRuleLimit: 5,
    };
  } else {
    config = await readJson(configPath);
  }

  _configCache.set(projectRoot, config);
  return config;
}
