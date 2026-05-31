import path from "node:path";
import { promises as fs } from "node:fs";
import {
  clamp,
  confidenceBucket,
  ensureDir,
  listJsonFiles,
  matchGlob,
  maxIsoDate,
  normalizeTaskType,
  normalizeText,
  readConfig,
  readJson,
  slugify,
  uniqueSorted,
  writeJson,
  writeText,
  pathExists,
} from "./utils.mjs";
import { getAllowedRepos, isRepoAllowed } from "./allowlist.mjs";
import { ensureRepoInitialized } from "./repo-init.mjs";
import { toYaml } from "./yaml.mjs";
import { createEmbeddingProvider, loadCompilerPlugins, runPluginHook } from "./plugins.mjs";
import { classifySemanticRelation, discoverCodeEntities, inferEntitiesForMemory } from "./local-analysis.mjs";

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "to", "in", "for", "of", "and", "or", "not", "no",
  "should", "must", "always", "never", "do", "does",
  "it", "its", "this", "that", "with", "from", "by", "on", "at",
]);

function validateExperience(experience, filePath) {
  const required = [
    "id",
    "org",
    "repo",
    "title",
    "claim",
    "scope",
    "source",
    "confidence",
  ];

  const label = experience.id ? `Experience ${experience.id}` : "Experience (unknown id)";

  for (const field of required) {
    if (!(field in experience)) {
      throw new Error(`${label}: missing required field "${field}" in ${filePath}`);
    }
  }

  if (!Array.isArray(experience.scope?.paths) || experience.scope.paths.length === 0) {
    throw new Error(`${label} must include at least one scope path in ${filePath}`);
  }

  if (typeof experience.confidence !== "number" || experience.confidence < 0 || experience.confidence > 1) {
    throw new Error(`${label} has invalid confidence in ${filePath}`);
  }

  const validKinds = ["rule", "exception", "procedure", "checklist", "note"];
  if ("kind" in experience && !validKinds.includes(experience.kind)) {
      throw new Error(`${label} has invalid kind "${experience.kind}" (expected ${validKinds.join(" or ")}) in ${filePath}`);
  }

  const validStatuses = ["active", "deprecated"];
  if ("status" in experience && !validStatuses.includes(experience.status)) {
    throw new Error(`${label} has invalid status "${experience.status}" (expected ${validStatuses.join(" or ")}) in ${filePath}`);
  }

  if ("evidence" in experience && Array.isArray(experience.evidence)) {
    for (let i = 0; i < experience.evidence.length; i++) {
      const item = experience.evidence[i];
      if (!item.type || !item.ref) {
        throw new Error(`${label} has invalid evidence at index ${i}: "type" and "ref" are required in ${filePath}`);
      }
    }
  }

  if (experience.source) {
    if (typeof experience.source.author !== "string" || !experience.source.author) {
      throw new Error(`${label} has invalid source: "author" must be a non-empty string in ${filePath}`);
    }
    if (typeof experience.source.session !== "string" || !experience.source.session) {
      throw new Error(`${label} has invalid source: "session" must be a non-empty string in ${filePath}`);
    }
  }
}

function normalizeLifecycleStatus(experience) {
  if (experience.lifecycle?.state) return experience.lifecycle.state;
  if (experience.status === "deprecated") return "deprecated";
  return "active";
}

function normalizeExperienceV2(experience) {
  const lifecycleState = normalizeLifecycleStatus(experience);
  const source = experience.source ?? {};
  const evidence = experience.evidence ?? [];
  return {
    ...experience,
    kind: experience.kind ?? "rule",
    scope: {
      paths: experience.scope.paths,
      task_types: (experience.scope.task_types ?? []).map(normalizeTaskType),
      entities: uniqueSorted(experience.scope.entities ?? []),
    },
    evidence,
    provenance: {
      source_type: experience.provenance?.source_type ?? experience.source_type ?? "manual",
      author: experience.provenance?.author ?? source.author ?? "unknown",
      session: experience.provenance?.session ?? source.session ?? "unknown",
      commit: experience.provenance?.commit ?? null,
      branch: experience.provenance?.branch ?? null,
      imported_from: experience.provenance?.imported_from ?? null,
      evidence_refs: uniqueSorted([
        ...(experience.provenance?.evidence_refs ?? []),
        ...evidence.map((item) => item.ref),
      ]),
    },
    lifecycle: {
      state: lifecycleState,
      reason: experience.lifecycle?.reason ?? null,
      updated_at: experience.lifecycle?.updated_at ?? experience.updated_at ?? new Date().toISOString(),
      superseded_by: experience.lifecycle?.superseded_by ?? null,
    },
    relationships: {
      supports: uniqueSorted(experience.relationships?.supports ?? []),
      contradicts: uniqueSorted(experience.relationships?.contradicts ?? []),
      supersedes: uniqueSorted(experience.relationships?.supersedes ?? []),
      superseded_by: uniqueSorted(experience.relationships?.superseded_by ?? []),
      specializes: uniqueSorted(experience.relationships?.specializes ?? []),
      generalizes: uniqueSorted(experience.relationships?.generalizes ?? []),
      related_to: uniqueSorted(experience.relationships?.related_to ?? []),
    },
    policy: {
      visibility: experience.policy?.visibility ?? "repo",
      sensitivity: experience.policy?.sensitivity ?? "normal",
      redaction_status: experience.policy?.redaction_status ?? "not_scanned",
      ...(experience.policy?.redaction_categories?.length ? { redaction_categories: uniqueSorted(experience.policy.redaction_categories) } : {}),
      ...(experience.policy?.user_id ? { user_id: experience.policy.user_id } : {}),
      ...(experience.policy?.team_id ? { team_id: experience.policy.team_id } : {}),
      ...(experience.policy?.template_id ? { template_id: experience.policy.template_id } : {}),
    },
    validity: {
      branches: uniqueSorted(experience.validity?.branches ?? []),
      valid_from_commit: experience.validity?.valid_from_commit ?? null,
      valid_until_commit: experience.validity?.valid_until_commit ?? null,
      tags: uniqueSorted(experience.validity?.tags ?? []),
    },
  };
}

