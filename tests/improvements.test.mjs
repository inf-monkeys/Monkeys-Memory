import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { compileProject, compileRepo } from "../scripts/lib/compiler.mjs";
import { formatContextMarkdown, retrieveContext } from "../scripts/lib/retrieve.mjs";
import { clearConfigCache } from "../scripts/lib/utils.mjs";
import { clearAllowlistCache } from "../scripts/lib/allowlist.mjs";

async function createFixture(overrides = {}) {
  clearConfigCache();
  clearAllowlistCache();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-test-"));
  const config = {
    org: "test-org",
    memoryRoot: ".monkeys-memory",
    onboardingRuleLimit: 10,
    runtimeRuleLimit: 5,
    fuzzyMergeThreshold: overrides.fuzzyThreshold ?? 0.7,
    confidenceDecayStartDays: overrides.decayStart ?? 90,
    confidenceDecayRatePerMonth: overrides.decayRate ?? 0.02,
    confidenceDecayMax: overrides.decayMax ?? 0.2,
  };
  await fs.writeFile(path.join(root, "memory.config.json"), JSON.stringify(config, null, 2) + "\n");
  await fs.mkdir(path.join(root, ".monkeys-memory", "org"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".monkeys-memory", "org", "repo-allowlist.json"),
    JSON.stringify({ version: 1, org: "test-org", repos: overrides.repos ?? ["test-repo"] }, null, 2) + "\n",
  );
  return root;
}

async function writeExperience(root, repoName, exp) {
  const dir = path.join(root, ".monkeys-memory", "repos", repoName, "experiences");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${exp.id}.json`), JSON.stringify(exp, null, 2) + "\n");
}

function makeExp(overrides = {}) {
  return {
    id: overrides.id ?? `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    org: "test-org",
    repo: overrides.repo ?? "test-repo",
    kind: overrides.kind ?? "rule",
    title: overrides.title ?? "Test title",
    claim: overrides.claim ?? "Test claim.",
    scope: {
      paths: overrides.paths ?? ["src/**"],
      task_types: overrides.taskTypes ?? ["bugfix"],
    },
    source: { author: overrides.author ?? "tester", session: overrides.session ?? "s1" },
    confidence: overrides.confidence ?? 0.7,
    status: overrides.status ?? "active",
    updated_at: overrides.updatedAt ?? new Date().toISOString(),
    ...(overrides.evidence ? { evidence: overrides.evidence } : {}),
  };
}

test("deprecated experiences are filtered during compile", async () => {
  const root = await createFixture();
  await writeExperience(root, "test-repo", makeExp({ id: "active_1", title: "Active rule", claim: "This is active." }));
  await writeExperience(root, "test-repo", makeExp({ id: "deprecated_1", title: "Old rule", claim: "This is old.", status: "deprecated" }));

  const summaries = await compileProject(root);
  assert.equal(summaries[0].sourceExperienceCount, 1);
  assert.equal(summaries[0].ruleCount, 1);
});

test("confidence decay reduces old experience confidence", async () => {
  const root = await createFixture({ decayStart: 0, decayRate: 0.1 });
  const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  await writeExperience(root, "test-repo", makeExp({ id: "old_1", title: "Old insight", claim: "Decayed claim.", updatedAt: oldDate, confidence: 0.8 }));

  await compileProject(root);
  const rules = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "test-repo", "compiled", "rules.json"), "utf8"));
  assert.ok(rules.rules[0].confidence_score < 0.8);
});

test("fuzzy merging combines similar claims", async () => {
  const root = await createFixture({ fuzzyThreshold: 0.5 });
  await writeExperience(root, "test-repo", makeExp({
    id: "fuzzy_1", title: "Route through adapter", claim: "Route settlement changes through the adapter layer first.",
    paths: ["src/settlement/**"],
  }));
  await writeExperience(root, "test-repo", makeExp({
    id: "fuzzy_2", title: "Use adapter for settlement", claim: "Settlement changes should go through adapter layer first.",
    paths: ["src/settlement/**"],
  }));

  await compileProject(root);
  const rules = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "test-repo", "compiled", "rules.json"), "utf8"));
  assert.equal(rules.rules.length, 1);
  assert.equal(rules.rules[0].source_count, 2);
});

