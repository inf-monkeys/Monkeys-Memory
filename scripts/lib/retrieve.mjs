import path from "node:path";
import { isRepoAllowed } from "./allowlist.mjs";
import { compileRepo } from "./compiler.mjs";
import { getRepoCompiledStatus } from "./staleness.mjs";
import { matchGlob, normalizeTaskType, pathExists, readConfig, readJson, specificity } from "./utils.mjs";
import { cosineSimilarity } from "./local-analysis.mjs";
import { createEmbeddingProvider } from "./plugins.mjs";
import { getLocalSkillUpdateActions } from "./skill-updates.mjs";

export function explainRule(rule, targetPath, taskType, options = {}) {
  const reasons = [];
  const risks = [];
  let score = rule.confidence_score * 100;
  reasons.push(`confidence ${rule.confidence_score}`);

  if (typeof rule.quality_score === "number") {
    score += rule.quality_score * 15;
    reasons.push(`quality ${rule.quality_score}`);
  }

  if (options.queryEmbedding && rule.embedding) {
    const semanticSimilarity = cosineSimilarity(options.queryEmbedding, rule.embedding);
    if (semanticSimilarity > 0) {
      score += semanticSimilarity * 20;
      reasons.push(`semantic similarity ${Number(semanticSimilarity.toFixed(2))}`);
    }
  }

  const normalizedTask = taskType ? normalizeTaskType(taskType) : null;
  if (normalizedTask && rule.scope.task_types.some((t) => normalizeTaskType(t) === normalizedTask)) {
    score += 30;
    reasons.push(`task matched ${normalizedTask}`);
  }

  const matchedPatterns = [];
  if (targetPath) {
    matchedPatterns.push(...rule.scope.paths.filter((pattern) => matchGlob(pattern, targetPath)));
    if (matchedPatterns.length > 0) {
      const bestSpecificity = Math.max(...matchedPatterns.map(specificity));
      score += 40 + bestSpecificity / 10;
      reasons.push(`path matched ${matchedPatterns.join(", ")}`);
      reasons.push(`path specificity ${Number(bestSpecificity.toFixed(1))}`);
    }
  } else {
    const hasGlobalScope = rule.scope.paths.some((p) => p === "**" || p === "**/*");
    if (hasGlobalScope) {
      score += 10;
      reasons.push("global scope matched");
    }
  }

  if (rule.org_level || options.orgLevel) {
    reasons.push("organization-level rule");
  }
  if (rule.lifecycle?.state && !["active", "confirmed"].includes(rule.lifecycle.state)) {
    risks.push(`lifecycle state is ${rule.lifecycle.state}`);
  }
  if (rule.conflicts_with?.length > 0) {
    risks.push(`conflicts with ${rule.conflicts_with.join(", ")}`);
  }
  if (rule.policy?.sensitivity && rule.policy.sensitivity !== "normal") {
    risks.push(`sensitivity is ${rule.policy.sensitivity}`);
  }
  if (rule.quality?.conflict_risk >= 0.6) {
    risks.push("high conflict risk");
  }
  if (rule.evidence_count === 0) {
    risks.push("no evidence references");
  }

  return {
    score,
    explanation: {
      why: reasons,
      risks,
      matched_scope: {
        paths: matchedPatterns,
        task: normalizedTask && rule.scope.task_types.some((t) => normalizeTaskType(t) === normalizedTask)
          ? normalizedTask
          : null,
      },
      matched_evidence: rule.provenance?.evidence_refs ?? [],
      relationship: {
        supports: rule.relationships?.supports ?? rule.sources ?? [],
        contradicts: rule.conflicts_with ?? rule.relationships?.contradicts ?? [],
        supersedes: rule.relationships?.supersedes ?? [],
        superseded_by: rule.relationships?.superseded_by ?? [],
      },
    },
  };
}

