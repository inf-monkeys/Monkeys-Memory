import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(workspace, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: workspace,
      encoding: "utf8",
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function detectWorkspaceRoot(startDir) {
  const topLevel = await runGit(startDir, ["rev-parse", "--show-toplevel"]);
  return topLevel || path.resolve(startDir);
}

export async function detectRepoName(startDir) {
  const workspaceRoot = await detectWorkspaceRoot(startDir);
  return path.basename(workspaceRoot);
}

export async function detectRelevantPath(startDir) {
  const workspaceRoot = await detectWorkspaceRoot(startDir);
  const candidates = [
    await runGit(workspaceRoot, ["diff", "--name-only", "--cached"]),
    await runGit(workspaceRoot, ["diff", "--name-only", "HEAD"]),
    await runGit(workspaceRoot, ["diff", "--name-only"]),
  ]
    .flatMap((output) => output.split("\n"))
    .map((item) => item.trim())
    .filter(Boolean);

  return candidates[0] ?? null;
}

export async function resolveRepoContext(options = {}) {
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const workspaceRoot = await detectWorkspaceRoot(workspace);
  const repo = options.repo ?? (await detectRepoName(workspaceRoot));
  const relativePath = options.path
    ? path.isAbsolute(options.path)
      ? path.relative(workspaceRoot, options.path)
      : options.path
    : await detectRelevantPath(workspaceRoot);

  return {
    workspace,
    workspaceRoot,
    repo,
    path: relativePath,
    task: options.task ?? null,
    branch: options.branch ?? null,
    tag: options.tag ?? null,
    commit: options.commit ?? null,
    userId: options.userId ?? null,
    teamId: options.teamId ?? null,
    templateId: options.templateId ?? null,
    includeSensitive: options.includeSensitive ?? false,
  };
}
