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
  } catch {
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
    if (filePath === "memory.config.json" || filePath.startsWith(".monkeys-memory/org/")) {
      for (const repoName of allowedRepos) {
        affectedRepos.add(repoName);
      }
      continue;
    }

    const match = filePath.match(/^\.monkeys-memory\/repos\/([^/]+)\/experiences\//);
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

  const results = await Promise.all(
    affectedRepos.map((repoName) => compileRepo(projectRoot, repoName)),
  );
  summaries.push(...results);

  return {
    pulled: !options.noPull,
    beforeRef,
    afterRef,
    changedFiles,
    affectedRepos,
    summaries,
  };
}
