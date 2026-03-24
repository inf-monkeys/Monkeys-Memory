import path from "node:path";
import { promises as fs } from "node:fs";
import {
  clamp,
  confidenceBucket,
  ensureDir,
  listDirectories,
  listJsonFiles,
  maxIsoDate,
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

  for (const field of required) {
    if (!(field in experience)) {
      throw new Error(`Missing required field "${field}" in ${filePath}`);
    }
  }

  if (!Array.isArray(experience.scope?.paths) || experience.scope.paths.length === 0) {
    throw new Error(`Experience ${experience.id} must include at least one scope path in ${filePath}`);
  }

  if (typeof experience.confidence !== "number" || experience.confidence < 0 || experience.confidence > 1) {
    throw new Error(`Experience ${experience.id} has invalid confidence in ${filePath}`);
  }
}

function makeGroupKey(experience) {
  const kind = experience.kind ?? "rule";
  const paths = uniqueSorted(experience.scope.paths).join("|");
  const taskTypes = uniqueSorted(experience.scope.task_types ?? []).join("|");
  return [kind, normalizeText(experience.claim), paths, taskTypes].join("::");
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
      task_types: uniqueSorted(experiences.flatMap((experience) => experience.scope.task_types ?? [])),
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

async function loadExperiences(repoDir) {
  const experienceDir = path.join(repoDir, "experiences");
  const files = await listJsonFiles(experienceDir);
  const loaded = [];

  for (const filePath of files) {
    const experience = await readJson(filePath);
    validateExperience(experience, filePath);
    if (!experience.updated_at) {
      const stat = await fs.stat(filePath);
      experience.updated_at = stat.mtime.toISOString();
    }
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

  const experiences = await loadExperiences(repoDir);
  const grouped = new Map();

  for (const experience of experiences) {
    const key = makeGroupKey(experience);
    const bucket = grouped.get(key) ?? [];
    bucket.push(experience);
    grouped.set(key, bucket);
  }

  const mergedItems = [...grouped.values()].map((bucket) => mergeExperiences(bucket[0].kind ?? "rule", bucket));
  const generatedAt = new Date().toISOString();
  const rulePack = {
    version: 1,
    org: config.org,
    repo: repoName,
    generated_at: generatedAt,
    source_experience_count: experiences.length,
    rules: mergedItems.filter((item) => item.kind === "rule").sort(sortRules),
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

  for (const repoName of selectedRepoNames) {
    summaries.push(await compileRepo(projectRoot, repoName));
  }

  const orgCompiledDir = path.join(projectRoot, config.memoryRoot, "org", "compiled");
  await ensureDir(orgCompiledDir);
  await writeJson(path.join(orgCompiledDir, "repo-catalog.json"), {
    version: 1,
    org: config.org,
    generated_at: new Date().toISOString(),
    repos: summaries.filter((summary) => !summary.skipped),
  });

  return summaries;
}
