import path from "node:path";
import { compileProject } from "./lib/compiler.mjs";

function parseArgs(argv) {
  const args = { repo: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: monkeys-memory compile [--repo <repo>]");
      process.exit(0);
    }
    if (argv[index] === "--repo") {
      args.repo = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return args;
}

try {
  const projectRoot = path.resolve(path.join(import.meta.dirname, ".."));
  const args = parseArgs(process.argv.slice(2));
  const summaries = await compileProject(projectRoot, args);

  for (const summary of summaries) {
    if (summary.skipped) {
      console.log(`skipped ${summary.repo}: ${summary.reason}`);
    } else {
      console.log(
        `compiled ${summary.repo}: ${summary.ruleCount} rules, ${summary.exceptionCount} exceptions, ${summary.sourceExperienceCount} experiences`,
      );
    }
  }
} catch (error) {
  console.error(`[monkeys-memory] compile failed: ${error.message}`);
  process.exit(1);
}