function applyConfidenceDecay(experience, config) {
  if (!experience.updated_at) return;
  const ageMs = Date.now() - new Date(experience.updated_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const startDays = config.confidenceDecayStartDays ?? 90;
  const ratePerMonth = config.confidenceDecayRatePerMonth ?? 0.02;
  const maxDecay = config.confidenceDecayMax ?? 0.2;
  if (ageDays <= startDays) return;
  const monthsPastStart = (ageDays - startDays) / 30;
  const decay = Math.min(monthsPastStart * ratePerMonth, maxDecay);
  experience.confidence = clamp(experience.confidence - decay, 0, 1);
}

function extractClaimTokens(claim) {
  return normalizeText(claim)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function makeGroupKey(experience) {
  const kind = experience.kind ?? "rule";
  const paths = uniqueSorted(experience.scope.paths).join("|");
  const taskTypes = uniqueSorted((experience.scope.task_types ?? []).map(normalizeTaskType)).join("|");
  return [kind, normalizeText(experience.claim), paths, taskTypes].join("::");
}

function mergeGroupsByFuzzyClaim(grouped, threshold) {
  if (threshold >= 1.0) return grouped;

  const keys = [...grouped.keys()];
  const parent = new Map();
  for (const key of keys) parent.set(key, key);

  function find(k) {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const tokenCache = new Map();
  for (const key of keys) {
    const bucket = grouped.get(key);
    const tokens = new Set(extractClaimTokens(bucket[0].claim));
    tokenCache.set(key, tokens);
  }

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const keyA = keys[i];
      const keyB = keys[j];
      const [kindA] = keyA.split("::");
      const [kindB] = keyB.split("::");
      if (kindA !== kindB) continue;

      const tokensA = tokenCache.get(keyA);
      const tokensB = tokenCache.get(keyB);
      if (jaccardSimilarity(tokensA, tokensB) >= threshold) {
        const pathsA = uniqueSorted(grouped.get(keyA).flatMap((e) => e.scope.paths));
        const pathsB = uniqueSorted(grouped.get(keyB).flatMap((e) => e.scope.paths));
        const hasOverlap = pathsA.some((pa) => pathsB.some((pb) => pa === pb || matchGlob(pa, pb) || matchGlob(pb, pa)));
        if (hasOverlap) {
          union(keyA, keyB);
        }
      }
    }
  }

  const merged = new Map();
  for (const key of keys) {
    const root = find(key);
    const bucket = merged.get(root) ?? [];
    bucket.push(...grouped.get(key));
    merged.set(root, bucket);
  }

  return merged;
}

function detectConflicts(rules) {
  const negationWords = new Set(["not", "never", "avoid", "don't", "do-not", "dont", "no"]);
  const affirmWords = new Set(["always", "must", "should", "require", "ensure"]);

  function getAllTokens(text) {
    return normalizeText(text).split(/\s+/).filter((t) => t.length > 1);
  }

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const ruleA = rules[i];
      const ruleB = rules[j];

      const pathsOverlap = ruleA.scope.paths.some((pa) =>
        ruleB.scope.paths.some((pb) => pa === pb || matchGlob(pa, pb) || matchGlob(pb, pa)),
      );
      if (!pathsOverlap) continue;

      const tokensA = extractClaimTokens(ruleA.claim);
      const tokensB = extractClaimTokens(ruleB.claim);
      const contentA = new Set(tokensA.filter((t) => !negationWords.has(t) && !affirmWords.has(t)));
      const contentB = new Set(tokensB.filter((t) => !negationWords.has(t) && !affirmWords.has(t)));
      const overlap = jaccardSimilarity(contentA, contentB);
      if (overlap < 0.3) continue;

      const allA = getAllTokens(ruleA.claim);
      const allB = getAllTokens(ruleB.claim);
      const hasNegA = allA.some((t) => negationWords.has(t));
      const hasNegB = allB.some((t) => negationWords.has(t));
      const hasAffA = allA.some((t) => affirmWords.has(t));
      const hasAffB = allB.some((t) => affirmWords.has(t));

      if ((hasNegA && hasAffB && !hasNegB) || (hasNegB && hasAffA && !hasNegA)) {
        ruleA.conflicts_with ??= [];
        ruleB.conflicts_with ??= [];
        if (!ruleA.conflicts_with.includes(ruleB.id)) ruleA.conflicts_with.push(ruleB.id);
        if (!ruleB.conflicts_with.includes(ruleA.id)) ruleB.conflicts_with.push(ruleA.id);
      }
    }
  }
}

