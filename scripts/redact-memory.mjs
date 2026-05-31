import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { detectSensitiveText } from "./lib/local-analysis.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { listJsonFiles, readConfig, readJson, writeJson } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { repo: null, write: false, format: "json", memoryRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory redact [--memory-root <dir>] [--repo <repo>] [--write] [--format json|table]");
      process.exit(0);
    } else if (token === "--repo") { args.repo = argv[++i] ?? null; }
    else if (token === "--write") { args.write = true; }
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
  const findings = [];

  for (const repo of repos) {
    const { experiencesDir, compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repo);
    const files = await listJsonFiles(experiencesDir);
    for (const filePath of files) {
      const experience = await readJson(filePath);
      const sensitive = detectSensitiveText(experience);
      if (sensitive.length === 0) {
        if (args.write) {
          experience.policy = { ...(experience.policy ?? {}), redaction_status: "clean" };
          await writeJson(filePath, experience);
        }
        continue;
      }
      findings.push({ repo, id: experience.id, file: filePath, findings: sensitive });
      if (args.write) {
        const hasHighSeverity = sensitive.some((finding) => finding.severity === "high");
        experience.policy = {
          ...(experience.policy ?? {}),
          sensitivity: hasHighSeverity ? "secret-adjacent" : experience.policy?.sensitivity ?? "internal",
          redaction_status: hasHighSeverity ? "blocked" : "redacted",
          redaction_categories: [...new Set(sensitive.map((finding) => finding.type))].sort(),
        };
        await writeJson(filePath, experience);
      }
    }
    await writeJson(path.join(compiledDir, "redaction-report.json"), {
      version: 1,
      generated_at: new Date().toISOString(),
      write: args.write,
      findings: findings.filter((finding) => finding.repo === repo),
    });
  }

  if (args.format === "table") {
    if (findings.length === 0) console.log("No sensitive memory findings.");
    else findings.forEach((finding) => console.log(`${finding.repo} ${finding.id} ${finding.findings.map((item) => item.type).join(",")}`));
  } else {
    console.log(JSON.stringify({ version: 1, generated_at: new Date().toISOString(), write: args.write, findings }, null, 2));
  }
} catch (error) {
  console.error(`[monkeys-memory] redact failed: ${error.message}`);
  process.exit(1);
}
