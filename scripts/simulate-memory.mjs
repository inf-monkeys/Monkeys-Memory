import path from "node:path";
import { resolveRepoContext } from "./lib/context.mjs";
import { allCompiledItems, loadCompiledPack } from "./lib/local-analysis.mjs";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { explainRule, hiddenReasons, retrieveContext } from "./lib/retrieve.mjs";
import { readConfig } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    repo: null,
    path: null,
    task: null,
    format: "json",
    memoryRoot: null,
    branch: null,
    tag: null,
    commit: null,
    userId: null,
    teamId: null,
    templateId: null,
    includeSensitive: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory simulate [--memory-root <dir>] [--workspace <dir>] [--repo <repo>] [--path <path>] [--task <task>] [--branch <name>] [--tag <tag>] [--commit <sha>] [--user <id>] [--team <id>] [--template <id>] [--include-sensitive] [--format json|md]");
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
      args.format = argv[index + 1] ?? "json";
      index += 1;
    } else if (token === "--memory-root") {
      args.memoryRoot = argv[index + 1] ?? null;
      index += 1;
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
    } else if (token === "--include-sensitive") {
      args.includeSensitive = true;
    }
  }
  return args;
}

function formatMarkdown(simulation) {
  const context = simulation.context;
  const lines = [`# Memory Access Simulation: ${context.repo}`, ""];
  if (context.enabled === false) {
    lines.push(`Disabled: ${context.reason}`);
    return `${lines.join("\n")}\n`;
  }
  for (const section of ["allowed", "hidden"]) {
    lines.push(`## ${section[0].toUpperCase()}${section.slice(1)}`, "");
    if ((simulation[section] ?? []).length === 0) {
      lines.push("- No matches.");
    } else {
      for (const item of simulation[section]) {
        lines.push(`- ${item.id}: ${item.claim}`);
        if (item.runtime_score != null) lines.push(`  score: ${item.runtime_score}`);
        if (item.hidden_reasons?.length) lines.push(`  hidden: ${item.hidden_reasons.join("; ")}`);
        if (item.explanation?.why?.length) lines.push(`  why: ${item.explanation.why.join("; ")}`);
        if (item.explanation?.risks?.length) lines.push(`  risks: ${item.explanation.risks.join("; ")}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function buildAccessSimulation(projectRoot, resolved) {
  const allowedRepos = await getAllowedRepos(projectRoot);
  if (!allowedRepos.includes(resolved.repo)) {
    return {
      version: 1,
      simulated_at: new Date().toISOString(),
      context: {
        repo: resolved.repo,
        path: resolved.path,
        task: resolved.task,
        branch: resolved.branch ?? null,
        tag: resolved.tag ?? null,
        commit: resolved.commit ?? null,
        user_id: resolved.userId ?? null,
        team_id: resolved.teamId ?? null,
        template_id: resolved.templateId ?? null,
        include_sensitive: resolved.includeSensitive ?? false,
        enabled: false,
        reason: "repo not in allowlist",
      },
      allowed: [],
      hidden: [],
      rules: [],
      exceptions: [],
    };
  }

  const config = await readConfig(projectRoot);
  const pack = await loadCompiledPack(projectRoot, config, resolved.repo);
  const retrieval = await retrieveContext(projectRoot, resolved);
  const allowedIds = new Set([...retrieval.rules, ...retrieval.exceptions].map((item) => item.id));
  const hidden = allCompiledItems(pack)
    .map((item) => ({ item, reasons: hiddenReasons(item, resolved) }))
    .filter(({ reasons }) => reasons.length > 0)
    .map(({ item, reasons }) => ({
      id: item.id,
      kind: item.kind,
      claim: item.claim,
      scope: item.scope,
      policy: item.policy ?? null,
      validity: item.validity ?? null,
      hidden_reasons: reasons,
      would_match: allowedIds.has(item.id),
      explanation: explainRule(item, resolved.path, resolved.task).explanation,
    }));

  return {
    version: 1,
    simulated_at: new Date().toISOString(),
    context: {
      repo: retrieval.repo,
      path: retrieval.path,
      task: retrieval.task,
      branch: resolved.branch ?? null,
      tag: resolved.tag ?? null,
      commit: resolved.commit ?? null,
      user_id: resolved.userId ?? null,
      team_id: resolved.teamId ?? null,
      template_id: resolved.templateId ?? null,
      include_sensitive: resolved.includeSensitive ?? false,
      enabled: retrieval.enabled,
      reason: retrieval.reason ?? null,
    },
    allowed: [...retrieval.rules, ...retrieval.exceptions],
    hidden,
    rules: retrieval.rules,
    exceptions: retrieval.exceptions,
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot
    ? path.resolve(args.memoryRoot)
    : path.resolve(path.join(import.meta.dirname, ".."));
  const resolved = await resolveRepoContext(args);
  const simulation = await buildAccessSimulation(projectRoot, resolved);
  if (args.format === "md") {
    console.log(formatMarkdown(simulation));
  } else {
    console.log(JSON.stringify(simulation, null, 2));
  }
} catch (error) {
  console.error(`[monkeys-memory] simulate failed: ${error.message}`);
  process.exit(1);
}
