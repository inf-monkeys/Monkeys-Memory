import path from "node:path";
import { isRepoAllowed } from "./allowlist.mjs";
import { compileRepo } from "./compiler.mjs";
import { getRepoCompiledStatus } from "./staleness.mjs";
import { matchGlob, normalizeTaskType, pathExists, readConfig, readJson, specificity } from "./utils.mjs";

function scoreRule(rule, targetPath, taskType) {
  let score = rule.confidence_score * 100;

  const normalizedTask = taskType ? normalizeTaskType(taskType) : null;
  if (normalizedTask && rule.scope.task_types.some((t) => normalizeTaskType(t) === normalizedTask)) {
    score += 30;
  }

  if (targetPath) {
    const matchedPatterns = rule.scope.paths.filter((pattern) => matchGlob(pattern, targetPath));
    if (matchedPatterns.length > 0) {
      const bestSpecificity = Math.max(...matchedPatterns.map(specificity));
      score += 40 + bestSpecificity / 10;
    }
  } else {
    const hasGlobalScope = rule.scope.paths.some((p) => p === "**" || p === "**/*");
    if (hasGlobalScope) {
      score += 10;
    }
  }

  return score;
}

function sortByScore(left, right) {
  return right.runtime_score - left.runtime_score || left.id.localeCompare(right.id);
}

async function loadOrgRules(projectRoot, config) {
  const orgRulesPath = path.join(projectRoot, config.memoryRoot, "org", "compiled", "org-rules.json");
  if (!(await pathExists(orgRulesPath))) return [];
  try {
    const orgPack = await readJson(orgRulesPath);
    return orgPack.rules ?? [];
  } catch {
    return [];
  }
}

export async function retrieveContext(projectRoot, options) {
  if (!(await isRepoAllowed(projectRoot, options.repo))) {
    return {
      enabled: false,
      reason: "repo not in allowlist",
      org: null,
      repo: options.repo,
      path: options.path ?? null,
      task: options.task ?? null,
      rules: [],
      exceptions: [],
    };
  }

  const config = await readConfig(projectRoot);
  const compiledRulesPath = path.join(
    projectRoot,
    config.memoryRoot,
    "repos",
    options.repo,
    "compiled",
    "rules.json",
  );

  const compiledStatus = await getRepoCompiledStatus(projectRoot, options.repo);
  if (!(await pathExists(compiledRulesPath)) || compiledStatus.stale) {
    await compileRepo(projectRoot, options.repo);
  }

  const rulePack = await readJson(compiledRulesPath);

  const rules = rulePack.rules
    .map((rule) => ({
      ...rule,
      runtime_score: Number(scoreRule(rule, options.path, options.task).toFixed(2)),
    }))
    .filter((rule) => rule.runtime_score > 0)
    .sort(sortByScore)
    .slice(0, config.runtimeRuleLimit);

  const exceptions = rulePack.exceptions
    .map((rule) => ({
      ...rule,
      runtime_score: Number(scoreRule(rule, options.path, options.task).toFixed(2)),
    }))
    .filter((rule) => rule.runtime_score > 0)
    .sort(sortByScore)
    .slice(0, Math.min(3, config.runtimeRuleLimit));

  const orgRules = await loadOrgRules(projectRoot, config);
  const repoRuleIds = new Set(rules.map((r) => r.claim));
  const scoredOrgRules = orgRules
    .filter((rule) => !repoRuleIds.has(rule.claim))
    .map((rule) => ({
      ...rule,
      runtime_score: Number((scoreRule(rule, options.path, options.task) * 0.7).toFixed(2)),
      org_level: true,
    }))
    .filter((rule) => rule.runtime_score > 0)
    .sort(sortByScore)
    .slice(0, 3);

  const allRules = [...rules, ...scoredOrgRules].sort(sortByScore).slice(0, config.runtimeRuleLimit);

  return {
    enabled: true,
    org: rulePack.org,
    repo: rulePack.repo,
    path: options.path ?? null,
    task: options.task ?? null,
    rules: allRules,
    exceptions,
  };
}

export function formatContextMarkdown(context) {
  const lines = [
    `# Memory Context: ${context.repo}`,
    "",
  ];

  if (context.enabled === false) {
    lines.push("## Status", "", `- Disabled: ${context.reason}.`, "");
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Rules", "");

  if (context.rules.length === 0) {
    lines.push("- No matching compiled rules.");
  } else {
    for (let i = 0; i < context.rules.length; i++) {
      const rule = context.rules[i];
      const orgTag = rule.org_level ? " (org)" : "";
      lines.push(`${i + 1}. **${rule.claim}**`);
      lines.push(`   Confidence: ${rule.confidence} | Sources: ${rule.source_count} | Scope: ${rule.scope.paths.join(", ")}${orgTag}`);
      if (rule.conflicts_with?.length > 0) {
        lines.push(`   Conflicts with: ${rule.conflicts_with.join(", ")}`);
      }
    }
  }

  lines.push("", "## Exceptions", "");

  if (context.exceptions.length === 0) {
    lines.push("- No matching compiled exceptions.");
  } else {
    for (let i = 0; i < context.exceptions.length; i++) {
      const rule = context.exceptions[i];
      lines.push(`${i + 1}. **${rule.claim}**`);
      lines.push(`   Confidence: ${rule.confidence} | Sources: ${rule.source_count} | Scope: ${rule.scope.paths.join(", ")}`);
    }
  }

  lines.push("", "---", `Path: ${context.path ?? "n/a"} | Task: ${context.task ?? "n/a"}`);

  return `${lines.join("\n")}\n`;
}