export function hiddenReasons(rule, options = {}) {
  const reasons = [];
  const sensitivity = rule.policy?.sensitivity ?? "normal";
  if (sensitivity === "secret-adjacent" && !options.includeSensitive) reasons.push("secret-adjacent sensitivity hidden");
  if (rule.policy?.redaction_status === "blocked") reasons.push("blocked redaction status");
  const visibility = rule.policy?.visibility ?? "repo";
  if (visibility === "user" && rule.policy?.user_id && rule.policy.user_id !== options.userId) {
    reasons.push(`user ${options.userId ?? "none"} does not match ${rule.policy.user_id}`);
  }
  if (visibility === "team" && rule.policy?.team_id && rule.policy.team_id !== options.teamId) {
    reasons.push(`team ${options.teamId ?? "none"} does not match ${rule.policy.team_id}`);
  }
  if (rule.policy?.template_id && rule.policy.template_id !== options.templateId) {
    reasons.push(`template ${options.templateId ?? "none"} does not match ${rule.policy.template_id}`);
  }
  const branch = options.branch ?? null;
  const tag = options.tag ?? null;
  const commit = options.commit ?? null;
  if (options.scope === "repo" && !["repo", "org", "global"].includes(visibility)) reasons.push(`visibility ${visibility} not available in repo scope`);
  const branches = rule.validity?.branches ?? [];
  if (branch && branches.length > 0 && !branches.includes(branch)) reasons.push(`branch ${branch} not in ${branches.join(", ")}`);
  const tags = rule.validity?.tags ?? [];
  if (tag && tags.length > 0 && !tags.includes(tag)) reasons.push(`tag ${tag} not in ${tags.join(", ")}`);
  const validFromCommit = rule.validity?.valid_from_commit ?? null;
  if (commit && validFromCommit && commit.localeCompare(validFromCommit) < 0) reasons.push(`commit ${commit} before ${validFromCommit}`);
  const validUntilCommit = rule.validity?.valid_until_commit ?? null;
  if (commit && validUntilCommit && commit.localeCompare(validUntilCommit) > 0) reasons.push(`commit ${commit} after ${validUntilCommit}`);
  return reasons;
}

export function isPolicyAllowed(rule, options) {
  return !hiddenReasons(rule, { ...options, branch: null, tag: null, commit: null }).some((reason) =>
    reason.includes("sensitivity") ||
      reason.includes("redaction") ||
      reason.includes("visibility") ||
      reason.startsWith("user ") ||
      reason.startsWith("team ") ||
      reason.startsWith("template "),
  );
}

export function isVersionAllowed(rule, options) {
  return !hiddenReasons(rule, options).some((reason) =>
    reason.startsWith("branch ") || reason.startsWith("tag ") || reason.startsWith("commit "),
  );
}

function scoreRule(rule, targetPath, taskType) {
  return explainRule(rule, targetPath, taskType).score;
}

function sortByScore(left, right) {
  return right.runtime_score - left.runtime_score || left.id.localeCompare(right.id);
}

function emptyHierarchy() {
  return { user: [], team: [], template: [], repo: [], org: [], global: [] };
}

function hierarchyLayer(rule, fallback = "repo") {
  const visibility = rule.policy?.visibility;
  if (["user", "team", "template", "repo", "org", "global"].includes(visibility)) return visibility;
  if (rule.policy?.template_id) return "template";
  return fallback;
}

