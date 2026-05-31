import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compileProject } from "../scripts/lib/compiler.mjs";
import { formatContextMarkdown, retrieveContext } from "../scripts/lib/retrieve.mjs";
import { detectAffectedRepos, syncProject } from "../scripts/lib/sync.mjs";
import { scanRepositoryForAction } from "../scripts/lib/agent-actions.mjs";

const execFileAsync = promisify(execFile);

async function createFixtureProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monkeys-memory-"));
  await fs.writeFile(
    path.join(root, "memory.config.json"),
    `${JSON.stringify(
      {
        org: "Inf-Monkeys",
        memoryRoot: ".monkeys-memory",
        onboardingRuleLimit: 10,
        runtimeRuleLimit: 5,
      },
      null,
      2,
    )}\n`,
  );
  await fs.mkdir(path.join(root, ".monkeys-memory", "org"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".monkeys-memory", "org", "repo-allowlist.json"),
    `${JSON.stringify(
      {
        version: 1,
        org: "Inf-Monkeys",
        repos: ["monkeys"],
      },
      null,
      2,
    )}\n`,
  );

  const repoDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(
    path.join(repoDir, "exp_1.json"),
    `${JSON.stringify(
      {
        id: "exp_1",
        org: "Inf-Monkeys",
        repo: "monkeys",
        title: "Settlement goes through adapter",
        claim: "Route settlement changes through adapter first.",
        scope: {
          paths: ["src/settlement/**"],
          task_types: ["bugfix"],
        },
        source: {
          author: "Alice",
          session: "session-1",
        },
        confidence: 0.7,
        updated_at: "2026-03-24T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(repoDir, "exp_2.json"),
    `${JSON.stringify(
      {
        id: "exp_2",
        org: "Inf-Monkeys",
        repo: "monkeys",
        title: "Settlement goes through adapter",
        claim: "Route settlement changes through adapter first.",
        scope: {
          paths: ["src/settlement/**"],
          task_types: ["bugfix"],
        },
        source: {
          author: "Bob",
          session: "session-2",
        },
        confidence: 0.8,
        updated_at: "2026-03-24T01:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );

  return root;
}

test("compileProject produces compiled outputs", async () => {
  const root = await createFixtureProject();
  const summaries = await compileProject(root);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].ruleCount, 1);
  assert.equal(summaries[0].sourceExperienceCount, 2);

  const rulesJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "rules.json"), "utf8"),
  );
  assert.equal(rulesJson.rules.length, 1);
  assert.equal(rulesJson.rules[0].source_count, 2);
  assert.equal(rulesJson.rules[0].confidence, "high");
  assert.equal(rulesJson.version, 2);
  assert.equal(rulesJson.rules[0].lifecycle.state, "active");
  assert.equal(rulesJson.rules[0].provenance.authors.length, 2);
  assert.equal(typeof rulesJson.rules[0].quality_score, "number");

  const graphJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "provenance-graph.json"), "utf8"),
  );
  const reviewJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "review-queue.json"), "utf8"),
  );
  const entityIndexJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "entity-index.json"), "utf8"),
  );
  assert.equal(graphJson.nodes.filter((node) => node.type === "experience").length, 2);
  assert.equal(reviewJson.items.length, 1);
  assert.deepEqual(entityIndexJson.entities, {});
});

