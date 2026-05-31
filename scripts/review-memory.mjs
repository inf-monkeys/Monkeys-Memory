import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { compileRepo } from "./lib/compiler.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { getRepoCompiledStatus } from "./lib/staleness.mjs";
import { padLeft, padRight, pathExists, readConfig, readJson } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { repo: null, format: "table", memoryRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory review [--repo <repo>] [--memory-root <dir>] [--format table|json]");
      process.exit(0);
    } else if (token === "--repo") {
      args.repo = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--format") {
      args.format = argv[index + 1] ?? "table";
      index += 1;
    } else if (token === "--memory-root") {
      args.memoryRoot = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return args;
}

async function loadReviewQueue(projectRoot, config, repoName) {
  const { compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repoName);
  const queuePath = path.join(compiledDir, "review-queue.json");
  const status = await getRepoCompiledStatus(projectRoot, repoName);
  if (!(await pathExists(queuePath)) || status.stale) {
    await compileRepo(projectRoot, repoName);
  }
  if (!(await pathExists(queuePath))) {
    return [];
  }
  const queue = await readJson(queuePath);
  return (queue.items ?? []).map((item) => ({ ...item, repo: repoName }));
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot
    ? path.resolve(args.memoryRoot)
    : path.resolve(path.join(import.meta.dirname, ".."));
  const config = await readConfig(projectRoot);
  const allowedRepos = await getAllowedRepos(projectRoot);
  const repos = args.repo ? allowedRepos.filter((repoName) => repoName === args.repo) : allowedRepos;

  if (args.repo && !allowedRepos.includes(args.repo)) {
    console.error(`[monkeys-memory] repo "${args.repo}" is not in the allowlist`);
    process.exit(1);
  }

  const items = (await Promise.all(repos.map((repoName) => loadReviewQueue(projectRoot, config, repoName)))).flat();

  if (args.format === "json") {
    console.log(JSON.stringify({ version: 1, org: config.org, generated_at: new Date().toISOString(), items }, null, 2));
  } else if (items.length === 0) {
    console.log("No memory review items.");
  } else {
    const header = [
      padRight("Repo", 20),
      padRight("Priority", 10),
      padRight("Reason", 32),
      padLeft("Memory", 24),
    ].join("");
    console.log(header);
    console.log("-".repeat(header.length));
    for (const item of items) {
      console.log([
        padRight(item.repo, 20),
        padRight(item.priority, 10),
        padRight(item.reason, 32),
        padLeft(item.id, 24),
      ].join(""));
      console.log(`  ${item.claim}`);
    }
  }
} catch (error) {
  console.error(`[monkeys-memory] review failed: ${error.message}`);
  process.exit(1);
}