test("fuzzy merging disabled when threshold is 1.0", async () => {
  const root = await createFixture({ fuzzyThreshold: 1.0 });
  await writeExperience(root, "test-repo", makeExp({
    id: "nofuzz_1", title: "Route through adapter", claim: "Route settlement changes through the adapter layer first.",
  }));
  await writeExperience(root, "test-repo", makeExp({
    id: "nofuzz_2", title: "Use adapter for settlement", claim: "Settlement changes should go through adapter layer first.",
  }));

  await compileProject(root);
  const rules = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "test-repo", "compiled", "rules.json"), "utf8"));
  assert.equal(rules.rules.length, 2);
});

test("conflict detection annotates contradictory rules", async () => {
  const root = await createFixture({ fuzzyThreshold: 1.0 });
  await writeExperience(root, "test-repo", makeExp({
    id: "conflict_a", title: "Always use direct DB", claim: "Always access the database directly for settlement queries.",
    paths: ["src/settlement/**"],
  }));
  await writeExperience(root, "test-repo", makeExp({
    id: "conflict_b", title: "Never use direct DB", claim: "Never access the database directly for settlement queries.",
    paths: ["src/settlement/**"],
  }));

  await compileProject(root);
  const rules = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "test-repo", "compiled", "rules.json"), "utf8"));
  assert.equal(rules.rules.length, 2);
  const ruleA = rules.rules.find((r) => r.sources.includes("conflict_a"));
  const ruleB = rules.rules.find((r) => r.sources.includes("conflict_b"));
  assert.ok(ruleA.conflicts_with?.length > 0 || ruleB.conflicts_with?.length > 0);
});

test("semantic relation compiler detects low-overlap policy conflicts", async () => {
  const root = await createFixture({ fuzzyThreshold: 1.0 });
  await writeExperience(root, "test-repo", makeExp({
    id: "semantic_guard",
    title: "Require reauth guard",
    claim: "Require recent reauthentication guard for password and MFA changes.",
    paths: ["src/auth/**"],
    updatedAt: "2026-05-09T00:00:00.000Z",
  }));
  await writeExperience(root, "test-repo", makeExp({
    id: "semantic_bypass",
    title: "Bypass reauth checks",
    claim: "Bypass reauth checks when updating password or MFA settings.",
    paths: ["src/auth/**"],
    updatedAt: "2026-05-09T00:01:00.000Z",
  }));

  await compileProject(root);
  const relations = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "test-repo", "compiled", "semantic-relations.json"), "utf8"));
  const contradiction = relations.relations.find((relation) => relation.relation === "contradicts");
  assert.ok(contradiction);
});

test("task type normalization in compiled rules", async () => {
  const root = await createFixture();
  await writeExperience(root, "test-repo", makeExp({
    id: "task_1", title: "Bug fix rule", claim: "Always check error handling.",
    taskTypes: ["bug-fix"],
  }));

  await compileProject(root);
  clearConfigCache();
  clearAllowlistCache();
  const ctx = await retrieveContext(root, { repo: "test-repo", path: "src/foo.ts", task: "bugfix" });
  assert.equal(ctx.rules.length, 1);
});

test("retrieveContext returns global rules when no path provided", async () => {
  const root = await createFixture();
  await writeExperience(root, "test-repo", makeExp({
    id: "global_1", title: "Global rule", claim: "Always lint before commit.", paths: ["**"],
  }));

  await compileProject(root);
  clearConfigCache();
  clearAllowlistCache();
  const ctx = await retrieveContext(root, { repo: "test-repo", path: null, task: null });
  assert.equal(ctx.rules.length, 1);
  assert.ok(ctx.rules[0].runtime_score > 0);
});

