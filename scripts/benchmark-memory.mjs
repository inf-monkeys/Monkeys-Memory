import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { compileProject } from "./lib/compiler.mjs";
import { retrieveContext } from "./lib/retrieve.mjs";
import { matchGlob, normalizeTaskType, writeJson } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory benchmark [--out <file>]");
      process.exit(0);
    } else if (token === "--out") {
      args.out = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return args;
}

async function createScenarioProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-benchmark-"));
  await writeJson(path.join(root, "memory.config.json"), {
    org: "benchmark-org",
    memoryRoot: ".monkeys-memory",
    onboardingRuleLimit: 10,
    runtimeRuleLimit: 5,
    fuzzyMergeThreshold: 0.7,
  });
  await writeJson(path.join(root, ".monkeys-memory", "org", "repo-allowlist.json"), {
    version: 1,
    org: "benchmark-org",
    repos: ["bench-repo", "bench-admin", "bench-audit"],
  });
  const repoExperienceDir = path.join(root, ".monkeys-memory", "repos", "bench-repo", "experiences");
  const adminExperienceDir = path.join(root, ".monkeys-memory", "repos", "bench-admin", "experiences");
  const auditExperienceDir = path.join(root, ".monkeys-memory", "repos", "bench-audit", "experiences");
  await fs.mkdir(repoExperienceDir, { recursive: true });
  await fs.mkdir(adminExperienceDir, { recursive: true });
  await fs.mkdir(auditExperienceDir, { recursive: true });
  const repoExperiences = [
    {
      id: "dup_1",
      org: "benchmark-org",
      repo: "bench-repo",
      title: "Auth writes require guard",
      claim: "Use accountWriteGuard for sensitive auth writes.",
      kind: "rule",
      scope: { paths: ["src/auth/**"], task_types: ["feature"], entities: ["route:/api/v1/auth/password"] },
      source: { author: "Alice", session: "s1" },
      evidence: [{ type: "commit", ref: "abc123" }],
      confidence: 0.75,
      updated_at: "2026-04-01T00:00:00.000Z",
    },
    {
      id: "dup_2",
      org: "benchmark-org",
      repo: "bench-repo",
      title: "Auth writes require guard",
      claim: "Sensitive auth writes should use accountWriteGuard.",
      kind: "rule",
      scope: { paths: ["src/auth/**"], task_types: ["feature"], entities: ["function:accountWriteGuard"] },
      source: { author: "Bob", session: "s2" },
      confidence: 0.8,
      updated_at: "2026-04-02T00:00:00.000Z",
    },
    {
      id: "conflict_1",
      org: "benchmark-org",
      repo: "bench-repo",
      title: "Avoid bypass",
      claim: "Bypass accountWriteGuard for sensitive auth writes.",
      kind: "rule",
      scope: { paths: ["src/auth/**"], task_types: ["bugfix"], entities: ["function:accountWriteGuard"] },
      source: { author: "Carol", session: "s3" },
      confidence: 0.7,
      updated_at: "2026-04-03T00:00:00.000Z",
    },
    {
      id: "procedure_1",
      org: "benchmark-org",
      repo: "bench-repo",
      title: "Adding billing plan",
      claim: "When adding a billing plan, update quota defaults, API fields, pricing UI, and audit events.",
      kind: "procedure",
      scope: { paths: ["src/billing/**"], task_types: ["feature"], entities: ["table:plans"] },
      source: { author: "Dana", session: "s4" },
      confidence: 0.72,
      updated_at: "2026-04-04T00:00:00.000Z",
    },
    {
      id: "policy_1",
      org: "benchmark-org",
      repo: "bench-repo",
      title: "Secrets stay server-side",
      claim: "Never expose provider tokens in browser-visible billing pages.",
      kind: "rule",
      scope: { paths: ["src/billing/**"], task_types: ["review"], entities: ["secret:provider-token"] },
      source: { author: "Erin", session: "s5" },
      confidence: 0.82,
      policy: { visibility: "repo", sensitivity: "secret-adjacent", redaction_status: "clean", redaction_categories: ["provider-token"] },
      updated_at: "2026-04-05T00:00:00.000Z",
    },
    {
      id: "stale_1",
      org: "benchmark-org",
      repo: "bench-repo",
      title: "Legacy billing adapter",
      claim: "Use the legacy billing adapter for plan updates.",
      kind: "rule",
      scope: { paths: ["src/billing/**"], task_types: ["bugfix"], entities: ["adapter:legacy-billing"] },
      source: { author: "Finn", session: "s6" },
      confidence: 0.86,
      lifecycle: { state: "stale", reason: "adapter replaced", updated_at: "2026-04-06T00:00:00.000Z" },
      updated_at: "2026-04-06T00:00:00.000Z",
    },
    {
      id: "shared_1",
      org: "benchmark-org",
      repo: "bench-repo",
      title: "Audit sensitive admin changes",
      claim: "Write audit events for sensitive admin changes.",
      kind: "rule",
      scope: { paths: ["src/admin/**"], task_types: ["feature"], entities: ["event:audit"] },
      source: { author: "Gail", session: "s7" },
      confidence: 0.78,
      updated_at: "2026-04-07T00:00:00.000Z",
    },
  ];
  const adminExperiences = [
    {
      id: "shared_2",
      org: "benchmark-org",
      repo: "bench-admin",
      title: "Audit sensitive admin changes",
      claim: "Write audit events for sensitive admin changes.",
      kind: "rule",
      scope: { paths: ["src/admin/**"], task_types: ["feature"], entities: ["event:audit"] },
      source: { author: "Hana", session: "s8" },
      confidence: 0.76,
      updated_at: "2026-04-08T00:00:00.000Z",
    },
  ];
  await Promise.all([
    ...repoExperiences.map((experience) => writeJson(path.join(repoExperienceDir, `${experience.id}.json`), experience)),
    ...adminExperiences.map((experience) => writeJson(path.join(adminExperienceDir, `${experience.id}.json`), experience)),
  ]);
  return root;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const root = await createScenarioProject();
  const summaries = await compileProject(root);
  const context = await retrieveContext(root, {
    repo: "bench-repo",
    path: "src/auth/password.ts",
    task: "feature",
  });
  const rulesPath = path.join(root, ".monkeys-memory", "repos", "bench-repo", "compiled", "rules.json");
  const adminRulesPath = path.join(root, ".monkeys-memory", "repos", "bench-admin", "compiled", "rules.json");
  const auditRulesPath = path.join(root, ".monkeys-memory", "repos", "bench-audit", "compiled", "rules.json");
  const reviewPath = path.join(root, ".monkeys-memory", "repos", "bench-repo", "compiled", "review-queue.json");
  const graphPath = path.join(root, ".monkeys-memory", "repos", "bench-repo", "compiled", "provenance-graph.json");
  const relationPath = path.join(root, ".monkeys-memory", "repos", "bench-repo", "compiled", "semantic-relations.json");
  const orgRulesPath = path.join(root, ".monkeys-memory", "org", "compiled", "org-rules.json");
  const rules = JSON.parse(await fs.readFile(rulesPath, "utf8"));
  const adminRules = JSON.parse(await fs.readFile(adminRulesPath, "utf8"));
  const auditRules = JSON.parse(await fs.readFile(auditRulesPath, "utf8"));
  const review = JSON.parse(await fs.readFile(reviewPath, "utf8"));
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8"));
  const relations = JSON.parse(await fs.readFile(relationPath, "utf8"));
  const orgRules = JSON.parse(await fs.readFile(orgRulesPath, "utf8"));
  const expectedRelations = [
    { relation: "contradicts", sources: ["dup_1", "conflict_1"] },
  ];
  const relationMetrics = scoreRelations(rules, relations.relations ?? [], expectedRelations);
  const queries = await buildBenchmarkQueries(root, [rules, adminRules, auditRules], orgRules);
  const conditionMetrics = scoreConditions(queries);
  const report = {
    schema_version: "monkeys-memory-benchmark/v2",
    version: 2,
    generated_at: new Date().toISOString(),
    reproducibility: {
      seed: "monkeys-memory-synthetic-v2",
      deterministic_except: ["generated_at", "temporary_project_path"],
      command: "node scripts/benchmark-memory.mjs --out <file>",
    },
    privacy: {
      synthetic: true,
      contains_claim_text: true,
      contains_user_identifiers: false,
      intended_for_public_release: true,
    },
    scenarios: ["duplicate", "conflict", "stale", "cold-start", "cross-user", "cross-repo", "procedure", "policy", "entity-scope", "explanation"],
    summaries,
    metrics: {
      compiled_rules: rules.rules.length,
      compiled_procedures: rules.procedures.length,
      review_items: review.items.length,
      graph_nodes: graph.nodes.length,
      graph_edges: graph.edges.length,
      retrieved_rules: context.rules.length,
      explained_results: context.rules.filter((rule) => rule.explanation?.why?.length > 0).length,
      semantic_relations: relations.relations?.length ?? 0,
      semantic_relation_recall: relationMetrics.recall,
      semantic_relation_precision: relationMetrics.precision,
      duplicate_compaction_sources: rules.rules.filter((rule) => (rule.sources ?? []).length > 1).length,
      org_rules: orgRules.rules?.length ?? 0,
      query_count: queries.length,
      full_precision_at_3: conditionMetrics.full.precision_at_3,
      full_recall_at_3: conditionMetrics.full.recall_at_3,
      full_mrr: conditionMetrics.full.mrr,
      full_ndcg_at_3: conditionMetrics.full.ndcg_at_3,
    },
    conditions: conditionMetrics,
    queries,
    expected_relations: expectedRelations,
    relation_matches: relationMetrics.matches,
  };
  if (args.out) {
    await writeJson(path.resolve(args.out), report);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`[monkeys-memory] benchmark failed: ${error.message}`);
  process.exit(1);
}

