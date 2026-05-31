import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { allCompiledItems, loadCompiledPack, loadReviewQueue, writeAnalysis } from "./lib/local-analysis.mjs";
import { readConfig } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { repo: null, format: "json", memoryRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory impact [--memory-root <dir>] [--repo <repo>] [--format json|table]");
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
    const reviewItems = await loadReviewQueue(projectRoot, config, repo);
    const sourceSupport = items.reduce((total, item) => total + (item.source_count ?? 0), 0);
    const crossUserItems = items.filter((item) => (item.provenance?.authors ?? []).length > 1).length;
    const highQualityItems = items.filter((item) => (item.quality_score ?? 0) >= 0.75).length;
    const stalePrevented = reviewItems.filter((item) => item.reason === "stale").length;
    const confirmedItems = items.filter((item) => item.lifecycle?.state === "confirmed").length;
    const sensitiveItems = items.filter((item) => item.policy?.sensitivity && item.policy.sensitivity !== "normal").length;
    const zeroEvidenceItems = items.filter((item) => (item.evidence_count ?? 0) === 0).length;
    const riskItems = reviewItems.length + sensitiveItems + zeroEvidenceItems;
    const reuseScore = sourceSupport + crossUserItems * 2 + highQualityItems + confirmedItems * 2;
    const governanceCost = reviewItems.length + sensitiveItems + zeroEvidenceItems;
    const report = {
      repo,
      memory_items: items.length,
      source_support: sourceSupport,
      cross_user_reuse_candidates: crossUserItems,
      high_quality_items: highQualityItems,
      confirmed_items: confirmedItems,
      review_items: reviewItems.length,
      sensitive_items: sensitiveItems,
      zero_evidence_items: zeroEvidenceItems,
      stale_memory_prevented: stalePrevented,
      risk_items: riskItems,
      reuse_score: reuseScore,
      governance_cost: governanceCost,
      estimated_reuse_value: reuseScore - governanceCost,
    };
    reports.push(report);
    await writeAnalysis(projectRoot, config, repo, "impact-report.json", {
      version: 1,
      generated_at: new Date().toISOString(),
      ...report,
    });
  }

  if (args.format === "table") {
    reports.forEach((report) => console.log(`${report.repo}: value=${report.estimated_reuse_value} items=${report.memory_items} review=${report.review_items}`));
  } else {
    console.log(JSON.stringify({ version: 1, generated_at: new Date().toISOString(), reports }, null, 2));
  }
} catch (error) {
  console.error(`[monkeys-memory] impact failed: ${error.message}`);
  process.exit(1);
}