function mergeExperiences(kind, experiences) {
  if (experiences.length === 0) {
    throw new Error("[monkeys-memory] mergeExperiences called with empty array");
  }
  const first = experiences[0];
  const sourceCount = experiences.length;
  const evidenceCount = experiences.reduce((total, experience) => total + (experience.evidence?.length ?? 0), 0);
  const averageConfidence = experiences.reduce((total, experience) => total + experience.confidence, 0) / sourceCount;
  const feedback = summarizeFeedback(experiences);
  const evidenceBonus = Math.min(evidenceCount * 0.015, 0.09);
  const supportBonus = Math.min((sourceCount - 1) * 0.06, 0.18);
  const helpfulBonus = Math.min((feedback.helpful + feedback.accepted) * 0.04, 0.16);
  const negativePenalty = Math.min((feedback["not-relevant"] + feedback.outdated + feedback.failed) * 0.07, 0.28);
  const contestedPenalty = experiences.some((experience) => experience.lifecycle?.state === "contested") ? 0.12 : 0;
  const stalePenalty = experiences.some((experience) => experience.lifecycle?.state === "stale") ? 0.16 : 0;
  const confidenceScore = clamp(averageConfidence + supportBonus + evidenceBonus + helpfulBonus - negativePenalty - contestedPenalty - stalePenalty, 0, 1);
  const updatedAt = maxIsoDate(experiences.map((experience) => experience.updated_at));
  const title = experiences
    .map((experience) => experience.title)
    .sort((left, right) => left.length - right.length)[0];
  const claim = experiences
    .map((experience) => experience.claim)
    .sort((left, right) => left.length - right.length)[0];

  const paths = uniqueSorted(experiences.flatMap((experience) => experience.scope.paths));
  const taskTypes = uniqueSorted(experiences.flatMap((experience) => (experience.scope.task_types ?? []).map(normalizeTaskType)));
  const entities = uniqueSorted(experiences.flatMap((experience) => experience.scope.entities ?? []));
  const sensitivityRank = ["normal", "internal", "secret-adjacent"];
  const sensitivity = experiences
    .map((experience) => experience.policy?.sensitivity ?? "normal")
    .sort((left, right) => sensitivityRank.indexOf(right) - sensitivityRank.indexOf(left))[0] ?? "normal";
  const lifecycleState = deriveLifecycleState(experiences, feedback);
  const qualityScore = computeQualityScore({
    claim,
    paths,
    sourceCount,
    evidenceCount,
    confidenceScore,
    lifecycleState,
  });

  return {
    id: slugify(`${first.repo}-${kind}-${title}`),
    kind,
    title,
    claim,
    scope: {
      paths,
      task_types: taskTypes,
      entities,
    },
    confidence: confidenceBucket(confidenceScore),
    confidence_score: Number(confidenceScore.toFixed(2)),
    quality_score: Number(qualityScore.total.toFixed(2)),
    quality: qualityScore,
    source_count: sourceCount,
    evidence_count: evidenceCount,
    updated_at: updatedAt,
    sources: uniqueSorted(experiences.map((experience) => experience.id)),
    lifecycle: {
      state: lifecycleState,
      reason: null,
      updated_at: updatedAt,
    },
    feedback,
    provenance: {
      authors: uniqueSorted(experiences.map((experience) => experience.provenance?.author)),
      source_types: uniqueSorted(experiences.map((experience) => experience.provenance?.source_type)),
      evidence_refs: uniqueSorted(experiences.flatMap((experience) => experience.provenance?.evidence_refs ?? [])),
    },
    relationships: {
      supports: uniqueSorted(experiences.map((experience) => experience.id)),
      contradicts: uniqueSorted(experiences.flatMap((experience) => experience.relationships?.contradicts ?? [])),
      supersedes: uniqueSorted(experiences.flatMap((experience) => experience.relationships?.supersedes ?? [])),
      superseded_by: uniqueSorted(experiences.flatMap((experience) => experience.relationships?.superseded_by ?? [])),
      specializes: uniqueSorted(experiences.flatMap((experience) => experience.relationships?.specializes ?? [])),
      generalizes: uniqueSorted(experiences.flatMap((experience) => experience.relationships?.generalizes ?? [])),
      related_to: uniqueSorted(experiences.flatMap((experience) => experience.relationships?.related_to ?? [])),
    },
    policy: {
      visibility: first.policy?.visibility ?? "repo",
      sensitivity,
      redaction_status: experiences.some((experience) => experience.policy?.redaction_status === "redacted")
        ? "redacted"
        : "not_scanned",
      ...(uniqueSorted(experiences.flatMap((experience) => experience.policy?.redaction_categories ?? [])).length
        ? { redaction_categories: uniqueSorted(experiences.flatMap((experience) => experience.policy?.redaction_categories ?? [])) }
        : {}),
      ...(first.policy?.user_id ? { user_id: first.policy.user_id } : {}),
      ...(first.policy?.team_id ? { team_id: first.policy.team_id } : {}),
      ...(first.policy?.template_id ? { template_id: first.policy.template_id } : {}),
    },
    validity: {
      branches: uniqueSorted(experiences.flatMap((experience) => experience.validity?.branches ?? [])),
      valid_from_commit: experiences.map((experience) => experience.validity?.valid_from_commit).filter(Boolean).sort()[0] ?? null,
      valid_until_commit: maxIsoDate(experiences.map((experience) => experience.validity?.valid_until_commit)),
      tags: uniqueSorted(experiences.flatMap((experience) => experience.validity?.tags ?? [])),
    },
  };
}