test("retrieveContext returns the most relevant compiled rule", async () => {
  const root = await createFixtureProject();
  await compileProject(root);

  const context = await retrieveContext(root, {
    repo: "monkeys",
    path: "src/settlement/service.ts",
    task: "bugfix",
  });
  const markdown = formatContextMarkdown(context);

  assert.equal(context.rules.length, 1);
  assert.match(context.rules[0].claim, /adapter/);
  assert.ok(context.hierarchy.repo.some((item) => item.id === context.rules[0].id));
  assert.equal(context.hierarchy.repo[0].hierarchy_layer, "repo");
  assert.deepEqual(context.hierarchy.team, []);
  assert.deepEqual(context.hierarchy.template, []);
  assert.ok(context.rules[0].explanation.why.some((reason) => reason.includes("path matched")));
  assert.ok(context.rules[0].explanation.why.some((reason) => reason.includes("task matched")));
  assert.match(markdown, /## Rules/);
  assert.match(markdown, /Why:/);
});

test("retrieveContext disables memory for repos outside allowlist", async () => {
  const root = await createFixtureProject();
  await compileProject(root);

  const context = await retrieveContext(root, {
    repo: "not-allowed-repo",
    path: "src/example.ts",
    task: "bugfix",
  });
  const markdown = formatContextMarkdown(context);

  assert.equal(context.enabled, false);
  assert.equal(context.reason, "repo not in allowlist");
  assert.match(markdown, /Disabled: repo not in allowlist/);
});

test("retrieveContext recompiles stale compiled memory", async () => {
  const root = await createFixtureProject();
  await compileProject(root);

  const newExperiencePath = path.join(
    root,
    ".monkeys-memory",
    "repos",
    "monkeys",
    "experiences",
    "exp_3.json",
  );
  await fs.writeFile(
    newExperiencePath,
    `${JSON.stringify(
      {
        id: "exp_3",
        org: "Inf-Monkeys",
        repo: "monkeys",
        title: "Cache verification matters",
        claim: "Verify cache write-back behavior after settlement changes.",
        scope: {
          paths: ["src/settlement/**"],
          task_types: ["bugfix"],
        },
        source: {
          author: "Carol",
          session: "session-3",
        },
        confidence: 0.75,
        updated_at: "2026-03-24T02:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );

  const context = await retrieveContext(root, {
    repo: "monkeys",
    path: "src/settlement/cache.ts",
    task: "bugfix",
  });
  const rulesJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "rules.json"), "utf8"),
  );

  assert.equal(rulesJson.rules.length, 2);
  assert.equal(context.rules.length, 2);
  assert.match(context.rules[1].claim, /cache write-back/i);
});

test("compileProject auto-initializes allowlisted repos without existing directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monkeys-memory-"));
  await fs.writeFile(
    path.join(root, "memory.config.json"),
    `${JSON.stringify(
      {
        org: "Inf-Monkeys",
        memoryRoot: ".monkeys-memory",
        onboardingRuleLimit: 10,
        runtimeRuleLimit: 5,
      },
      null,
      2,
    )}\n`,
  );
  await fs.mkdir(path.join(root, ".monkeys-memory", "org"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".monkeys-memory", "org", "repo-allowlist.json"),
    `${JSON.stringify(
      {
        version: 1,
        org: "Inf-Monkeys",
        repos: ["new-repo"],
      },
      null,
      2,
    )}\n`,
  );

  const summaries = await compileProject(root);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].repo, "new-repo");
  assert.equal(summaries[0].sourceExperienceCount, 0);

  const compiledRulesPath = path.join(
    root,
    ".monkeys-memory",
    "repos",
    "new-repo",
    "compiled",
    "rules.json",
  );
  const designReadmePath = path.join(
    root,
    ".monkeys-memory",
    "repos",
    "new-repo",
    "design",
    "README.md",
  );

  const compiledRules = JSON.parse(await fs.readFile(compiledRulesPath, "utf8"));
  assert.deepEqual(compiledRules.rules, []);
  assert.equal(await fs.readFile(designReadmePath, "utf8").then(Boolean), true);
});

test("detectAffectedRepos maps changed files to impacted allowlisted repos", async () => {
  const root = await createFixtureProject();
  const affected = await detectAffectedRepos(root, [
    ".monkeys-memory/repos/monkeys/experiences/exp_1.json",
    ".monkeys-memory/repos/monkeys/compiled/rules.json",
  ]);

  assert.deepEqual(affected, ["monkeys"]);
});

test("syncProject compiles only affected repos", async () => {
  const root = await createFixtureProject();
  await fs.mkdir(path.join(root, ".monkeys-memory", "repos", "monkeys-agent-server", "experiences"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, ".monkeys-memory", "org", "repo-allowlist.json"),
    `${JSON.stringify(
      {
        version: 1,
        org: "Inf-Monkeys",
        repos: ["monkeys", "monkeys-agent-server"],
      },
      null,
      2,
    )}\n`,
  );

  const result = await syncProject(root, {
    noPull: true,
    changedFiles: [".monkeys-memory/repos/monkeys/experiences/exp_1.json"],
  });

  assert.deepEqual(result.affectedRepos, ["monkeys"]);
  assert.equal(result.summaries.length, 1);
  assert.equal(result.summaries[0].repo, "monkeys");
});

test("compileProject emits procedure and entity artifacts", async () => {
  const root = await createFixtureProject();
  const experienceDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.writeFile(
    path.join(experienceDir, "procedure.json"),
    `${JSON.stringify(
      {
        id: "procedure_1",
        org: "Inf-Monkeys",
        repo: "monkeys",
        kind: "procedure",
        title: "Adding billing plans",
        claim: "When adding a billing plan, update quota defaults, API fields, pricing UI, and audit events.",
        scope: {
          paths: ["src/billing/**"],
          task_types: ["feature"],
          entities: ["table:plans", "route:/api/v1/plans"],
        },
        source: {
          author: "Dana",
          session: "session-4",
        },
        confidence: 0.72,
        updated_at: "2026-03-25T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );

  const summaries = await compileProject(root);
  assert.equal(summaries[0].procedureCount, 1);

  const rulesJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "rules.json"), "utf8"),
  );
  const proceduresJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "procedures.json"), "utf8"),
  );
  const entityIndexJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "entity-index.json"), "utf8"),
  );

  assert.equal(rulesJson.procedures.length, 1);
  assert.equal(proceduresJson.procedures.length, 1);
  assert.deepEqual(entityIndexJson.entities["table:plans"].procedures, [rulesJson.procedures[0].id]);
});

