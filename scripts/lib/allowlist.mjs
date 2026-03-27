import path from "node:path";
import { readConfig, pathExists, readJson } from "./utils.mjs";

export async function getAllowlistPath(projectRoot) {
  const config = await readConfig(projectRoot);
  return path.join(projectRoot, config.memoryRoot, "org", "repo-allowlist.json");
}

const _allowlistCache = new Map();

export function clearAllowlistCache() {
  _allowlistCache.clear();
}

export async function readRepoAllowlist(projectRoot) {
  if (_allowlistCache.has(projectRoot)) {
    return _allowlistCache.get(projectRoot);
  }

  const allowlistPath = await getAllowlistPath(projectRoot);
  let allowlist;
  if (!(await pathExists(allowlistPath))) {
    allowlist = {
      version: 1,
      repos: [],
    };
  } else {
    allowlist = await readJson(allowlistPath);
  }

  _allowlistCache.set(projectRoot, allowlist);
  return allowlist;
}

export async function isRepoAllowed(projectRoot, repoName) {
  const allowlist = await readRepoAllowlist(projectRoot);
  return allowlist.repos.includes(repoName);
}

export async function getAllowedRepos(projectRoot) {
  const allowlist = await readRepoAllowlist(projectRoot);
  return allowlist.repos;
}
