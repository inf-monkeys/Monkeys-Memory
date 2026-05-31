import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { allCompiledItems, loadCompiledPack, writeAnalysis } from "./lib/local-analysis.mjs";
import { readConfig } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { repo: null, format: "json", memoryRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory coverage [--memory-root <dir>] [--repo <repo>] [--format json|table]");
      process.exit(0);
    } else if (token === "--repo") { args.repo = argv[++i] ?? null; }
    else if (token === "--format") { args.format = argv[++i] ?? "json"; }
    else if (token === "--memory-root") { args.memoryRoot = argv[++i] ?? null; }
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot ? path.resolve(args.memoryRoot) : path.resolve(path.join(import.meta.dirname, ".."));
  const config = await readConfig(projectRoot);
  const allowedRepos = await getAllowedRepos(projectRoot);
  const repos = args.repo ? allowedRepos.filter((repo) => repo === args.repo) : allowedRepos;
  const reports = [];

  for (const repo of repos) {
    const pack = await loadCompiledPack(projectRoot, config, repo);
    const items = allCompiledItems(pack);
    const reviewItems = pack.review_queue?.items ?? [];
    const byPath = {};
    const byTask = {};
    const byEntity = {};
    for (const item of items) {
      for (const scopePath of item.scope.paths ?? ["**"]) byPath[scopePath] = (byPath[scopePath] ?? 0) + 1;
      for (const task of item.scope.task_types ?? ["all"]) byTask[task || "all"] = (byTask[task || "all"] ?? 0) + 1;
      for (const entity of item.scope.entities ?? []) byEntity[entity] = (byEntity[entity] ?? 0) + 1;
    }
    const avgQuality = items.length > 0
      ? items.reduce((sum, item) => sum + (item.quality_score ?? 0.7), 0) / items.length
      : 0;
    const sensitiveCount = items.filter((item) => item.policy?.sensitivity && item.policy.sensitivity !== "normal").length;
    const staleOrContestedCount = items.filter((item) => ["stale", "contested"].includes(item.lifecycle?.state)).length;
    const thinPaths = Object.entries(byPath)
      .filter(([, count]) => count <= 1)
      .map(([scopePath, count]) => ({ path: scopePath, count }))
      .sort((left, right) => left.count - right.count || left.path.localeCompare(right.path))
      .slice(0, 8);
    const coverageScore = Math.max(0, Math.min(100, Math.round(
      (avgQuality * 55) +
      (Math.min(Object.keys(byEntity).length, 12) / 12 * 20) +
      (Math.min(Object.keys(byTask).length, 6) / 6 * 15) -
      (Math.min(reviewItems.length, 8) / 8 * 18) -
      (Math.min(staleOrContestedCount, 6) / 6 * 12),
    )));
    const report = {
      repo,
      item_count: items.length,
      rule_count: pack.rules?.length ?? 0,
      exception_count: pack.exceptions?.length ?? 0,
      procedure_count: pack.procedures?.length ?? 0,
      path_count: Object.keys(byPath).length,
      task_count: Object.keys(byTask).length,
      entity_count: Object.keys(byEntity).length,
      review_item_count: reviewItems.length,
      stale_or_contested_count: staleOrContestedCount,
      sensitive_count: sensitiveCount,
      avg_quality_score: Number(avgQuality.toFixed(2)),
      coverage_score: coverageScore,
      thin_paths: thinPaths,
      by_path: byPath,
      by_task: byTask,
      by_entity: byEntity,
    };
    reports.push(report);
    await writeAnalysis(projectRoot, config, repo, "coverage-report.json", {
      version: 1,
      generated_at: new Date().toISOString(),
      ...report,
    });
  }

  if (args.format === "table") {
    reports.forEach((report) => console.log(`${report.repo}: ${report.item_count} items, ${report.path_count} paths, ${report.task_count} tasks, ${report.entity_count} entities`));
  } else {
    console.log(JSON.stringify({ version: 1, generated_at: new Date().toISOString(), reports }, null, 2));
  }
} catch (error) {
  console.error(`[monkeys-memory] coverage failed: ${error.message}`);
  process.exit(1);
}
