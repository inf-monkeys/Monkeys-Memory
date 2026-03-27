import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRepoAllowed } from "./lib/allowlist.mjs";
import { compileRepo } from "./lib/compiler.mjs";
import { resolveRepoContext } from "./lib/context.mjs";
import { ensureRepoInitialized } from "./lib/repo-init.mjs";
import { normalizeEvidenceType, normalizeTaskType, readConfig, slugify, writeJson } from "./lib/utils.mjs";

const execFileAsync = promisify(execFile);

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
    auto: false,
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
      const validKinds = ["rule", "exception"];
      if (next && !validKinds.includes(next)) {
        throw new Error(`--kind must be one of: ${validKinds.join(", ")} (got "${next}")`);
      }
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
    } else if (token === "--auto") {
      args.auto = true;
    }
  }

  if ((args.evidenceType && !args.evidenceRef) || (!args.evidenceType && args.evidenceRef)) {
    console.error("warning: --evidence-type and --evidence-ref should be provided together");
  }

  if (!args.auto) {
    if (!args.title) {
      throw new Error("--title is required (or use --auto)");
    }
    if (!args.claim) {
      throw new Error("--claim is required (or use --auto)");
    }
  }

  return args;
}

async function runGit(cwd, gitArgs) {
  try {
    const { stdout } = await execFileAsync("git", gitArgs, { cwd, encoding: "utf8" });
    return stdout.trim();
  } catch {
    return "";
  }
}

function inferTaskType(message) {
  const lower = message.toLowerCase();
  if (/\bfix(es|ed)?\b/.test(lower) || /\bbug\b/.test(lower)) return "bugfix";
  if (/\bhotfix\b/.test(lower)) return "hotfix";
  if (/\brefactor\b/.test(lower)) return "refactor";
  if (/\bfeat(ure)?\b/.test(lower)) return "feature";
  if (/\breview\b/.test(lower)) return "review";
  return "feature";
}

async function autoExtract(workspace) {
  const commitMsg = await runGit(workspace, ["log", "-1", "--format=%B"]);
  const diffStat = await runGit(workspace, ["diff", "HEAD~1", "--name-only"]);
  const changedFiles = diffStat.split("\n").filter(Boolean);

  const firstLine = (commitMsg.split("\n")[0] || "").trim();
  const title = firstLine.slice(0, 80) || "Auto-captured experience";
  const body = commitMsg.split("\n").slice(1).join(" ").trim();
  const claim = body || firstLine || "Auto-captured from recent commit.";

  const paths = changedFiles.length > 0
    ? [...new Set(changedFiles.map((f) => {
        const dir = path.dirname(f);
        return dir === "." ? "**" : `${dir}/**`;
      }))]
    : ["**"];

  const taskType = inferTaskType(commitMsg);

  return { title, claim, paths, taskType };
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

let title = args.title;
let claim = args.claim;
let autoData = null;

if (args.auto) {
  autoData = await autoExtract(context.workspace);
  title = args.title ?? autoData.title;
  claim = args.claim ?? autoData.claim;
}

const now = new Date();
const isoNow = now.toISOString();
const datePrefix = isoNow.slice(0, 10).replaceAll("-", "_");
const uniqueSuffix = String(Date.now()).slice(-6);
const recordId = `exp_${datePrefix}_${uniqueSuffix}_${slugify(title).slice(0, 20)}`;

const scopePaths = args.path
  ? parseMultiValue(args.path)
  : autoData?.paths
    ? autoData.paths
    : context.path
      ? [context.path]
      : ["**"];

const rawTaskTypes = args.task
  ? parseMultiValue(args.task)
  : autoData?.taskType
    ? [autoData.taskType]
    : context.task
      ? [context.task]
      : [];

const taskTypes = rawTaskTypes.map(normalizeTaskType);
const evidenceType = args.evidenceType ? normalizeEvidenceType(args.evidenceType) : null;

const experience = {
  id: recordId,
  org: config.org,
  repo: context.repo,
  kind: args.kind,
  title,
  claim,
  scope: {
    paths: scopePaths,
    task_types: taskTypes,
  },
  evidence:
    evidenceType && args.evidenceRef
      ? [
          {
            type: evidenceType,
            ref: args.evidenceRef,
          },
        ]
      : [],
  source: {
    author: args.author,
    session: args.session,
  },
  confidence: args.auto ? 0.5 : 0.7,
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