function summarizeFeedback(experiences) {
  const summary = { helpful: 0, accepted: 0, outdated: 0, failed: 0, "not-relevant": 0 };
  for (const experience of experiences) {
    for (const event of experience.feedback ?? []) {
      if (event.outcome in summary) summary[event.outcome] += 1;
    }
  }
  return summary;
}

function deriveLifecycleState(experiences, feedback) {
  if (feedback.outdated > 0) return "stale";
  if (feedback.failed > 0 || feedback["not-relevant"] > feedback.helpful + feedback.accepted) return "contested";
  if (feedback.accepted > 0 || feedback.helpful > 0) return "confirmed";
  if (experiences.some((experience) => experience.lifecycle?.state === "contested")) return "contested";
  if (experiences.some((experience) => experience.lifecycle?.state === "stale")) return "stale";
  if (experiences.some((experience) => experience.lifecycle?.state === "confirmed")) return "confirmed";
  return "active";
}

async function loadFeedbackByMemoryId(compiledDir) {
  const logPath = path.join(compiledDir, "feedback-log.json");
  if (!(await pathExists(logPath))) return new Map();
  const log = await readJson(logPath);
  const map = new Map();
  for (const event of log.feedback ?? []) {
    const bucket = map.get(event.id) ?? [];
    bucket.push(event);
    map.set(event.id, bucket);
  }
  return map;
}

function attachFeedback(experiences, feedbackByMemoryId, previousPack) {
  const sourceToRuleIds = new Map();
  for (const item of [
    ...(previousPack?.rules ?? []),
    ...(previousPack?.exceptions ?? []),
    ...(previousPack?.procedures ?? []),
    ...(previousPack?.checklists ?? []),
    ...(previousPack?.notes ?? []),
  ]) {
    for (const sourceId of item.sources ?? []) {
      const ids = sourceToRuleIds.get(sourceId) ?? [];
      ids.push(item.id);
      sourceToRuleIds.set(sourceId, ids);
    }
  }
  return experiences.map((experience) => {
    const direct = feedbackByMemoryId.get(experience.id) ?? [];
    const viaCompiled = (sourceToRuleIds.get(experience.id) ?? []).flatMap((id) => feedbackByMemoryId.get(id) ?? []);
    return { ...experience, feedback: [...direct, ...viaCompiled] };
  });
}

