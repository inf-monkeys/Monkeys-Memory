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
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  const regex = escaped.replaceAll("**", "___DOUBLE_STAR___").replaceAll("*", "[^/]*").replaceAll("___DOUBLE_STAR___", ".*");
  return new RegExp(`^${regex}$`);
}

export function matchGlob(pattern, targetPath) {
  return globToRegExp(pattern).test(targetPath);
}

export function specificity(pattern) {
  return pattern.replace(/\*/g, "").length;
}

export async function readConfig(projectRoot) {
  const configPath = path.join(projectRoot, "memory.config.json");
  if (!(await pathExists(configPath))) {
    return {
      org: "unknown-org",
      memoryRoot: ".monkeys-memory",
      onboardingRuleLimit: 10,
      runtimeRuleLimit: 5,
    };
  }

  return readJson(configPath);
}
