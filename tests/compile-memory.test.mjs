import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { compileProject } from "../scripts/lib/compiler.mjs";
import { formatContextMarkdown, retrieveContext } from "../scripts/lib/retrieve.mjs";
import { detectAffectedRepos, syncProject } from "../scripts/lib/sync.mjs";

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
  assert.match(markdown, /Relevant Rules/);
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