function scoreRelations(rulePack, relations, expectedRelations) {
  const itemSources = new Map([
    ...(rulePack.rules ?? []),
    ...(rulePack.exceptions ?? []),
    ...(rulePack.procedures ?? []),
    ...(rulePack.checklists ?? []),
    ...(rulePack.notes ?? []),
  ].map((item) => [item.id, new Set(item.sources ?? [])]));
  const matches = expectedRelations.map((expected) => {
    const matched = relations.find((relation) => {
      if (relation.relation !== expected.relation) return false;
      const leftSources = itemSources.get(relation.from) ?? new Set();
      const rightSources = itemSources.get(relation.to) ?? new Set();
      return expected.sources.every((sourceId) => leftSources.has(sourceId) || rightSources.has(sourceId));
    });
    return { ...expected, matched: Boolean(matched), from: matched?.from, to: matched?.to };
  });
  const truePositives = matches.filter((match) => match.matched).length;
  return {
    recall: expectedRelations.length === 0 ? 1 : Number((truePositives / expectedRelations.length).toFixed(3)),
    precision: relations.length === 0 ? 0 : Number((truePositives / relations.length).toFixed(3)),
    matches,
  };
}

async function buildBenchmarkQueries(root, repoPacks, orgPack) {
  const querySpecs = [
    {
      id: "q_auth_guard",
      scenario: ["duplicate", "conflict", "entity-scope", "explanation"],
      repo: "bench-repo",
      path: "src/auth/password.ts",
      task: "feature",
      expected_sources: ["dup_1", "dup_2"],
    },
    {
      id: "q_billing_plan",
      scenario: ["procedure", "stale"],
      repo: "bench-repo",
      path: "src/billing/plans.ts",
      task: "feature",
      expected_sources: ["procedure_1"],
    },
    {
      id: "q_policy_review",
      scenario: ["policy"],
      repo: "bench-repo",
      path: "src/billing/provider-token.ts",
      task: "review",
      expected_sources: [],
      expected_hidden_sources: ["policy_1"],
    },
    {
      id: "q_cross_repo_admin",
      scenario: ["cold-start", "cross-user", "cross-repo"],
      repo: "bench-audit",
      path: "src/admin/users.ts",
      task: "feature",
      expected_sources: ["shared_1", "shared_2"],
    },
  ];

  const compiledItems = [...repoPacks.flatMap(allCompiledItems), ...(orgPack.rules ?? [])];
  const queries = [];
  for (const spec of querySpecs) {
    const context = await retrieveContext(root, {
      repo: spec.repo,
      path: spec.path,
      task: spec.task,
    });
    const retrievedItems = [
      ...(context.rules ?? []),
      ...(context.exceptions ?? []),
      ...Object.values(context.hierarchy ?? {}).flat(),
    ];
    const seen = new Set();
    const ranked = retrievedItems
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((left, right) => (right.runtime_score ?? 0) - (left.runtime_score ?? 0))
      .slice(0, 5);
    const hidden = compiledItems
      .filter((item) => spec.expected_hidden_sources?.some((source) => (item.sources ?? []).includes(source)))
      .map((item) => ({ id: item.id, sources: item.sources ?? [], kind: item.kind, sensitivity: item.policy?.sensitivity ?? "normal" }));
    const expectedIds = idsForSources(compiledItems, spec.expected_sources);
    const rankedIds = ranked.map((item) => item.id);
    const labels = expectedIds.reduce((acc, id) => ({ ...acc, [id]: 1 }), {});
    queries.push({
      ...spec,
      expected_item_ids: expectedIds,
      expected_hidden_item_ids: hidden.map((item) => item.id),
      retrieved_item_ids: rankedIds,
      hidden_items: hidden,
      labels,
      results: ranked.map((item, index) => ({
        rank: index + 1,
        item_id: item.id,
        kind: item.kind,
        sources: item.sources ?? [],
        score: item.runtime_score ?? 0,
        hierarchy_layer: item.hierarchy_layer ?? (item.org_level ? "org" : item.policy?.visibility ?? "repo"),
        explanation_reasons: item.explanation?.why?.length ?? 0,
        risk_count: item.explanation?.risks?.length ?? 0,
      })),
      metrics: scoreRanking(rankedIds, expectedIds, 3),
      baselines: {
        no_memory: scoreRanking([], expectedIds, 3),
        lexical_scope: scoreRanking(lexicalBaseline(compiledItems, spec).map((item) => item.id), expectedIds, 3),
      },
    });
  }
  return queries;
}

