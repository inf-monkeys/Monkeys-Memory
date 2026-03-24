import path from "node:path";
import { isRepoAllowed } from "./allowlist.mjs";
import { compileRepo } from "./compiler.mjs";
import { getRepoCompiledStatus } from "./staleness.mjs";
import { matchGlob, pathExists, readConfig, readJson, specificity } from "./utils.mjs";

function scoreRule(rule, targetPath, taskType) {
  let score = rule.confidence_score * 100;

  if (taskType && rule.scope.task_types.includes(taskType)) {
    score += 30;
  }

  if (targetPath) {
    const matchedPatterns = rule.scope.paths.filter((pattern) => matchGlob(pattern, targetPath));
    if (matchedPatterns.length > 0) {
      const bestSpecificity = Math.max(...matchedPatterns.map(specificity));
      score += 40 + bestSpecificity / 10;
    }
  }

  return score;
}

function sortByScore(left, right) {
  return right.runtime_score - left.runtime_score || left.id.localeCompare(right.id);
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

  return {
    enabled: true,
    org: rulePack.org,
    repo: rulePack.repo,
    path: options.path ?? null,
    task: options.task ?? null,
    rules,
    exceptions,
  };
}

export function formatContextMarkdown(context) {
  const lines = [
    `# Memory Context: ${context.repo}`,
    "",
    `Path: ${context.path ?? "n/a"}`,
    `Task: ${context.task ?? "n/a"}`,
    "",
  ];

  if (context.enabled === false) {
    lines.push("## Status", "", `- Disabled: ${context.reason}.`, "");
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "## Relevant Rules",
    "",
  );

  if (context.rules.length === 0) {
    lines.push("- No matching compiled rules.");
  } else {
    for (const rule of context.rules) {
      lines.push(
        `- [${rule.confidence}] ${rule.claim} (runtime score: ${rule.runtime_score}, sources: ${rule.source_count}, id: ${rule.id})`,
      );
    }
  }

  lines.push("", "## Relevant Exceptions", "");

  if (context.exceptions.length === 0) {
    lines.push("- No matching compiled exceptions.");
  } else {
    for (const rule of context.exceptions) {
      lines.push(
        `- [${rule.confidence}] ${rule.claim} (runtime score: ${rule.runtime_score}, sources: ${rule.source_count}, id: ${rule.id})`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
