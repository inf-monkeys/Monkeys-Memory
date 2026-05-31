import path from "node:path";
import { resolveRepoContext } from "./lib/context.mjs";
import { formatContextMarkdown, retrieveContext } from "./lib/retrieve.mjs";

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    repo: null,
    path: null,
    task: null,
    format: "md",
    includeSensitive: false,
    branch: null,
    tag: null,
    commit: null,
    userId: null,
    teamId: null,
    templateId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory retrieve [--workspace <dir>] [--repo <repo>] [--path <path>] [--task <task>] [--branch <name>] [--tag <tag>] [--commit <sha>] [--user <id>] [--team <id>] [--template <id>] [--include-sensitive] [--format json|md]");
      process.exit(0);
    } else if (token === "--workspace") {
      args.workspace = argv[index + 1] ?? args.workspace;
      index += 1;
    } else if (token === "--repo") {
      args.repo = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--path") {
      args.path = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--task") {
      args.task = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--format") {
      args.format = argv[index + 1] ?? "md";
      index += 1;
    } else if (token === "--include-sensitive") {
      args.includeSensitive = true;
    } else if (token === "--branch") {
      args.branch = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--tag") {
      args.tag = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--commit") {
      args.commit = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--user") {
      args.userId = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--team") {
      args.teamId = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--template") {
      args.templateId = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return args;
}

try {
  const projectRoot = path.resolve(path.join(import.meta.dirname, ".."));
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveRepoContext(args);
  const context = await retrieveContext(projectRoot, resolved);

  if (args.format === "json") {
    console.log(JSON.stringify(context, null, 2));
  } else {
    console.log(formatContextMarkdown(context));
  }
} catch (error) {
  console.error(`[monkeys-memory] retrieve failed: ${error.message}`);
  process.exit(1);
}
