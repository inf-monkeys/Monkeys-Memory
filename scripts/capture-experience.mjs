import path from "node:path";
import { isRepoAllowed } from "./lib/allowlist.mjs";
import { compileRepo } from "./lib/compiler.mjs";
import { resolveRepoContext } from "./lib/context.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { readConfig, slugify, writeJson } from "./lib/utils.mjs";

function parseMultiValue(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    repo: null,
    path: null,
    task: null,
    kind: "rule",
    title: null,
    claim: null,
    author: process.env.USER ?? "unknown",
    session: `session-${Date.now()}`,
    evidenceType: null,
    evidenceRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1] ?? null;

    if (token === "--workspace") {
      args.workspace = next ?? args.workspace;
      index += 1;
    } else if (token === "--repo") {
      args.repo = next;
      index += 1;
    } else if (token === "--path") {
      args.path = next;
      index += 1;
    } else if (token === "--task") {
      args.task = next;
      index += 1;
    } else if (token === "--kind") {
      args.kind = next ?? "rule";
      index += 1;
    } else if (token === "--title") {
      args.title = next;
      index += 1;
    } else if (token === "--claim") {
      args.claim = next;
      index += 1;
    } else if (token === "--author") {
      args.author = next ?? args.author;
      index += 1;
    } else if (token === "--session") {
      args.session = next ?? args.session;
      index += 1;
    } else if (token === "--evidence-type") {
      args.evidenceType = next;
      index += 1;
    } else if (token === "--evidence-ref") {
      args.evidenceRef = next;
      index += 1;
    }
  }

  if (!args.title) {
    throw new Error("--title is required");
  }

  if (!args.claim) {
    throw new Error("--claim is required");
  }

  return args;
}

const projectRoot = path.resolve(path.join(import.meta.dirname, ".."));
const args = parseArgs(process.argv.slice(2));
const config = await readConfig(projectRoot);
const context = await resolveRepoContext(args);

if (!(await isRepoAllowed(projectRoot, context.repo))) {
  console.log(`skipped capture for ${context.repo}: repo not in allowlist`);
  process.exit(0);
}

await ensureRepoInitialized(projectRoot, config.memoryRoot, context.repo);

const now = new Date();
const isoNow = now.toISOString();
const datePrefix = isoNow.slice(0, 10).replaceAll("-", "_");
const uniqueSuffix = String(Date.now()).slice(-6);
const recordId = `exp_${datePrefix}_${uniqueSuffix}_${slugify(args.title).slice(0, 20)}`;
const scopePaths = args.path ? parseMultiValue(args.path) : context.path ? [context.path] : ["**"];
const taskTypes = args.task ? parseMultiValue(args.task) : context.task ? [context.task] : [];

const experience = {
  id: recordId,
  org: config.org,
  repo: context.repo,
  kind: args.kind,
  title: args.title,
  claim: args.claim,
  scope: {
    paths: scopePaths,
    task_types: taskTypes,
  },
  evidence:
    args.evidenceType && args.evidenceRef
      ? [
          {
            type: args.evidenceType,
            ref: args.evidenceRef,
          },
        ]
      : [],
  source: {
    author: args.author,
    session: args.session,
  },
  confidence: 0.7,
  status: "active",
  updated_at: isoNow,
};

const outputPath = path.join(
  projectRoot,
  config.memoryRoot,
  "repos",
  context.repo,
  "experiences",
  `${recordId}.json`,
);

await writeJson(outputPath, experience);
await compileRepo(projectRoot, context.repo);

console.log(`captured experience for ${context.repo}: ${outputPath}`);
