import path from "node:path";
import { syncProject } from "./lib/sync.mjs";

function parseArgs(argv) {
  const args = {
    noPull: false,
    fromRef: null,
    toRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory sync [--no-pull] [--from-ref <ref>] [--to-ref <ref>]");
      process.exit(0);
    } else if (token === "--no-pull") {
      args.noPull = true;
    } else if (token === "--from-ref") {
      args.fromRef = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--to-ref") {
      args.toRef = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return args;
}

try {
  const projectRoot = path.resolve(path.join(import.meta.dirname, ".."));
  const args = parseArgs(process.argv.slice(2));
  const result = await syncProject(projectRoot, args);

  if (result.changedFiles.length === 0) {
    console.log("no changed files detected");
  } else {
    console.log(`changed files: ${result.changedFiles.length}`);
  }

  if (result.affectedRepos.length === 0) {
    console.log("no affected repos to compile");
  } else {
    console.log(`affected repos: ${result.affectedRepos.join(", ")}`);
  }

  for (const summary of result.summaries) {
    if (summary.skipped) {
      console.log(`skipped ${summary.repo}: ${summary.reason}`);
    } else {
      console.log(
        `compiled ${summary.repo}: ${summary.ruleCount} rules, ${summary.exceptionCount} exceptions, ${summary.sourceExperienceCount} experiences`,
      );
    }
  }
} catch (error) {
  console.error(`[monkeys-memory] sync failed: ${error.message}`);
  process.exit(1);
}