function addHierarchyEntry(hierarchy, rule, fallback = "repo") {
  const layer = hierarchyLayer(rule, fallback);
  hierarchy[layer].push({ ...rule, hierarchy_layer: layer });
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
      org_rules: [],
      hierarchy: emptyHierarchy(),
      agent_actions: await getLocalSkillUpdateActions(projectRoot).catch(() => []),
    };
  }

  const config = await readConfig(projectRoot);
  const embeddingProvider = await createEmbeddingProvider(projectRoot, config);
  const queryEmbedding = embeddingProvider
    ? await embeddingProvider.embed([options.repo, options.path, options.task].filter(Boolean).join(" "))
    : null;
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
  const vectorIndexPath = path.join(projectRoot, config.memoryRoot, "repos", options.repo, "compiled", "vector-index.json");
  const vectorIndex = queryEmbedding && await pathExists(vectorIndexPath)
    ? await readJson(vectorIndexPath)
    : null;
  const vectorSimilarityById = buildVectorSimilarityMap(vectorIndex, queryEmbedding);
  const hierarchy = emptyHierarchy();

  const rules = rulePack.rules
    .filter((rule) => isPolicyAllowed(rule, options) && isVersionAllowed(rule, options))
    .map((rule) => {
      const scored = explainRule(rule, options.path, options.task, { queryEmbedding });
      const vectorSimilarity = vectorSimilarityById.get(rule.id);
      if (typeof vectorSimilarity === "number") {
        scored.score += vectorSimilarity * 18;
        scored.explanation.why.push(`vector index similarity ${Number(vectorSimilarity.toFixed(2))}`);
      }
      return {
        ...rule,
        runtime_score: Number(scored.score.toFixed(2)),
        explanation: scored.explanation,
      };
    })
    .filter((rule) => rule.runtime_score > 0)
    .sort(sortByScore)
    .slice(0, config.runtimeRuleLimit);
  rules.forEach((rule) => addHierarchyEntry(hierarchy, rule, "repo"));

  const exceptions = rulePack.exceptions
    .filter((rule) => isPolicyAllowed(rule, options) && isVersionAllowed(rule, options))
    .map((rule) => {
      const scored = explainRule(rule, options.path, options.task, { queryEmbedding });
      const vectorSimilarity = vectorSimilarityById.get(rule.id);
      if (typeof vectorSimilarity === "number") {
        scored.score += vectorSimilarity * 18;
        scored.explanation.why.push(`vector index similarity ${Number(vectorSimilarity.toFixed(2))}`);
      }
      return {
        ...rule,
        runtime_score: Number(scored.score.toFixed(2)),
        explanation: scored.explanation,
      };
    })
    .filter((rule) => rule.runtime_score > 0)
    .sort(sortByScore)
    .slice(0, Math.min(3, config.runtimeRuleLimit));
  exceptions.forEach((rule) => addHierarchyEntry(hierarchy, rule, "repo"));

  const proceduralItems = [
    ...(rulePack.procedures ?? []),
    ...(rulePack.checklists ?? []),
    ...(rulePack.notes ?? []),
  ]
    .filter((rule) => isPolicyAllowed(rule, options) && isVersionAllowed(rule, options))
    .map((rule) => {
      const scored = explainRule(rule, options.path, options.task, { queryEmbedding });
      const vectorSimilarity = vectorSimilarityById.get(rule.id);
      if (typeof vectorSimilarity === "number") {
        scored.score += vectorSimilarity * 18;
        scored.explanation.why.push(`vector index similarity ${Number(vectorSimilarity.toFixed(2))}`);
      }
      return {
        ...rule,
        runtime_score: Number(scored.score.toFixed(2)),
        explanation: scored.explanation,
      };
    })
    .filter((rule) => rule.runtime_score > 0)
    .sort(sortByScore)
    .slice(0, config.runtimeRuleLimit);
  proceduralItems.forEach((rule) => addHierarchyEntry(hierarchy, rule, "repo"));

  const orgRules = await loadOrgRules(projectRoot, config);
  const repoRuleIds = new Set(rules.map((r) => r.claim));
  const scoredOrgRules = orgRules
    .filter((rule) => !repoRuleIds.has(rule.claim))
    .filter((rule) => isPolicyAllowed(rule, options) && isVersionAllowed(rule, options))
    .map((rule) => {
      const scored = explainRule(rule, options.path, options.task, { orgLevel: true, queryEmbedding });
      return {
        ...rule,
        runtime_score: Number((scored.score * 0.7).toFixed(2)),
        org_level: true,
        explanation: scored.explanation,
      };
    })
    .filter((rule) => rule.runtime_score > 0)
    .sort(sortByScore)
    .slice(0, 3);
  scoredOrgRules.forEach((rule) => addHierarchyEntry(hierarchy, rule, "org"));

  for (const layer of Object.keys(hierarchy)) {
    hierarchy[layer] = hierarchy[layer].sort(sortByScore).slice(0, config.runtimeRuleLimit);
  }

  const allRules = [...rules, ...scoredOrgRules].sort(sortByScore).slice(0, config.runtimeRuleLimit);

  return {
    enabled: true,
    org: rulePack.org,
    repo: rulePack.repo,
    path: options.path ?? null,
    task: options.task ?? null,
    rules: allRules,
    exceptions,
    org_rules: scoredOrgRules,
    hierarchy,
    agent_actions: await getLocalSkillUpdateActions(projectRoot).catch(() => []),
  };
}

function buildVectorSimilarityMap(vectorIndex, queryEmbedding) {
  const map = new Map();
  if (!vectorIndex || !queryEmbedding) return map;
  for (const item of vectorIndex.items ?? []) {
    const similarity = cosineSimilarity(queryEmbedding, item.embedding);
    if (similarity > 0) map.set(item.id, similarity);
  }
  return map;
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
      if (rule.explanation?.why?.length > 0) {
        lines.push(`   Why: ${rule.explanation.why.join("; ")}`);
      }
      if (rule.explanation?.risks?.length > 0) {
        lines.push(`   Risks: ${rule.explanation.risks.join("; ")}`);
      }
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
      if (rule.explanation?.why?.length > 0) {
        lines.push(`   Why: ${rule.explanation.why.join("; ")}`);
      }
      if (rule.explanation?.risks?.length > 0) {
        lines.push(`   Risks: ${rule.explanation.risks.join("; ")}`);
      }
    }
  }

  lines.push("", "---", `Path: ${context.path ?? "n/a"} | Task: ${context.task ?? "n/a"}`);

  return `${lines.join("\n")}\n`;
}
