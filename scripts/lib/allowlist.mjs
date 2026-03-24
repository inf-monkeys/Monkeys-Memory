import path from "node:path";
import { readConfig, pathExists, readJson } from "./utils.mjs";

export async function getAllowlistPath(projectRoot) {
  const config = await readConfig(projectRoot);
  return path.join(projectRoot, config.memoryRoot, "org", "repo-allowlist.json");
}

export async function readRepoAllowlist(projectRoot) {
  const allowlistPath = await getAllowlistPath(projectRoot);
  if (!(await pathExists(allowlistPath))) {
    return {
      version: 1,
      repos: [],
    };
  }

  return readJson(allowlistPath);
}

export async function isRepoAllowed(projectRoot, repoName) {
  const allowlist = await readRepoAllowlist(projectRoot);
  return allowlist.repos.includes(repoName);
}

export async function getAllowedRepos(projectRoot) {
  const allowlist = await readRepoAllowlist(projectRoot);
  return allowlist.repos;
}