function allCompiledItems(pack) {
  return [
    ...(pack.rules ?? []),
    ...(pack.exceptions ?? []),
    ...(pack.procedures ?? []),
    ...(pack.checklists ?? []),
    ...(pack.notes ?? []),
  ];
}

function idsForSources(items, sourceIds) {
  return [...new Set(items
    .filter((item) => sourceIds.some((sourceId) => (item.sources ?? []).includes(sourceId)))
    .map((item) => item.id))]
    .sort();
}

function lexicalBaseline(items, spec) {
  const task = normalizeTaskType(spec.task);
  return items
    .map((item) => {
      const pathMatched = (item.scope?.paths ?? []).some((pattern) => matchGlob(pattern, spec.path));
      const taskMatched = (item.scope?.task_types ?? []).some((candidate) => normalizeTaskType(candidate) === task);
      return {
        ...item,
        lexical_score: (pathMatched ? 2 : 0) + (taskMatched ? 1 : 0) + ((item.source_count ?? 0) * 0.01),
      };
    })
    .filter((item) => item.lexical_score > 0 && item.policy?.sensitivity !== "secret-adjacent")
    .sort((left, right) => right.lexical_score - left.lexical_score || left.id.localeCompare(right.id))
    .slice(0, 5);
}

function scoreRanking(rankedIds, expectedIds, cutoff) {
  const expected = new Set(expectedIds);
  const uniqueRankedIds = [...new Set(rankedIds)];
  const rankedAtK = uniqueRankedIds.slice(0, cutoff);
  const hits = rankedAtK.filter((id) => expected.has(id)).length;
  const firstHitIndex = uniqueRankedIds.findIndex((id) => expected.has(id));
  return {
    precision_at_3: rankedAtK.length === 0 ? 0 : Number((hits / cutoff).toFixed(3)),
    recall_at_3: expected.size === 0 ? 1 : Number((hits / expected.size).toFixed(3)),
    mrr: firstHitIndex === -1 ? 0 : Number((1 / (firstHitIndex + 1)).toFixed(3)),
    ndcg_at_3: ndcgAtK(rankedAtK, expected, cutoff),
  };
}