function computeQualityScore({ claim, paths, sourceCount, evidenceCount, confidenceScore, lifecycleState }) {
  const clarity = clamp(claim.length >= 24 && claim.length <= 220 ? 0.9 : 0.65, 0, 1);
  const specificityScore = paths.some((scopePath) => scopePath !== "**" && scopePath !== "**/*") ? 0.85 : 0.45;
  const evidenceStrength = clamp(evidenceCount * 0.2 + Math.min(sourceCount * 0.15, 0.45), 0, 1);
  const freshness = lifecycleState === "stale" ? 0.35 : lifecycleState === "contested" ? 0.55 : 0.85;
  const conflictRisk = lifecycleState === "contested" ? 0.8 : 0.15;
  const actionability = /\b(should|must|use|avoid|route|verify|ensure|prefer|keep|add|update|run)\b/i.test(claim) ? 0.9 : 0.65;
  const total = clamp(
    clarity * 0.16 +
      specificityScore * 0.18 +
      evidenceStrength * 0.16 +
      freshness * 0.16 +
      (1 - conflictRisk) * 0.14 +
      actionability * 0.12 +
      confidenceScore * 0.08,
    0,
    1,
  );
  return {
    total: Number(total.toFixed(2)),
    clarity: Number(clarity.toFixed(2)),
    specificity: Number(specificityScore.toFixed(2)),
    evidence_strength: Number(evidenceStrength.toFixed(2)),
    freshness: Number(freshness.toFixed(2)),
    conflict_risk: Number(conflictRisk.toFixed(2)),
    actionability: Number(actionability.toFixed(2)),
  };
}

function sortRules(left, right) {
  return (
    right.confidence_score - left.confidence_score ||
    right.source_count - left.source_count ||
    right.evidence_count - left.evidence_count ||
    left.id.localeCompare(right.id)
  );
}

function buildPathIndex(rulePack) {
  const pathMap = {};

  for (const rule of [...rulePack.rules, ...rulePack.exceptions]) {
    for (const scopePath of rule.scope.paths) {
      pathMap[scopePath] ??= { rules: [], exceptions: [] };
      if (rule.kind === "exception") {
        pathMap[scopePath].exceptions.push(rule.id);
      } else {
        pathMap[scopePath].rules.push(rule.id);
      }
    }
  }

  for (const value of Object.values(pathMap)) {
    value.rules = uniqueSorted(value.rules);
    value.exceptions = uniqueSorted(value.exceptions);
  }

  return {
    version: 1,
    org: rulePack.org,
    repo: rulePack.repo,
    generated_at: rulePack.generated_at,
    paths: pathMap,
  };
}

function buildEntityIndex(rulePack, codeEntities = []) {
  const entityMap = {};
  for (const item of [...rulePack.rules, ...rulePack.exceptions, ...(rulePack.procedures ?? []), ...(rulePack.checklists ?? [])]) {
    for (const entity of item.scope.entities ?? []) {
      entityMap[entity] ??= { rules: [], exceptions: [], procedures: [], checklists: [], definitions: [] };
      if (item.kind === "exception") entityMap[entity].exceptions.push(item.id);
      else if (item.kind === "procedure") entityMap[entity].procedures.push(item.id);
      else if (item.kind === "checklist") entityMap[entity].checklists.push(item.id);
      else entityMap[entity].rules.push(item.id);
    }
  }
  for (const entity of codeEntities) {
    entityMap[entity.id] ??= { rules: [], exceptions: [], procedures: [], checklists: [], definitions: [] };
    entityMap[entity.id].definitions.push({ kind: entity.kind, name: entity.name, path: entity.path, line: entity.line });
  }
  for (const value of Object.values(entityMap)) {
    value.rules = uniqueSorted(value.rules);
    value.exceptions = uniqueSorted(value.exceptions);
    value.procedures = uniqueSorted(value.procedures);
    value.checklists = uniqueSorted(value.checklists);
    value.definitions = (value.definitions ?? []).sort((left, right) => `${left.path}:${left.line}`.localeCompare(`${right.path}:${right.line}`));
  }
  return {
    version: 1,
    org: rulePack.org,
    repo: rulePack.repo,
    generated_at: rulePack.generated_at,
    discovered_count: codeEntities.length,
    entities: entityMap,
  };
}

function buildProvenanceGraph(rulePack, experiences) {
  const nodes = [
    ...experiences.map((experience) => ({
      id: experience.id,
      type: "experience",
      label: experience.title,
      lifecycle: experience.lifecycle,
      provenance: experience.provenance,
      policy: experience.policy,
    })),
    ...[...rulePack.rules, ...rulePack.exceptions, ...rulePack.procedures, ...rulePack.checklists].map((item) => ({
      id: item.id,
      type: item.kind,
      label: item.title,
      lifecycle: item.lifecycle,
      quality_score: item.quality_score,
      confidence_score: item.confidence_score,
    })),
  ];
  const edges = [];
  for (const item of [...rulePack.rules, ...rulePack.exceptions, ...rulePack.procedures, ...rulePack.checklists]) {
    for (const sourceId of item.sources ?? []) {
      edges.push({ from: sourceId, to: item.id, type: "supports" });
    }
    for (const conflictId of item.conflicts_with ?? []) {
      edges.push({ from: item.id, to: conflictId, type: "contradicts" });
    }
    for (const supersededId of item.relationships?.supersedes ?? []) {
      edges.push({ from: item.id, to: supersededId, type: "supersedes" });
    }
  }
  return {
    version: 1,
    org: rulePack.org,
    repo: rulePack.repo,
    generated_at: rulePack.generated_at,
    nodes,
    edges,
  };
}

