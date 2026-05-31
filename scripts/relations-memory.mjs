import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { allCompiledItems, classifySemanticRelation, loadCompiledPack, writeAnalysis } from "./lib/local-analysis.mjs";
import { readConfig } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { repo: null, memoryRoot: null, format: "json" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory relations [--memory-root <dir>] [--repo <repo>] [--format json|table]");
      process.exit(0);
    } else if (token === "--repo") args.repo = argv[++i] ?? null;
    else if (token === "--memory-root") args.memoryRoot = argv[++i] ?? null;
    else if (token === "--format") args.format = argv[++i] ?? "json";
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot ? path.resolve(args.memoryRoot) : path.resolve(path.join(import.meta.dirname, ".."));
  const config = await readConfig(projectRoot);
  const repos = args.repo ? [args.repo] : await getAllowedRepos(projectRoot);
  const relations = [];
  for (const repo of repos) {
    const pack = await loadCompiledPack(projectRoot, config, repo);
    const items = allCompiledItems(pack);
    const repoRelations = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const result = classifySemanticRelation(items[i], items[j]);
        if (result.relation === "unrelated") continue;
        repoRelations.push({ repo, from: items[i].id, to: items[j].id, ...result });
      }
    }
    relations.push(...repoRelations);
    await writeAnalysis(projectRoot, config, repo, "semantic-relations.json", {
      version: 1,
      generated_at: new Date().toISOString(),
      relations: repoRelations,
    });
  }
  if (args.format === "table") relations.forEach((r) => console.log(`${r.repo} ${r.from} ${r.relation} ${r.to} ${r.confidence}`));
  else console.log(JSON.stringify({ version: 1, generated_at: new Date().toISOString(), relations }, null, 2));
} catch (error) {
  console.error(`[monkeys-memory] relations failed: ${error.message}`);
  process.exit(1);
}
