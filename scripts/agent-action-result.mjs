import path from "node:path";
import { resolveRepoContext } from "./lib/context.mjs";
import { runAgentActions } from "./lib/agent-actions.mjs";
import { getLocalSkillUpdateActions } from "./lib/skill-updates.mjs";

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    actionId: null,
    actionType: "repo_scan",
    repo: null,
    manifestUrl: null,
    manifestHash: null,
    report: true,
    format: "json",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1] ?? null;
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory agent-action-result --action-id <id> [--workspace <dir>] [--repo <repo>] [--type repo_scan|skill_update] [--manifest-url <url>] [--manifest-hash <sha256>] [--no-report] [--format json]");
      process.exit(0);
    } else if (token === "--workspace") {
      args.workspace = next ?? args.workspace;
      i += 1;
    } else if (token === "--repo") {
      args.repo = next;
      i += 1;
    } else if (token === "--action-id") {
      args.actionId = next;
      i += 1;
    } else if (token === "--type") {
      args.actionType = next ?? args.actionType;
      i += 1;
    } else if (token === "--manifest-url") {
      args.manifestUrl = next;
      i += 1;
    } else if (token === "--manifest-hash") {
      args.manifestHash = next;
      i += 1;
    } else if (token === "--no-report") {
      args.report = false;
    } else if (token === "--format") {
      args.format = next ?? "json";
      i += 1;
    }
  }

  if (!args.actionId) throw new Error("--action-id is required");
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const context = await resolveRepoContext(args);
  const projectRoot = path.resolve(path.join(import.meta.dirname, ".."));
  const action = {
    id: args.actionId,
    type: args.actionType,
    repo: context.repo,
    payload: {
      ...(args.manifestUrl ? { manifest_url: args.manifestUrl } : {}),
      ...(args.manifestHash ? { manifest_hash: args.manifestHash } : {}),
    },
  };
  if (args.actionType === "skill_update" && !args.manifestUrl) {
    const localActions = await getLocalSkillUpdateActions(projectRoot);
    const localAction = localActions.find((candidate) => candidate.id === args.actionId) ?? localActions[0];
    if (localAction) {
      action.payload = localAction.payload;
    }
  }
  const results = args.report
    ? await runAgentActions([action], { workspaceRoot: context.workspaceRoot, report: true })
    : await runAgentActions([action], { workspaceRoot: context.workspaceRoot, report: false });

  console.log(JSON.stringify({ repo: context.repo, workspace: path.resolve(context.workspaceRoot), actions: results }, null, 2));
} catch (error) {
  console.error(`[monkeys-memory] agent action failed: ${error.message}`);
  process.exit(1);
}
