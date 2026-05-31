import path from "node:path";
import { promises as fs } from "node:fs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { readConfig, readJson, writeJson, pathExists } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { memoryRoot: null, repo: null, id: null, outcome: null, note: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory feedback --repo <repo> --id <memory-id> --outcome helpful|not-relevant|outdated|accepted|failed [--note <text>]");
      process.exit(0);
    } else if (token === "--memory-root") args.memoryRoot = argv[++i] ?? null;
    else if (token === "--repo") args.repo = argv[++i] ?? null;
    else if (token === "--id") args.id = argv[++i] ?? null;
    else if (token === "--outcome") args.outcome = argv[++i] ?? null;
    else if (token === "--note") args.note = argv[++i] ?? null;
  }
  if (!args.repo || !args.id || !args.outcome) throw new Error("--repo, --id and --outcome are required");
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot ? path.resolve(args.memoryRoot) : path.resolve(path.join(import.meta.dirname, ".."));
  const config = await readConfig(projectRoot);
  const { compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, args.repo);
  const logPath = path.join(compiledDir, "feedback-log.json");
  const log = (await pathExists(logPath)) ? await readJson(logPath) : { version: 1, feedback: [] };
  const event = { id: args.id, outcome: args.outcome, note: args.note, created_at: new Date().toISOString() };
  log.feedback.push(event);
  await writeJson(logPath, log);

  const impactPath = path.join(compiledDir, "outcome-impact.json");
  const counts = {};
  for (const item of log.feedback) counts[item.outcome] = (counts[item.outcome] ?? 0) + 1;
  await writeJson(impactPath, { version: 1, generated_at: new Date().toISOString(), counts, feedback_count: log.feedback.length });
  await fs.stat(logPath);
  console.log(JSON.stringify({ ok: true, repo: args.repo, feedback: event, counts }, null, 2));
} catch (error) {
  console.error(`[monkeys-memory] feedback failed: ${error.message}`);
  process.exit(1);
}