test("formatContextMarkdown uses new bold format", async () => {
  const root = await createFixture();
  await writeExperience(root, "test-repo", makeExp({ id: "fmt_1", title: "Format test", claim: "Test claim for formatting." }));
  await compileProject(root);
  clearConfigCache();
  clearAllowlistCache();

  const ctx = await retrieveContext(root, { repo: "test-repo", path: "src/test.ts", task: "bugfix" });
  const md = formatContextMarkdown(ctx);
  assert.match(md, /\*\*Test claim for formatting\.\*\*/);
  assert.match(md, /## Rules/);
  assert.match(md, /## Exceptions/);
  assert.match(md, /Path: src\/test\.ts \| Task: bugfix/);
});

test("parallel compilation works for multiple repos", async () => {
  const root = await createFixture({ repos: ["repo-a", "repo-b"] });
  await writeExperience(root, "repo-a", makeExp({ id: "pa_1", repo: "repo-a", title: "Rule A", claim: "Claim A." }));
  await writeExperience(root, "repo-b", makeExp({ id: "pb_1", repo: "repo-b", title: "Rule B", claim: "Claim B." }));

  const summaries = await compileProject(root);
  assert.equal(summaries.length, 2);
  assert.equal(summaries.filter((s) => !s.skipped).length, 2);
});

test("input validation catches invalid kind", async () => {
  const root = await createFixture();
  const dir = path.join(root, ".monkeys-memory", "repos", "test-repo", "experiences");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "bad.json"),
    JSON.stringify({
      id: "bad_kind", org: "test-org", repo: "test-repo", kind: "invalid",
      title: "T", claim: "C", scope: { paths: ["**"] },
      source: { author: "a", session: "s" }, confidence: 0.5,
    }, null, 2) + "\n",
  );

  // loadExperiences now catches errors and warns, so compile succeeds with 0 experiences
  const summaries = await compileProject(root);
  assert.equal(summaries[0].sourceExperienceCount, 0);
});

test("corrupted JSON files are skipped gracefully", async () => {
  const root = await createFixture();
  const dir = path.join(root, ".monkeys-memory", "repos", "test-repo", "experiences");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "corrupt.json"), "{ not valid json\n");
  await writeExperience(root, "test-repo", makeExp({ id: "good_1", title: "Good rule", claim: "This works." }));

  const summaries = await compileProject(root);
  assert.equal(summaries[0].sourceExperienceCount, 1);
  assert.equal(summaries[0].ruleCount, 1);
});

test("Promise.allSettled allows partial compilation success", async () => {
  // This tests that if one repo has issues, other repos still compile
  const root = await createFixture({ repos: ["repo-ok", "repo-bad"] });
  await writeExperience(root, "repo-ok", makeExp({ id: "ok_1", repo: "repo-ok", title: "OK rule", claim: "This is fine." }));
  // repo-bad has no experiences, should compile with 0 rules (not fail)
  const summaries = await compileProject(root);
  assert.equal(summaries.length, 2);
  const ok = summaries.find((s) => s.repo === "repo-ok");
  assert.equal(ok.ruleCount, 1);
});

test("config validation clamps invalid values", async () => {
  clearConfigCache();
  clearAllowlistCache();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-test-"));
  await fs.writeFile(path.join(root, "memory.config.json"), JSON.stringify({
    org: "test-org",
    memoryRoot: ".monkeys-memory",
    fuzzyMergeThreshold: -0.5,
    confidenceDecayStartDays: -10,
    runtimeRuleLimit: -3,
    onboardingRuleLimit: 0,
  }, null, 2) + "\n");

  const { readConfig, clearConfigCache: cc } = await import("../scripts/lib/utils.mjs");
  cc();
  const config = await readConfig(root);
  assert.ok(config.fuzzyMergeThreshold >= 0);
  assert.ok(config.confidenceDecayStartDays >= 0);
  assert.ok(config.runtimeRuleLimit >= 1);
  assert.ok(config.onboardingRuleLimit >= 1);
});

test("readJson gives clear error for corrupt files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-test-"));
  const badFile = path.join(root, "bad.json");
  await fs.writeFile(badFile, "not json at all\n");

  const { readJson } = await import("../scripts/lib/utils.mjs");
  await assert.rejects(() => readJson(badFile), /Failed to parse JSON/);
});