function buildReviewQueue(rulePack) {
  const items = [];
  for (const item of [...rulePack.rules, ...rulePack.exceptions, ...rulePack.procedures, ...rulePack.checklists]) {
    if (item.lifecycle?.state === "stale") {
      items.push({ id: item.id, reason: "stale", priority: "high", claim: item.claim });
    }
    if (item.lifecycle?.state === "contested" || item.conflicts_with?.length > 0) {
      items.push({ id: item.id, reason: "conflict", priority: "high", claim: item.claim, conflicts_with: item.conflicts_with ?? [] });
    }
    if (item.evidence_count === 0 && item.confidence_score >= 0.8) {
      items.push({ id: item.id, reason: "high-confidence-without-evidence", priority: "medium", claim: item.claim });
    }
    if ((item.quality_score ?? 1) < 0.55) {
      items.push({ id: item.id, reason: "low-quality", priority: "medium", claim: item.claim });
    }
    if (item.policy?.sensitivity !== "normal") {
      items.push({ id: item.id, reason: "policy-sensitive", priority: "medium", claim: item.claim, sensitivity: item.policy.sensitivity });
    }
  }
  return {
    version: 1,
    org: rulePack.org,
    repo: rulePack.repo,
    generated_at: rulePack.generated_at,
    items,
  };
}

function buildSemanticRelations(rulePack) {
  const items = [...rulePack.rules, ...rulePack.exceptions, ...rulePack.procedures, ...rulePack.checklists, ...rulePack.notes];
  const relations = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const relation = classifySemanticRelation(items[i], items[j]);
      if (relation.relation === "unrelated") continue;
      relations.push({ from: items[i].id, to: items[j].id, ...relation });
      attachSemanticRelation(items[i], items[j], relation.relation);
    }
  }
  return {
    version: 1,
    org: rulePack.org,
    repo: rulePack.repo,
    generated_at: rulePack.generated_at,
    relations,
  };
}

function attachSemanticRelation(left, right, relation) {
  left.relationships ??= {};
  right.relationships ??= {};
  const push = (target, field, value) => {
    target.relationships[field] = uniqueSorted([...(target.relationships[field] ?? []), value]);
  };
  if (relation === "duplicates" || relation === "related_to") {
    push(left, "related_to", right.id);
    push(right, "related_to", left.id);
  } else if (relation === "contradicts") {
    push(left, "contradicts", right.id);
    push(right, "contradicts", left.id);
  } else if (relation === "supersedes") {
    push(left, "supersedes", right.id);
    push(right, "superseded_by", left.id);
  } else if (relation === "superseded_by") {
    push(left, "superseded_by", right.id);
    push(right, "supersedes", left.id);
  } else if (relation === "generalizes") {
    push(left, "generalizes", right.id);
    push(right, "specializes", left.id);
  } else if (relation === "specializes") {
    push(left, "specializes", right.id);
    push(right, "generalizes", left.id);
  }
}

function buildVectorIndex(rulePack, embeddingProvider) {
  const items = [...rulePack.rules, ...rulePack.exceptions, ...rulePack.procedures, ...rulePack.checklists, ...rulePack.notes];
  return {
    version: 1,
    org: rulePack.org,
    repo: rulePack.repo,
    generated_at: rulePack.generated_at,
    provider: embeddingProvider?.name ?? null,
    dimensions: embeddingProvider?.dimensions ?? items.find((item) => Array.isArray(item.embedding))?.embedding?.length ?? 0,
    items: items
      .filter((item) => Array.isArray(item.embedding))
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        claim: item.claim,
        scope: item.scope,
        embedding_model: item.embedding_model,
        embedding: item.embedding,
      })),
  };
}

