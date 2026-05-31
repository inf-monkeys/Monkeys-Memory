import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { allCompiledItems, loadCompiledPack, writeAnalysis } from "./lib/local-analysis.mjs";
import { readConfig } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { memoryRoot: null, format: "json" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory hierarchy [--memory-root <dir>] [--format json|table]");
      process.exit(0);
    } else if (token === "--memory-root") args.memoryRoot = argv[++i] ?? null;
    else if (token === "--format") args.format = argv[++i] ?? "json";
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot ? path.resolve(args.memoryRoot) : path.resolve(path.join(import.meta.dirname, ".."));
  const config = await readConfig(projectRoot);
  const repos = await getAllowedRepos(projectRoot);
  const hierarchy = { org: config.org, layers: { org: [], repo: {}, team: {}, user: {}, global: [] } };
  for (const repo of repos) {
    const pack = await loadCompiledPack(projectRoot, config, repo);
    hierarchy.layers.repo[repo] = allCompiledItems(pack).map((item) => item.id);
    for (const item of allCompiledItems(pack)) {
      const visibility = item.policy?.visibility ?? "repo";
      if (visibility === "org") hierarchy.layers.org.push(item.id);
      if (visibility === "global") hierarchy.layers.global.push(item.id);
      const authors = item.provenance?.authors ?? [];
      for (const author of authors) {
        hierarchy.layers.user[author] ??= [];
        hierarchy.layers.user[author].push(item.id);
      }
    }
    await writeAnalysis(projectRoot, config, repo, "hierarchy-report.json", {
      version: 1,
      generated_at: new Date().toISOString(),
      repo,
      repo_items: hierarchy.layers.repo[repo],
    });
  }
  if (args.format === "table") {
    console.log(`org ${hierarchy.org}: ${repos.length} repos`);
    repos.forEach((repo) => console.log(`${repo}: ${hierarchy.layers.repo[repo].length} items`));
  } else {
    console.log(JSON.stringify({ version: 1, generated_at: new Date().toISOString(), hierarchy }, null, 2));
  }
} catch (error) {
  console.error(`[monkeys-memory] hierarchy failed: ${error.message}`);
  process.exit(1);
}
