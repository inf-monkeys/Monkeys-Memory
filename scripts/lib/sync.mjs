import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compileRepo } from "./compiler.mjs";
import { getAllowedRepos } from "./allowlist.mjs";

const execFileAsync = promisify(execFile);

async function runGit(projectRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function maybeRunGit(projectRoot, args) {
  try {
    return await runGit(projectRoot, args);
  } catch (error) {
    console.error(`[monkeys-memory] git ${args[0]} failed: ${error.message}`);
    return "";
  }
}

export async function getChangedFiles(projectRoot, fromRef, toRef) {
  if (!fromRef || !toRef || fromRef === toRef) {
    return [];
  }

  const output = await maybeRunGit(projectRoot, ["diff", "--name-only", fromRef, toRef]);
  return output
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function detectAffectedRepos(projectRoot, changedFiles) {
  const allowedRepos = await getAllowedRepos(projectRoot);
  const affectedRepos = new Set();

  for (const filePath of changedFiles) {
    const normalized = filePath.split(path.sep).join("/");
    if (normalized === "memory.config.json" || normalized.startsWith(".monkeys-memory/org/")) {
      for (const repoName of allowedRepos) {
        affectedRepos.add(repoName);
      }
      continue;
    }

    const match = normalized.match(/^\.monkeys-memory\/repos\/([^/]+)\/experiences\//);
    if (match && allowedRepos.includes(match[1])) {
      affectedRepos.add(match[1]);
    }
  }

  return [...affectedRepos].sort();
}

export async function syncProject(projectRoot, options = {}) {
  const beforeRef = options.fromRef ?? (await maybeRunGit(projectRoot, ["rev-parse", "HEAD"]));

  if (!options.noPull) {
    await execFileAsync("git", ["pull", "--ff-only"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
  }

  const afterRef = options.toRef ?? (await maybeRunGit(projectRoot, ["rev-parse", "HEAD"]));
  const changedFiles = options.changedFiles ?? (await getChangedFiles(projectRoot, beforeRef, afterRef));
  const affectedRepos = await detectAffectedRepos(projectRoot, changedFiles);
  const summaries = [];

  const results = await Promise.allSettled(
    affectedRepos.map((repoName) => compileRepo(projectRoot, repoName)),
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      summaries.push(result.value);
    } else {
      console.error(`[monkeys-memory] sync compile failed: ${result.reason?.message ?? result.reason}`);
    }
  }

  return {
    pulled: !options.noPull,
    beforeRef,
    afterRef,
    changedFiles,
    affectedRepos,
    summaries,
  };
}