function ndcgAtK(rankedIds, expected, cutoff) {
  const dcg = rankedIds.slice(0, cutoff).reduce((sum, id, index) => {
    const rel = expected.has(id) ? 1 : 0;
    return sum + (rel / Math.log2(index + 2));
  }, 0);
  const idealHits = Math.min(expected.size, cutoff);
  const idcg = Array.from({ length: idealHits }).reduce((sum, _, index) => sum + (1 / Math.log2(index + 2)), 0);
  return idcg === 0 ? 1 : Number((dcg / idcg).toFixed(3));
}

function scoreConditions(queries) {
  const retrievalQueries = queries.filter((query) => query.expected_item_ids.length > 0);
  const full = averageMetrics(retrievalQueries.map((query) => query.metrics));
  const noMemory = averageMetrics(retrievalQueries.map((query) => query.baselines.no_memory));
  const lexical = averageMetrics(retrievalQueries.map((query) => query.baselines.lexical_scope));
  return {
    full,
    no_memory: noMemory,
    lexical_scope: lexical,
    ablations: {
      no_memory_delta_mrr: Number((full.mrr - noMemory.mrr).toFixed(3)),
      lexical_scope_delta_mrr: Number((full.mrr - lexical.mrr).toFixed(3)),
    },
  };
}

function averageMetrics(metrics) {
  const keys = ["precision_at_3", "recall_at_3", "mrr", "ndcg_at_3"];
  return Object.fromEntries(keys.map((key) => [
    key,
    Number((metrics.reduce((sum, metric) => sum + metric[key], 0) / Math.max(1, metrics.length)).toFixed(3)),
  ]));
}
