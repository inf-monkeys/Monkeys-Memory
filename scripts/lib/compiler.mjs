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
} from "./utils.mjs";
import { getAllowedRepos, isRepoAllowed } from "./allowlist.mjs";
import { ensureRepoInitialized } from "./repo-init.mjs";
import { toYaml } from "./yaml.mjs";

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

  const validKinds = ["rule", "exception"];
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
  const first = experiences[0];
  const sourceCount = experiences.length;
  const evidenceCount = experiences.reduce((total, experience) => total + (experience.evidence?.length ?? 0), 0);
  const averageConfidence = experiences.reduce((total, experience) => total + experience.confidence, 0) / sourceCount;
  const confidenceScore = clamp(averageConfidence + Math.min((sourceCount - 1) * 0.06, 0.18), 0, 1);
  const updatedAt = maxIsoDate(experiences.map((experience) => experience.updated_at));
  const title = experiences
    .map((experience) => experience.title)
    .sort((left, right) => left.length - right.length)[0];
  const claim = experiences
    .map((experience) => experience.claim)
    .sort((left, right) => left.length - right.length)[0];

  return {
    id: slugify(`${first.repo}-${kind}-${title}`),
    kind,
    title,
    claim,
    scope: {
      paths: uniqueSorted(experiences.flatMap((experience) => experience.scope.paths)),
      task_types: uniqueSorted(experiences.flatMap((experience) => (experience.scope.task_types ?? []).map(normalizeTaskType))),
    },
    confidence: confidenceBucket(confidenceScore),
    confidence_score: Number(confidenceScore.toFixed(2)),
    source_count: sourceCount,
    evidence_count: evidenceCount,
    updated_at: updatedAt,
    sources: uniqueSorted(experiences.map((experience) => experience.id)),
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

function buildOnboardingMarkdown(rulePack, config) {
  const topRules = rulePack.rules.slice(0, config.onboardingRuleLimit);
  const topExceptions = rulePack.exceptions.slice(0, 5);
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

  for (const filePath of files) {
    const experience = await readJson(filePath);
    validateExperience(experience, filePath);
    if (experience.status === "deprecated") continue;
    if (!experience.updated_at) {
      const stat = await fs.stat(filePath);
      experience.updated_at = stat.mtime.toISOString();
    }
    applyConfidenceDecay(experience, config);
    loaded.push(experience);
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
  const { repoDir, compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repoName);

  const experiences = await loadExperiences(repoDir, config);
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
  const generatedAt = new Date().toISOString();

  const allRules = mergedItems.filter((item) => item.kind === "rule");
  detectConflicts(allRules);

  const rulePack = {
    version: 1,
    org: config.org,
    repo: repoName,
    generated_at: generatedAt,
    source_experience_count: experiences.length,
    rules: allRules.sort(sortRules),
    exceptions: mergedItems.filter((item) => item.kind === "exception").sort(sortRules),
  };

  const pathIndex = buildPathIndex(rulePack);
  const onboarding = buildOnboardingMarkdown(rulePack, config);

  await writeJson(path.join(compiledDir, "rules.json"), rulePack);
  await writeText(path.join(compiledDir, "rules.yaml"), toYaml(rulePack));
  await writeText(path.join(compiledDir, "onboarding.md"), onboarding);
  await writeJson(path.join(compiledDir, "path-index.json"), pathIndex);

  return {
    repo: repoName,
    ruleCount: rulePack.rules.length,
    exceptionCount: rulePack.exceptions.length,
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

  const results = await Promise.all(
    selectedRepoNames.map((repoName) => compileRepo(projectRoot, repoName)),
  );
  summaries.push(...results);

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
