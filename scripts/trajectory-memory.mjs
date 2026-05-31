import path from "node:path";
import { promises as fs } from "node:fs";
import { addRepoToAllowlist } from "./lib/allowlist.mjs";
import { summarizeTrajectory } from "./lib/local-analysis.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { readConfig, slugify, writeJson } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { memoryRoot: null, repo: null, file: null, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory trajectory --repo <repo> --file <events.json> [--write]");
      process.exit(0);
    } else if (token === "--memory-root") args.memoryRoot = argv[++i] ?? null;
    else if (token === "--repo") args.repo = argv[++i] ?? null;
    else if (token === "--file") args.file = argv[++i] ?? null;
    else if (token === "--write") args.write = true;
  }
  if (!args.repo || !args.file) throw new Error("--repo and --file are required");
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot ? path.resolve(args.memoryRoot) : path.resolve(path.join(import.meta.dirname, ".."));
  const config = await readConfig(projectRoot);
  await addRepoToAllowlist(projectRoot, args.repo);
  const events = JSON.parse(await fs.readFile(path.resolve(args.file), "utf8"));
  const summary = summarizeTrajectory(Array.isArray(events) ? events : events.events ?? []);
  const claim = summary.failed_tests > 0 && summary.passed_tests > 0
    ? `After failures, rerun the passing test workflow for ${summary.files_edited[0] ?? "the edited area"}.`
    : `Trajectory touched ${summary.files_edited[0] ?? summary.files_read[0] ?? "the repository"}; preserve this workflow context.`;
  const candidate = {
    id: `traj_${Date.now()}_${slugify(claim).slice(0, 32)}`,
    org: config.org,
    repo: args.repo,
    kind: "note",
    title: claim.slice(0, 80),
    claim,
    scope: { paths: summary.files_edited.length ? summary.files_edited : ["**"], task_types: [] },
    source: { author: "agent-trajectory", session: `trajectory-${Date.now()}` },
    provenance: { source_type: "agent_trajectory", imported_from: path.resolve(args.file), evidence_refs: [path.basename(args.file)] },
    confidence: summary.passed_tests > 0 ? 0.62 : 0.45,
    evidence: [{ type: "trajectory", ref: path.basename(args.file) }],
    lifecycle: { state: "candidate", updated_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  };
  if (args.write) {
    const { experiencesDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, args.repo);
    await writeJson(path.join(experiencesDir, `${candidate.id}.json`), candidate);
  }
  console.log(JSON.stringify({ ok: true, write: args.write, summary, candidate }, null, 2));
} catch (error) {
  console.error(`[monkeys-memory] trajectory failed: ${error.message}`);
  process.exit(1);
}
