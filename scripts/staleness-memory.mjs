import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { allCompiledItems, loadCompiledPack, runGit, scopedItemsForPath, writeAnalysis } from "./lib/local-analysis.mjs";
import { padRight, readConfig } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { repo: null, workspace: process.cwd(), since: "HEAD~20", format: "table", memoryRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory staleness [--memory-root <dir>] [--repo <repo>] [--workspace <repo-dir>] [--since <git-ref>] [--format table|json]");
      process.exit(0);
    } else if (token === "--repo") { args.repo = argv[++i] ?? null; }
    else if (token === "--workspace") { args.workspace = argv[++i] ?? args.workspace; }
    else if (token === "--since") { args.since = argv[++i] ?? args.since; }
    else if (token === "--format") { args.format = argv[++i] ?? "table"; }
    else if (token === "--memory-root") { args.memoryRoot = argv[++i] ?? null; }
  }
  return args;
}

function scoreRisk(item, changedFiles) {
  const matched = changedFiles.filter((changedPath) => scopedItemsForPath([item], changedPath.replace(/^[A-Z]\t/, "")).length > 0);
  const deleted = matched.filter((file) => file.startsWith("D\t")).length;
  const risk = matched.length === 0 ? "low" : deleted > 0 || matched.length >= 3 ? "high" : "medium";
  return { risk, matched_paths: matched.map((file) => file.replace(/^[A-Z]\t/, "")) };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot ? path.resolve(args.memoryRoot) : path.resolve(path.join(import.meta.dirname, ".."));
  const config = await readConfig(projectRoot);
  const allowedRepos = await getAllowedRepos(projectRoot);
  const repos = args.repo ? allowedRepos.filter((repo) => repo === args.repo) : allowedRepos;
  const diffOutput = await runGit(path.resolve(args.workspace), ["diff", "--name-status", args.since, "HEAD"]);
  const changedFiles = diffOutput.split("\n").map((line) => line.trim()).filter(Boolean);
  const items = [];

  for (const repo of repos) {
    const pack = await loadCompiledPack(projectRoot, config, repo);
    for (const item of allCompiledItems(pack)) {
      const result = scoreRisk(item, changedFiles);
      if (result.risk !== "low") items.push({ repo, id: item.id, claim: item.claim, ...result });
    }
    await writeAnalysis(projectRoot, config, repo, "staleness-report.json", {
      version: 1,
      generated_at: new Date().toISOString(),
      since: args.since,
      changed_files: changedFiles,
      items: items.filter((item) => item.repo === repo),
    });
  }

  if (args.format === "json") {
    console.log(JSON.stringify({ version: 1, generated_at: new Date().toISOString(), items }, null, 2));
  } else if (items.length === 0) {
    console.log("No code-aware staleness risks found.");
  } else {
    console.log([padRight("Repo", 20), padRight("Risk", 8), padRight("Memory", 28), "Claim"].join(""));
    for (const item of items) {
      console.log([padRight(item.repo, 20), padRight(item.risk, 8), padRight(item.id.slice(0, 26), 28), item.claim].join(""));
    }
  }
} catch (error) {
  console.error(`[monkeys-memory] staleness failed: ${error.message}`);
  process.exit(1);
}
