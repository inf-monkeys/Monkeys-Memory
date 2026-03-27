import path from "node:path";
import { isRepoAllowed } from "./lib/allowlist.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { listJsonFiles, matchGlob, padRight, readConfig, readJson } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = {
    repo: null,
    status: null,
    kind: null,
    path: null,
    format: "table",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1] ?? null;
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory list --repo <repo> [--status active|deprecated] [--kind rule|exception] [--path <glob>] [--format json|table]");
      process.exit(0);
    } else if (token === "--repo") { args.repo = next; i += 1; }
    else if (token === "--status") { args.status = next; i += 1; }
    else if (token === "--kind") { args.kind = next; i += 1; }
    else if (token === "--path") { args.path = next; i += 1; }
    else if (token === "--format") { args.format = next ?? "table"; i += 1; }
  }

  if (!args.repo) {
    console.error("[monkeys-memory] --repo is required");
    process.exit(1);
  }

  return args;
}

try {
  const projectRoot = path.resolve(path.join(import.meta.dirname, ".."));
  const args = parseArgs(process.argv.slice(2));
  const config = await readConfig(projectRoot);

  if (!(await isRepoAllowed(projectRoot, args.repo))) {
    console.error(`[monkeys-memory] repo "${args.repo}" is not in the allowlist`);
    process.exit(1);
  }

  const { experiencesDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, args.repo);
  const files = await listJsonFiles(experiencesDir);
  const experiences = [];

  for (const filePath of files) {
    try {
      const exp = await readJson(filePath);
      if (args.status && exp.status !== args.status) continue;
      if (args.kind && (exp.kind ?? "rule") !== args.kind) continue;
      if (args.path) {
        const hasMatch = exp.scope?.paths?.some((p) => matchGlob(p, args.path) || p === args.path);
        if (!hasMatch) continue;
      }
      experiences.push(exp);
    } catch (error) {
      console.error(`[monkeys-memory] warning: skipped ${filePath}: ${error.message}`);
    }
  }

  if (args.format === "json") {
    console.log(JSON.stringify(experiences, null, 2));
  } else {
    if (experiences.length === 0) {
      console.log("No experiences found.");
      process.exit(0);
    }

    const header = [
      padRight("ID", 36),
      padRight("Title", 40),
      padRight("Kind", 6),
      padRight("Conf", 6),
      padRight("Status", 12),
      "Updated",
    ].join("");

    console.log(header);
    console.log("-".repeat(header.length));

    for (const exp of experiences) {
      const updated = exp.updated_at ? exp.updated_at.slice(0, 10) : "n/a";
      console.log([
        padRight((exp.id ?? "?").slice(0, 34), 36),
        padRight((exp.title ?? "?").slice(0, 38), 40),
        padRight((exp.kind ?? "rule").slice(0, 4), 6),
        padRight(String(exp.confidence ?? 0), 6),
        padRight(exp.status ?? "active", 12),
        updated,
      ].join(""));
    }

    console.log(`\nTotal: ${experiences.length}`);
  }
} catch (error) {
  console.error(`[monkeys-memory] list failed: ${error.message}`);
  process.exit(1);
}
