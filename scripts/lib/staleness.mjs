import path from "node:path";
import { promises as fs } from "node:fs";
import { ensureRepoInitialized, getRepoPaths } from "./repo-init.mjs";
import { listJsonFiles, pathExists, readConfig } from "./utils.mjs";

async function getMtimeMs(filePath) {
  const stat = await fs.stat(filePath);
  return stat.mtimeMs;
}

async function getExistingMtimes(filePaths) {
  const existing = [];

  for (const filePath of filePaths) {
    if (await pathExists(filePath)) {
      existing.push(await getMtimeMs(filePath));
    }
  }

  return existing;
}

export async function getRepoCompiledStatus(projectRoot, repoName) {
  const config = await readConfig(projectRoot);
  const {
    experiencesDir,
    compiledDir,
  } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repoName);

  const compiledOutputs = [
    path.join(compiledDir, "rules.json"),
    path.join(compiledDir, "rules.yaml"),
    path.join(compiledDir, "onboarding.md"),
    path.join(compiledDir, "path-index.json"),
  ];

  const missingOutputs = [];
  for (const outputPath of compiledOutputs) {
    if (!(await pathExists(outputPath))) {
      missingOutputs.push(outputPath);
    }
  }

  if (missingOutputs.length > 0) {
    return {
      stale: true,
      reason: "missing compiled outputs",
      missingOutputs,
    };
  }

  const dependencyFiles = [
    ...(await listJsonFiles(experiencesDir)),
    path.join(projectRoot, "memory.config.json"),
    path.join(projectRoot, config.memoryRoot, "org", "repo-allowlist.json"),
  ];
  const dependencyMtimes = await getExistingMtimes(dependencyFiles);
  const compiledMtimes = await getExistingMtimes(compiledOutputs);
  const newestDependencyMtime = dependencyMtimes.length > 0 ? Math.max(...dependencyMtimes) : 0;
  const oldestCompiledMtime = compiledMtimes.length > 0 ? Math.min(...compiledMtimes) : 0;

  return {
    stale: newestDependencyMtime > oldestCompiledMtime,
    reason: newestDependencyMtime > oldestCompiledMtime ? "compiled memory older than dependencies" : "up-to-date",
    missingOutputs: [],
  };
}