function buildOnboardingMarkdown(rulePack, config) {
  const topRules = rulePack.rules.slice(0, config.onboardingRuleLimit);
  const topExceptions = rulePack.exceptions.slice(0, config.onboardingExceptionLimit ?? 5);
  const lines = [
    `# Onboarding Digest: ${rulePack.repo}`,
    "",
    `Generated at: ${rulePack.generated_at}`,
    "",
    "## What this repo tends to expect",
    "",
  ];

  if (topRules.length === 0) {
    lines.push("- No compiled rules yet.");
  } else {
    for (const rule of topRules) {
      const scope = rule.scope.paths.join(", ");
      lines.push(`- [${rule.confidence}] ${rule.claim} (${rule.source_count} sources, scope: ${scope})`);
    }
  }

  lines.push("", "## Exceptions worth knowing", "");

  if (topExceptions.length === 0) {
    lines.push("- No compiled exceptions yet.");
  } else {
    for (const exception of topExceptions) {
      const scope = exception.scope.paths.join(", ");
      lines.push(`- [${exception.confidence}] ${exception.claim} (${exception.source_count} sources, scope: ${scope})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function loadExperiences(repoDir, config) {
  const experienceDir = path.join(repoDir, "experiences");
  const files = await listJsonFiles(experienceDir);
  const loaded = [];
  const errors = [];

  for (const filePath of files) {
    try {
      const experience = await readJson(filePath);
      validateExperience(experience, filePath);
      if (experience.status === "deprecated") continue;
      if (!experience.updated_at) {
        const stat = await fs.stat(filePath);
        experience.updated_at = stat.mtime.toISOString();
      }
      applyConfidenceDecay(experience, config);
      loaded.push(normalizeExperienceV2(experience));
    } catch (error) {
      errors.push({ file: filePath, error: error.message });
    }
  }

  if (errors.length > 0) {
    for (const { file, error } of errors) {
      console.error(`[monkeys-memory] warning: skipped ${file}: ${error}`);
    }
  }

  return loaded;
}

export async function compileRepo(projectRoot, repoName) {
  if (!(await isRepoAllowed(projectRoot, repoName))) {
    return {
      repo: repoName,
      skipped: true,
      reason: "repo not in allowlist",
      ruleCount: 0,
      exceptionCount: 0,
      sourceExperienceCount: 0,
    };
  }

  const config = await readConfig(projectRoot);
  const plugins = await loadCompilerPlugins(projectRoot, config);
  const embeddingProvider = await createEmbeddingProvider(projectRoot, config);
  const { repoDir, compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repoName);

  const feedbackByMemoryId = await loadFeedbackByMemoryId(compiledDir);
  let previousPack = null;
  const previousRulesPath = path.join(compiledDir, "rules.json");
  if (await pathExists(previousRulesPath)) {
    try {
      previousPack = await readJson(previousRulesPath);
    } catch {}
  }
  const pluginContext = { projectRoot, repo: repoName, org: config.org, config };
  const experiences = await runPluginHook(
    plugins,
    "beforeCompile",
    attachFeedback(await loadExperiences(repoDir, config), feedbackByMemoryId, previousPack),
    { ...pluginContext, previousPack },
  );
  const grouped = new Map();

  for (const experience of experiences) {
    const key = makeGroupKey(experience);
    const bucket = grouped.get(key) ?? [];
    bucket.push(experience);
    grouped.set(key, bucket);
  }

  const fuzzyThreshold = config.fuzzyMergeThreshold ?? 0.7;
  const mergedGroups = mergeGroupsByFuzzyClaim(grouped, fuzzyThreshold);

  const mergedItems = [...mergedGroups.values()].map((bucket) => mergeExperiences(bucket[0].kind ?? "rule", bucket));
  const workspaceRoot = config.workspaceRoot
    ? path.resolve(projectRoot, config.workspaceRoot)
    : path.join(projectRoot, repoName);
  const codeEntities = config.codeEntities?.enabled === false
    ? []
    : await discoverCodeEntities(workspaceRoot, { maxFiles: config.codeEntities?.maxFiles ?? 600 });
  if (codeEntities.length > 0) {
    for (const item of mergedItems) {
      item.scope.entities = uniqueSorted([
        ...(item.scope.entities ?? []),
        ...inferEntitiesForMemory(item, codeEntities),
      ]);
    }
  }
  const generatedAt = new Date().toISOString();

  const allRules = mergedItems.filter((item) => item.kind === "rule");
  detectConflicts(allRules);

  let rulePack = {
    version: 2,
    org: config.org,
    repo: repoName,
    generated_at: generatedAt,
    source_experience_count: experiences.length,
    rules: allRules.sort(sortRules),
    exceptions: mergedItems.filter((item) => item.kind === "exception").sort(sortRules),
    procedures: mergedItems.filter((item) => item.kind === "procedure").sort(sortRules),
    checklists: mergedItems.filter((item) => item.kind === "checklist").sort(sortRules),
    notes: mergedItems.filter((item) => item.kind === "note").sort(sortRules),
  };

  if (embeddingProvider) {
    for (const item of [...rulePack.rules, ...rulePack.exceptions, ...rulePack.procedures, ...rulePack.checklists, ...rulePack.notes]) {
      item.embedding_model = embeddingProvider.name;
      item.embedding = await embeddingProvider.embed(item.claim);
    }
  }

  rulePack = await runPluginHook(plugins, "afterCompile", rulePack, { ...pluginContext, experienceCount: experiences.length });

  const pathIndex = buildPathIndex(rulePack);
  const entityIndex = buildEntityIndex(rulePack, codeEntities);
  const provenanceGraph = buildProvenanceGraph(rulePack, experiences);
  const reviewQueue = buildReviewQueue(rulePack);
  const semanticRelations = buildSemanticRelations(rulePack);
  const vectorIndex = buildVectorIndex(rulePack, embeddingProvider);
  const onboarding = buildOnboardingMarkdown(rulePack, config);
  await writeJson(path.join(compiledDir, "rules.json"), rulePack);
  await writeText(path.join(compiledDir, "rules.yaml"), toYaml(rulePack));
  await writeText(path.join(compiledDir, "onboarding.md"), onboarding);
  await writeJson(path.join(compiledDir, "path-index.json"), pathIndex);
  await writeJson(path.join(compiledDir, "entity-index.json"), entityIndex);
  await writeJson(path.join(compiledDir, "provenance-graph.json"), provenanceGraph);
  await writeJson(path.join(compiledDir, "review-queue.json"), reviewQueue);
  await writeJson(path.join(compiledDir, "semantic-relations.json"), semanticRelations);
  await writeJson(path.join(compiledDir, "vector-index.json"), vectorIndex);
  await writeJson(path.join(compiledDir, "procedures.json"), {
    version: 1,
    org: config.org,
    repo: repoName,
    generated_at: generatedAt,
    procedures: rulePack.procedures,
    checklists: rulePack.checklists,
  });

  return {
    repo: repoName,
    ruleCount: rulePack.rules.length,
    exceptionCount: rulePack.exceptions.length,
    procedureCount: rulePack.procedures.length,
    checklistCount: rulePack.checklists.length,
    reviewItemCount: reviewQueue.items.length,
    semanticRelationCount: semanticRelations.relations.length,
    entityCount: Object.keys(entityIndex.entities).length,
    vectorIndexCount: vectorIndex.items.length,
    sourceExperienceCount: experiences.length,
  };
}

export async function compileProject(projectRoot, options = {}) {
  const config = await readConfig(projectRoot);
  const allowedRepos = await getAllowedRepos(projectRoot);
  const selectedRepoNames = options.repo
    ? allowedRepos.filter((repoName) => repoName === options.repo)
    : allowedRepos;
  const summaries = [];

  if (options.repo && !allowedRepos.includes(options.repo)) {
    summaries.push({
      repo: options.repo,
      skipped: true,
      reason: "repo not in allowlist",
      ruleCount: 0,
      exceptionCount: 0,
      sourceExperienceCount: 0,
    });
  }

  const results = await Promise.allSettled(
    selectedRepoNames.map((repoName) => compileRepo(projectRoot, repoName)),
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      summaries.push(result.value);
    } else {
      console.error(`[monkeys-memory] compile failed: ${result.reason?.message ?? result.reason}`);
    }
  }

  const orgCompiledDir = path.join(projectRoot, config.memoryRoot, "org", "compiled");
  await ensureDir(orgCompiledDir);

  const generatedAt = new Date().toISOString();
  await writeJson(path.join(orgCompiledDir, "repo-catalog.json"), {
    version: 1,
    org: config.org,
    generated_at: generatedAt,
    repos: summaries.filter((summary) => !summary.skipped),
  });

  // Compile org-level rules: rules that appear in 2+ repos
  const claimToRepos = new Map();
  for (const summary of summaries) {
    if (summary.skipped) continue;
    const rulesPath = path.join(projectRoot, config.memoryRoot, "repos", summary.repo, "compiled", "rules.json");
    try {
      const pack = await readJson(rulesPath);
      for (const rule of pack.rules) {
        const key = normalizeText(rule.claim);
        const entry = claimToRepos.get(key) ?? { rule, repos: [] };
        entry.repos.push(summary.repo);
        if (!claimToRepos.has(key)) claimToRepos.set(key, entry);
      }
    } catch {
      // skip repos with missing compiled output
    }
  }

  const orgRules = [];
  for (const [, entry] of claimToRepos) {
    if (entry.repos.length >= 2) {
      orgRules.push({
        ...entry.rule,
        id: `org-${entry.rule.id}`,
        repos: uniqueSorted(entry.repos),
      });
    }
  }

  await writeJson(path.join(orgCompiledDir, "org-rules.json"), {
    version: 1,
    org: config.org,
    generated_at: generatedAt,
    rules: orgRules.sort(sortRules),
  });

  return summaries;
}
