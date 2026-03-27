import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { getRepoCompiledStatus } from "./lib/staleness.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { listJsonFiles, pathExists, readConfig, readJson } from "./lib/utils.mjs";

async function countExperiences(experiencesDir) {
  const files = await listJsonFiles(experiencesDir);
  let active = 0;
  let deprecated = 0;
  for (const filePath of files) {
    try {
      const exp = await readJson(filePath);
      if (exp.status === "deprecated") {
        deprecated += 1;
      } else {
        active += 1;
      }
    } catch {
      active += 1;
    }
  }
  return { total: files.length, active, deprecated };
}

function padRight(str, len) {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function padLeft(str, len) {
  return str.length >= len ? str : " ".repeat(len - str.length) + str;
}

function parseArgs(argv) {
  const args = { repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo") {
      args.repo = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

const projectRoot = path.resolve(path.join(import.meta.dirname, ".."));
const args = parseArgs(process.argv.slice(2));
const config = await readConfig(projectRoot);
const allowedRepos = await getAllowedRepos(projectRoot);
const repos = args.repo ? allowedRepos.filter((r) => r === args.repo) : allowedRepos;

if (args.repo && !allowedRepos.includes(args.repo)) {
  console.log(`repo "${args.repo}" is not in the allowlist`);
  process.exit(1);
}

console.log(`Org: ${config.org}`);
console.log(`Memory root: ${config.memoryRoot}`);
console.log("");

if (repos.length === 0) {
  console.log("No repos in allowlist.");
  process.exit(0);
}

const header = [
  padRight("Repo", 24),
  padLeft("Exp", 5),
  padLeft("Active", 8),
  padLeft("Depr", 6),
  padLeft("Rules", 7),
  padLeft("Exc", 5),
  padRight("  Status", 20),
].join("");

console.log(header);
console.log("-".repeat(header.length));

for (const repoName of repos) {
  const { experiencesDir, compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repoName);
  const counts = await countExperiences(experiencesDir);

  let ruleCount = 0;
  let exceptionCount = 0;
  const rulesPath = path.join(compiledDir, "rules.json");
  if (await pathExists(rulesPath)) {
    try {
      const pack = await readJson(rulesPath);
      ruleCount = pack.rules?.length ?? 0;
      exceptionCount = pack.exceptions?.length ?? 0;
    } catch {}
  }

  const status = await getRepoCompiledStatus(projectRoot, repoName);
  const statusText = status.stale ? `stale (${status.reason})` : "up-to-date";

  console.log([
    padRight(repoName, 24),
    padLeft(String(counts.total), 5),
    padLeft(String(counts.active), 8),
    padLeft(String(counts.deprecated), 6),
    padLeft(String(ruleCount), 7),
    padLeft(String(exceptionCount), 5),
    `  ${statusText}`,
  ].join(""));
}
