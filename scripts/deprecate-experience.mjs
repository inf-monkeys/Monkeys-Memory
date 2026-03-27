import path from "node:path";
import { isRepoAllowed } from "./lib/allowlist.mjs";
import { compileRepo } from "./lib/compiler.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { listJsonFiles, readConfig, readJson, writeJson } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { repo: null, id: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo") { args.repo = argv[i + 1] ?? null; i += 1; }
    else if (argv[i] === "--id") { args.id = argv[i + 1] ?? null; i += 1; }
  }
  if (!args.repo) throw new Error("--repo is required");
  if (!args.id) throw new Error("--id is required");
  return args;
}

const projectRoot = path.resolve(path.join(import.meta.dirname, ".."));
const args = parseArgs(process.argv.slice(2));
const config = await readConfig(projectRoot);

if (!(await isRepoAllowed(projectRoot, args.repo))) {
  console.error(`repo "${args.repo}" is not in the allowlist`);
  process.exit(1);
}

const { experiencesDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, args.repo);
const files = await listJsonFiles(experiencesDir);
let found = false;

for (const filePath of files) {
  const exp = await readJson(filePath);
  if (exp.id === args.id) {
    exp.status = "deprecated";
    exp.updated_at = new Date().toISOString();
    await writeJson(filePath, exp);
    console.log(`deprecated ${args.id} in ${args.repo}`);
    found = true;
    break;
  }
}

if (!found) {
  console.error(`experience "${args.id}" not found in ${args.repo}`);
  process.exit(1);
}

await compileRepo(projectRoot, args.repo);
console.log(`recompiled ${args.repo}`);