test("review queue includes stale and policy-sensitive memories", async () => {
  const root = await createFixtureProject();
  const experienceDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.writeFile(
    path.join(experienceDir, "stale.json"),
    `${JSON.stringify(
      {
        id: "stale_1",
        org: "Inf-Monkeys",
        repo: "monkeys",
        title: "Legacy auth rule",
        claim: "Use the legacy auth adapter for password changes.",
        scope: {
          paths: ["src/auth/**"],
          task_types: ["bugfix"],
        },
        source: {
          author: "Eve",
          session: "session-5",
        },
        confidence: 0.9,
        lifecycle: {
          state: "stale",
          reason: "auth adapter changed",
          updated_at: "2026-03-26T00:00:00.000Z",
        },
        policy: {
          visibility: "repo",
          sensitivity: "internal",
          redaction_status: "clean",
        },
        updated_at: "2026-03-26T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );

  await compileProject(root);
  const reviewJson = JSON.parse(
    await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "review-queue.json"), "utf8"),
  );

  assert.ok(reviewJson.items.some((item) => item.reason === "stale"));
  assert.ok(reviewJson.items.some((item) => item.reason === "policy-sensitive"));
});

test("review and simulate commands expose review items and explanations", async () => {
  const root = await createFixtureProject();
  await compileProject(root);

  const review = await execFileAsync("node", [
    "scripts/review-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
    "--format",
    "json",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const reviewJson = JSON.parse(review.stdout);
  assert.ok(reviewJson.items.some((item) => item.reason === "high-confidence-without-evidence"));

  const simulation = await execFileAsync("node", [
    "scripts/simulate-memory.mjs",
    "--memory-root",
    root,
    "--workspace",
    root,
    "--repo",
    "monkeys",
    "--path",
    "src/settlement/service.ts",
    "--task",
    "bugfix",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const simulationJson = JSON.parse(simulation.stdout);
  assert.equal(simulationJson.rules.length, 1);
  assert.ok(simulationJson.rules[0].explanation.why.length > 0);
});

test("simulate command surfaces hidden memory reasons", async () => {
  const root = await createFixtureProject();
  const experienceDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.writeFile(
    path.join(experienceDir, "sensitive.json"),
    `${JSON.stringify({
      id: "sensitive_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Sensitive rule",
      claim: "Use internal token handling only in secure auth code.",
      scope: { paths: ["src/auth/**"], task_types: ["feature"] },
      source: { author: "Sec", session: "s" },
      confidence: 0.8,
      policy: { visibility: "repo", sensitivity: "secret-adjacent", redaction_status: "clean" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "branch.json"),
    `${JSON.stringify({
      id: "branch_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Release branch rule",
      claim: "Use release-only settlement adapter on release branches.",
      scope: { paths: ["src/settlement/**"], task_types: ["feature"] },
      source: { author: "Rel", session: "s" },
      confidence: 0.8,
      validity: { branches: ["release/1.0"] },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "tag.json"),
    `${JSON.stringify({
      id: "tag_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Tagged release rule",
      claim: "Use tagged settlement adapter for versioned releases.",
      scope: { paths: ["src/settlement/**"], task_types: ["feature"] },
      source: { author: "Rel", session: "s" },
      confidence: 0.8,
      validity: { tags: ["v1.0.0"] },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "commit.json"),
    `${JSON.stringify({
      id: "commit_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Commit range rule",
      claim: "Use commit-range settlement adapter while the release shim exists.",
      scope: { paths: ["src/settlement/**"], task_types: ["feature"] },
      source: { author: "Rel", session: "s" },
      confidence: 0.8,
      validity: { valid_from_commit: "b000000", valid_until_commit: "d000000" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "template.json"),
    `${JSON.stringify({
      id: "template_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Template review rule",
      claim: "Apply template-specific review rubric.",
      scope: { paths: ["src/template/**"], task_types: ["feature"] },
      source: { author: "Tpl", session: "s" },
      confidence: 0.8,
      policy: { visibility: "template", template_id: "tpl_a" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await compileProject(root);

  const simulation = await execFileAsync("node", [
    "scripts/simulate-memory.mjs",
    "--memory-root",
    root,
    "--workspace",
    root,
    "--repo",
    "monkeys",
    "--path",
    "src/auth/token.ts",
    "--task",
    "feature",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const simulationJson = JSON.parse(simulation.stdout);
  assert.ok(simulationJson.hidden.some((item) => item.hidden_reasons.some((reason) => reason.includes("secret-adjacent"))));

  const branchSimulation = await execFileAsync("node", [
    "scripts/simulate-memory.mjs",
    "--memory-root",
    root,
    "--workspace",
    root,
    "--repo",
    "monkeys",
    "--path",
    "src/settlement/release.ts",
    "--task",
    "feature",
    "--branch",
    "main",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const branchJson = JSON.parse(branchSimulation.stdout);
  assert.ok(branchJson.hidden.some((item) => item.hidden_reasons.some((reason) => reason.includes("branch main"))));

  const releaseSimulation = await execFileAsync("node", [
    "scripts/simulate-memory.mjs",
    "--memory-root",
    root,
    "--workspace",
    root,
    "--repo",
    "monkeys",
    "--path",
    "src/settlement/release.ts",
    "--task",
    "feature",
    "--tag",
    "v2.0.0",
    "--commit",
    "e000000",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const releaseJson = JSON.parse(releaseSimulation.stdout);
  assert.equal(releaseJson.context.tag, "v2.0.0");
  assert.equal(releaseJson.context.commit, "e000000");
  assert.ok(releaseJson.hidden.some((item) => item.hidden_reasons.some((reason) => reason.includes("tag v2.0.0"))));
  assert.ok(releaseJson.hidden.some((item) => item.hidden_reasons.some((reason) => reason.includes("commit e000000 after"))));
});

test("benchmark command creates controlled scenario report", async () => {
  const result = await execFileAsync("node", [
    "scripts/benchmark-memory.mjs",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, "monkeys-memory-benchmark/v2");
  assert.ok(report.scenarios.includes("duplicate"));
  assert.ok(report.scenarios.includes("cold-start"));
  assert.ok(report.scenarios.includes("policy"));
  assert.equal(report.metrics.compiled_procedures, 1);
  assert.ok(report.metrics.graph_nodes >= 1);
  assert.ok(report.metrics.explained_results >= 1);
  assert.equal(report.metrics.query_count, report.queries.length);
  assert.equal(typeof report.conditions.full.mrr, "number");
  assert.ok(report.conditions.full.mrr >= report.conditions.no_memory.mrr);
  assert.ok(report.queries.some((query) => query.expected_hidden_item_ids.length > 0));
  assert.ok(report.queries.some((query) => query.results.some((item) => item.hierarchy_layer === "org")));
});

test("local analysis commands produce staleness coverage impact and validation reports", async () => {
  const root = await createFixtureProject();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm-workspace-"));
  await fs.mkdir(path.join(workspace, "src", "settlement"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "settlement", "service.ts"), "export const ok = true;\n");
  await compileProject(root);

  const coverage = await execFileAsync("node", [
    "scripts/coverage-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.equal(JSON.parse(coverage.stdout).reports[0].item_count, 1);
  assert.equal(typeof JSON.parse(coverage.stdout).reports[0].coverage_score, "number");

  const impact = await execFileAsync("node", [
    "scripts/impact-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.equal(JSON.parse(impact.stdout).reports[0].memory_items, 1);
  assert.equal(typeof JSON.parse(impact.stdout).reports[0].governance_cost, "number");

  const validation = await execFileAsync("node", [
    "scripts/validate-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
    "--workspace",
    workspace,
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.deepEqual(JSON.parse(validation.stdout).findings, []);

  const staleness = await execFileAsync("node", [
    "scripts/staleness-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
    "--workspace",
    workspace,
    "--format",
    "json",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.deepEqual(JSON.parse(staleness.stdout).items, []);
});

test("agent action repo_scan reads local repository metadata", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm-action-workspace-"));
  await execFileAsync("git", ["init"], { cwd: workspace, encoding: "utf8" });
  await execFileAsync("git", ["config", "user.email", "agent@example.com"], { cwd: workspace, encoding: "utf8" });
  await execFileAsync("git", ["config", "user.name", "Agent"], { cwd: workspace, encoding: "utf8" });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "main.ts"), "export function main() { return true; }\n");
  await execFileAsync("git", ["add", "."], { cwd: workspace, encoding: "utf8" });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspace, encoding: "utf8" });
  await fs.writeFile(path.join(workspace, "src", "main.ts"), "export function main() { return false; }\nexport class Runner {}\n");
  await fs.writeFile(path.join(workspace, "src", "new.ts"), "export const run = () => true;\n");

  const scan = await scanRepositoryForAction({ workspaceRoot: workspace });
  assert.equal(scan.schema_version, 1);
  assert.ok(scan.known_paths.includes("src/main.ts"));
  assert.ok(scan.changed_paths.includes("src/main.ts"));
  assert.ok(scan.changed_paths.includes("src/new.ts"));
  assert.ok(scan.code_entities.some((entity) => entity.id === "function:main" && entity.path === "src/main.ts"));
  assert.ok(scan.code_entities.some((entity) => entity.id === "class:Runner" && entity.path === "src/main.ts"));
  assert.match(scan.commit, /^[0-9a-f]{40}$/);
});

test("agent-action-result command can scan without reporting", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm-action-cli-"));
  await execFileAsync("git", ["init"], { cwd: workspace, encoding: "utf8" });
  await execFileAsync("git", ["config", "user.email", "agent@example.com"], { cwd: workspace, encoding: "utf8" });
  await execFileAsync("git", ["config", "user.name", "Agent"], { cwd: workspace, encoding: "utf8" });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "main.ts"), "export function main() { return true; }\n");
  await execFileAsync("git", ["add", "."], { cwd: workspace, encoding: "utf8" });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspace, encoding: "utf8" });

  const result = await execFileAsync("node", [
    "scripts/agent-action-result.mjs",
    "--workspace",
    workspace,
    "--action-id",
    "act_test",
    "--no-report",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.actions[0].id, "act_test");
  assert.equal(parsed.actions[0].reported, false);
  assert.ok(parsed.actions[0].result.known_paths.includes("src/main.ts"));
});

test("redact command detects sensitive captured experiences", async () => {
  const root = await createFixtureProject();
  const experienceDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.writeFile(
    path.join(experienceDir, "secret.json"),
    `${JSON.stringify({
      id: "secret_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Secret example",
      claim: "Use token=mk_secret_abcdefghijklmnopqrstuvwxyz and ghp_abcdefghijklmnopqrstuvwxyzABCDEFGH for tests.",
      scope: { paths: ["**"], task_types: [] },
      source: { author: "Sec", session: "s" },
      confidence: 0.5,
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );

  const result = await execFileAsync("node", [
    "scripts/redact-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.length, 1);
  assert.ok(report.findings[0].findings.some((finding) => finding.type === "github-token" && finding.severity === "high"));
});

test("compiler plugins and embedding skeleton enrich compiled output", async () => {
  const root = await createFixtureProject();
  await fs.writeFile(
    path.join(root, "memory.config.json"),
    `${JSON.stringify({
      org: "Inf-Monkeys",
      memoryRoot: ".monkeys-memory",
      onboardingRuleLimit: 10,
      runtimeRuleLimit: 5,
      embedding: { enabled: true },
      plugins: ["plugin.mjs"],
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(root, "plugin.mjs"),
    "export async function afterCompile(pack, context) { pack.plugin_touched = context.repo; return pack; }\n",
  );
  await compileProject(root);
  const rulesJson = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "rules.json"), "utf8"));
  assert.equal(rulesJson.plugin_touched, "monkeys");
  assert.equal(rulesJson.rules[0].embedding_model, "local-hash-64");
  assert.equal(rulesJson.rules[0].embedding.length, 64);
  const vectorIndex = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "vector-index.json"), "utf8"));
  assert.equal(vectorIndex.provider, "local-hash-64");
  assert.equal(vectorIndex.items.length, 1);
});

test("compiler discovers code entities and links scoped memory to definitions", async () => {
  const root = await createFixtureProject();
  await fs.mkdir(path.join(root, "monkeys", "src", "settlement"), { recursive: true });
  await fs.writeFile(
    path.join(root, "monkeys", "src", "settlement", "service.ts"),
    [
      "export class SettlementService {}",
      "export function routeSettlementChange() { return true; }",
      "router.post('/api/v1/settlements', () => {});",
    ].join("\n"),
  );

  await compileProject(root);
  const rulesJson = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "rules.json"), "utf8"));
  const entityIndex = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "entity-index.json"), "utf8"));

  assert.ok(rulesJson.rules[0].scope.entities.some((entity) => entity === "class:SettlementService"));
  assert.ok(entityIndex.entities["class:SettlementService"].definitions.some((definition) => definition.path === "src/settlement/service.ts"));
  assert.ok(entityIndex.discovered_count >= 2);
});

test("validate-memory detects missing entity definitions", async () => {
  const root = await createFixtureProject();
  await fs.mkdir(path.join(root, "monkeys", "src", "settlement"), { recursive: true });
  await fs.writeFile(
    path.join(root, "monkeys", "src", "settlement", "service.ts"),
    "export class SettlementService {}\n",
  );
  await compileProject(root);

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mm-entity-drift-"));
  await fs.mkdir(path.join(workspace, "src", "settlement"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "settlement", "service.ts"), "export const renamed = true;\n");

  const validation = await execFileAsync("node", [
    "scripts/validate-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
    "--workspace",
    workspace,
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const report = JSON.parse(validation.stdout);
  assert.ok(report.findings.some((finding) => finding.reason === "missing-entity-definition" && finding.entity === "class:SettlementService"));
});

test("semantic compiler annotates supersession relationships", async () => {
  const root = await createFixtureProject();
  await fs.writeFile(
    path.join(root, "memory.config.json"),
    `${JSON.stringify({
      org: "Inf-Monkeys",
      memoryRoot: ".monkeys-memory",
      onboardingRuleLimit: 10,
      runtimeRuleLimit: 5,
      fuzzyMergeThreshold: 1,
    }, null, 2)}\n`,
  );
  const experienceDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.writeFile(
    path.join(experienceDir, "replacement.json"),
    `${JSON.stringify({
      id: "replacement_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Settlement v2 adapter",
      claim: "Replace settlement adapter changes with the v2 adapter path instead.",
      scope: { paths: ["src/settlement/**"], task_types: ["bugfix"] },
      source: { author: "New", session: "s" },
      confidence: 0.8,
      updated_at: "2026-04-01T00:00:00.000Z",
    }, null, 2)}\n`,
  );

  await compileProject(root);
  const rulesJson = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "rules.json"), "utf8"));
  const relations = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "semantic-relations.json"), "utf8"));
  const supersession = relations.relations.find((relation) => relation.relation === "supersedes" || relation.relation === "superseded_by");
  assert.ok(supersession);
  const relatedRule = rulesJson.rules.find((rule) => rule.relationships.supersedes.length > 0 || rule.relationships.superseded_by.length > 0);
  assert.ok(relatedRule);
});

test("relations feedback hierarchy and trajectory commands produce artifacts", async () => {
  const root = await createFixtureProject();
  const trajectoryFile = path.join(root, "trajectory.json");
  await fs.writeFile(trajectoryFile, JSON.stringify([
    { type: "read", path: "src/settlement/service.ts" },
    { type: "edit", path: "src/settlement/service.ts" },
    { type: "test", status: "failed" },
    { type: "test", status: "passed" },
  ]));

  await compileProject(root);

  const relations = await execFileAsync("node", [
    "scripts/relations-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.equal(JSON.parse(relations.stdout).version, 1);

  const feedback = await execFileAsync("node", [
    "scripts/feedback-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
    "--id",
    "some-rule",
    "--outcome",
    "helpful",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.equal(JSON.parse(feedback.stdout).counts.helpful, 1);

  const trajectory = await execFileAsync("node", [
    "scripts/trajectory-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
    "--file",
    trajectoryFile,
    "--write",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.equal(JSON.parse(trajectory.stdout).candidate.lifecycle.state, "candidate");

  const hierarchy = await execFileAsync("node", [
    "scripts/hierarchy-memory.mjs",
    "--memory-root",
    root,
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.ok(JSON.parse(hierarchy.stdout).hierarchy.layers.repo.monkeys.length >= 1);
});

test("retrieveContext filters sensitive and branch-scoped rules", async () => {
  const root = await createFixtureProject();
  const experienceDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.writeFile(
    path.join(experienceDir, "sensitive.json"),
    `${JSON.stringify({
      id: "sensitive_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Sensitive rule",
      claim: "Use internal token handling only in secure auth code.",
      scope: { paths: ["src/auth/**"], task_types: ["feature"] },
      source: { author: "Sec", session: "s" },
      confidence: 0.8,
      policy: { visibility: "repo", sensitivity: "secret-adjacent", redaction_status: "clean" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "branch.json"),
    `${JSON.stringify({
      id: "branch_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Release branch rule",
      claim: "Use release-only settlement adapter on release branches.",
      scope: { paths: ["src/settlement/**"], task_types: ["feature"] },
      source: { author: "Rel", session: "s" },
      confidence: 0.8,
      validity: { branches: ["release/1.0"] },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "tag.json"),
    `${JSON.stringify({
      id: "tag_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Tagged release rule",
      claim: "Use tagged release adapter on tagged builds.",
      scope: { paths: ["src/tagged-release/**"], task_types: ["feature"] },
      source: { author: "Rel", session: "s" },
      confidence: 0.8,
      validity: { tags: ["v1.0.0"] },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "commit.json"),
    `${JSON.stringify({
      id: "commit_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Commit range rule",
      claim: "Use commit-range settlement adapter while the release shim exists.",
      scope: { paths: ["src/commit-range/**"], task_types: ["feature"] },
      source: { author: "Rel", session: "s" },
      confidence: 0.8,
      validity: { valid_from_commit: "b000000", valid_until_commit: "d000000" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "template.json"),
    `${JSON.stringify({
      id: "template_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Template review rule",
      claim: "Apply template-specific review rubric.",
      scope: { paths: ["src/template/**"], task_types: ["feature"] },
      source: { author: "Tpl", session: "s" },
      confidence: 0.8,
      policy: { visibility: "template", template_id: "tpl_a" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await compileProject(root);

  const normal = await retrieveContext(root, { repo: "monkeys", path: "src/auth/token.ts", task: "feature" });
  assert.equal(normal.rules.some((rule) => rule.id.includes("sensitive")), false);

  const sensitive = await retrieveContext(root, { repo: "monkeys", path: "src/auth/token.ts", task: "feature", includeSensitive: true });
  assert.equal(sensitive.rules.some((rule) => rule.id.includes("sensitive")), true);

  const wrongBranch = await retrieveContext(root, { repo: "monkeys", path: "src/settlement/release.ts", task: "feature", branch: "main" });
  assert.equal(wrongBranch.rules.some((rule) => rule.id.includes("release-branch")), false);

  const rightBranch = await retrieveContext(root, { repo: "monkeys", path: "src/settlement/release.ts", task: "feature", branch: "release/1.0" });
  assert.equal(rightBranch.rules.some((rule) => rule.id.includes("release-branch")), true);

  const wrongTag = await retrieveContext(root, { repo: "monkeys", path: "src/tagged-release/service.ts", task: "feature", tag: "v2.0.0" });
  assert.equal(wrongTag.rules.some((rule) => rule.id.includes("tagged-release")), false);

  const rightTag = await retrieveContext(root, { repo: "monkeys", path: "src/tagged-release/service.ts", task: "feature", tag: "v1.0.0" });
  assert.equal(rightTag.rules.some((rule) => rule.id.includes("tagged-release")), true);

  const beforeCommit = await retrieveContext(root, { repo: "monkeys", path: "src/commit-range/service.ts", task: "feature", commit: "a000000" });
  assert.equal(beforeCommit.rules.some((rule) => rule.id.includes("commit-range")), false);

  const inRangeCommit = await retrieveContext(root, { repo: "monkeys", path: "src/commit-range/service.ts", task: "feature", commit: "c000000" });
  assert.equal(inRangeCommit.rules.some((rule) => rule.id.includes("commit-range")), true);

  const afterCommit = await retrieveContext(root, { repo: "monkeys", path: "src/commit-range/service.ts", task: "feature", commit: "e000000" });
  assert.equal(afterCommit.rules.some((rule) => rule.id.includes("commit-range")), false);

  const wrongTemplate = await retrieveContext(root, { repo: "monkeys", path: "src/template/service.ts", task: "feature", templateId: "tpl_b" });
  assert.equal(wrongTemplate.hierarchy.template.some((rule) => rule.claim.includes("template-specific review rubric")), false);

  const rightTemplate = await retrieveContext(root, { repo: "monkeys", path: "src/template/service.ts", task: "feature", templateId: "tpl_a" });
  assert.equal(rightTemplate.hierarchy.template.some((rule) => rule.claim.includes("template-specific review rubric")), true);
});

test("retrieveContext filters user and team scoped rules and simulate command reports hidden scope mismatches", async () => {
  const root = await createFixtureProject();
  const experienceDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.writeFile(
    path.join(experienceDir, "user-allowed.json"),
    `${JSON.stringify({
      id: "user_allowed_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "User scoped rule",
      claim: "Use the personal sandbox for local policy experiments.",
      scope: { paths: ["src/user/**"], task_types: ["feature"] },
      source: { author: "User", session: "s" },
      confidence: 0.8,
      policy: { visibility: "user", user_id: "user_1" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "user-hidden.json"),
    `${JSON.stringify({
      id: "user_hidden_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Other user scoped rule",
      claim: "Use another user's sandbox for comparison.",
      scope: { paths: ["src/user/**"], task_types: ["feature"] },
      source: { author: "User", session: "s" },
      confidence: 0.8,
      policy: { visibility: "user", user_id: "user_2" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "team-allowed.json"),
    `${JSON.stringify({
      id: "team_allowed_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Team scoped rule",
      claim: "Use the team release checklist for shared feature work.",
      scope: { paths: ["src/team/**"], task_types: ["feature"] },
      source: { author: "Team", session: "s" },
      confidence: 0.8,
      policy: { visibility: "team", team_id: "team_a" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(experienceDir, "team-hidden.json"),
    `${JSON.stringify({
      id: "team_hidden_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Other team scoped rule",
      claim: "Use another team's checklist for comparison.",
      scope: { paths: ["src/team/**"], task_types: ["feature"] },
      source: { author: "Team", session: "s" },
      confidence: 0.8,
      policy: { visibility: "team", team_id: "team_b" },
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await compileProject(root);

  const userAllowed = await retrieveContext(root, { repo: "monkeys", path: "src/user/profile.ts", task: "feature", userId: "user_1" });
  const userHidden = await retrieveContext(root, { repo: "monkeys", path: "src/user/profile.ts", task: "feature", userId: "user_2" });
  assert.equal(userAllowed.hierarchy.user.some((rule) => rule.claim.includes("personal sandbox")), true);
  assert.equal(userHidden.hierarchy.user.some((rule) => rule.claim.includes("personal sandbox")), false);
  assert.equal(userHidden.hierarchy.user.some((rule) => rule.claim.includes("another user's sandbox")), true);

  const teamAllowed = await retrieveContext(root, { repo: "monkeys", path: "src/team/release.ts", task: "feature", teamId: "team_a" });
  const teamHidden = await retrieveContext(root, { repo: "monkeys", path: "src/team/release.ts", task: "feature", teamId: "team_b" });
  assert.equal(teamAllowed.hierarchy.team.some((rule) => rule.claim.includes("team release checklist")), true);
  assert.equal(teamHidden.hierarchy.team.some((rule) => rule.claim.includes("team release checklist")), false);
  assert.equal(teamHidden.hierarchy.team.some((rule) => rule.claim.includes("another team's checklist")), true);

  const simulation = await execFileAsync("node", [
    "scripts/simulate-memory.mjs",
    "--memory-root",
    root,
    "--workspace",
    root,
    "--repo",
    "monkeys",
    "--path",
    "src/user/profile.ts",
    "--task",
    "feature",
    "--user",
    "user_2",
    "--team",
    "team_b",
    "--template",
    "tpl_b",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  const simulationJson = JSON.parse(simulation.stdout);
  assert.equal(simulationJson.context.user_id, "user_2");
  assert.equal(simulationJson.context.team_id, "team_b");
  assert.equal(simulationJson.context.template_id, "tpl_b");
  assert.ok(simulationJson.hidden.some((item) => item.hidden_reasons.some((reason) => reason.includes("user user_2 does not match user_1"))));
  assert.ok(simulationJson.hidden.some((item) => item.hidden_reasons.some((reason) => reason.includes("team team_b does not match team_a"))));
});

test("feedback influences compile lifecycle and confidence", async () => {
  const root = await createFixtureProject();
  await compileProject(root);
  const rulesPath = path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "rules.json");
  const firstPack = JSON.parse(await fs.readFile(rulesPath, "utf8"));
  const ruleId = firstPack.rules[0].id;

  await execFileAsync("node", [
    "scripts/feedback-memory.mjs",
    "--memory-root",
    root,
    "--repo",
    "monkeys",
    "--id",
    ruleId,
    "--outcome",
    "outdated",
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });

  await compileProject(root);
  const secondPack = JSON.parse(await fs.readFile(rulesPath, "utf8"));
  assert.equal(secondPack.rules[0].lifecycle.state, "stale");
  assert.ok(secondPack.rules[0].confidence_score < firstPack.rules[0].confidence_score);
});

test("compile emits semantic relations and retrieval uses embedding explanation", async () => {
  const root = await createFixtureProject();
  await fs.writeFile(
    path.join(root, "memory.config.json"),
    `${JSON.stringify({
      org: "Inf-Monkeys",
      memoryRoot: ".monkeys-memory",
      onboardingRuleLimit: 10,
      runtimeRuleLimit: 5,
      fuzzyMergeThreshold: 1,
      embedding: { enabled: true },
    }, null, 2)}\n`,
  );
  const experienceDir = path.join(root, ".monkeys-memory", "repos", "monkeys", "experiences");
  await fs.writeFile(
    path.join(experienceDir, "similar.json"),
    `${JSON.stringify({
      id: "similar_1",
      org: "Inf-Monkeys",
      repo: "monkeys",
      title: "Adapter requirement alternate",
      claim: "Settlement updates should use the adapter path.",
      scope: { paths: ["src/settlement/**"], task_types: ["feature"] },
      source: { author: "Sim", session: "s" },
      confidence: 0.65,
      updated_at: "2026-03-25T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  await compileProject(root);
  const relations = JSON.parse(await fs.readFile(path.join(root, ".monkeys-memory", "repos", "monkeys", "compiled", "semantic-relations.json"), "utf8"));
  assert.ok(relations.relations.length >= 1);

  const context = await retrieveContext(root, { repo: "monkeys", path: "src/settlement/service.ts", task: "feature" });
  assert.ok(context.rules.some((rule) => rule.explanation.why.some((why) => why.includes("semantic similarity"))));
  assert.ok(context.rules.some((rule) => rule.explanation.why.some((why) => why.includes("vector index similarity"))));
});
