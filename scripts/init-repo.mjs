import path from "node:path";
import { promises as fs } from "node:fs";
import { addRepoToAllowlist } from "./lib/allowlist.mjs";
import { compileRepo } from "./lib/compiler.mjs";
import { resolveRepoContext } from "./lib/context.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { pathExists, readConfig } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = {
    workspace: null,
    noHooks: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory init-repo --workspace <path> [--no-hooks]");
      console.log("");
      console.log("Sets up a target repo for monkeys-memory:");
      console.log("  - Adds repo to allowlist if not already present");
      console.log("  - Installs post-commit hook for auto-capture");
      console.log("  - Runs initial compile");
      console.log("");
      console.log("Skills (org-memory-use, org-memory-capture) are installed globally");
      console.log("by install.sh and shared by both Claude Code and Codex.");
      process.exit(0);
    } else if (token === "--workspace") {
      args.workspace = argv[i + 1] ?? null;
      i += 1;
    } else if (token === "--no-hooks") {
      args.noHooks = true;
    }
  }

  if (!args.workspace) {
    console.error("[monkeys-memory] --workspace is required");
    process.exit(1);
  }

  return args;
}

async function installPostCommitHook(workspace) {
  const hooksDir = path.join(workspace, ".git", "hooks");
  if (!(await pathExists(hooksDir))) {
    console.log("  - skipped post-commit hook: not a git repository");
    return false;
  }

  const hookPath = path.join(hooksDir, "post-commit");
  const templatePath = path.join(import.meta.dirname, "..", "templates", "post-commit-hook.sh");
  const template = await fs.readFile(templatePath, "utf8");

  if (await pathExists(hookPath)) {
    const existing = await fs.readFile(hookPath, "utf8");
    if (existing.includes("monkeys-memory")) {
      console.log("  - post-commit hook already contains monkeys-memory");
      return true;
    }
    await fs.writeFile(hookPath, existing.trimEnd() + "\n\n" + template, "utf8");
    console.log("  - appended monkeys-memory to existing post-commit hook");
  } else {
    await fs.writeFile(hookPath, template, "utf8");
    await fs.chmod(hookPath, 0o755);
    console.log("  - installed post-commit hook");
  }
  return true;
}

try {
  const memoryRoot = path.resolve(path.join(import.meta.dirname, ".."));
  const args = parseArgs(process.argv.slice(2));
  const workspace = path.resolve(args.workspace);

  if (!(await pathExists(workspace))) {
    console.error(`[monkeys-memory] workspace not found: ${workspace}`);
    process.exit(1);
  }

  const context = await resolveRepoContext({ workspace });
  const repoName = context.repo;
  const config = await readConfig(memoryRoot);

  console.log(`Initializing monkeys-memory for: ${repoName} (${workspace})`);
  console.log("");

  // 1. Add to allowlist
  const added = await addRepoToAllowlist(memoryRoot, repoName);
  if (added) {
    console.log(`  - added "${repoName}" to allowlist`);
  } else {
    console.log(`  - "${repoName}" already in allowlist`);
  }

  // 2. Initialize memory directories
  await ensureRepoInitialized(memoryRoot, config.memoryRoot, repoName);
  console.log("  - initialized memory directories");

  // 3. Install post-commit hook
  if (!args.noHooks) {
    await installPostCommitHook(workspace);
  } else {
    console.log("  - skipped hooks (--no-hooks)");
  }

  // 4. Run initial compile
  const summary = await compileRepo(memoryRoot, repoName);
  console.log(`  - compiled: ${summary.ruleCount} rules, ${summary.exceptionCount} exceptions, ${summary.sourceExperienceCount} experiences`);

  console.log("");
  console.log("Done. This repo is now set up for monkeys-memory.");
  console.log("");
  console.log("What happens next:");
  console.log("  - Every commit auto-captures experience (post-commit hook)");
  console.log("  - Skills (org-memory-use / org-memory-capture) handle retrieve and capture");
  console.log("  - Both Claude Code and Codex use the same skills automatically");
  console.log("  - Run 'monkeys-memory status' to check the state");
  console.log("  - Run 'monkeys-memory list --repo " + repoName + "' to see captured experiences");
} catch (error) {
  console.error(`[monkeys-memory] init-repo failed: ${error.message}`);
  process.exit(1);
}
