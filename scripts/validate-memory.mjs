import path from "node:path";
import { getAllowedRepos } from "./lib/allowlist.mjs";
import { allCompiledItems, discoverCodeEntities, loadCompiledPack, writeAnalysis } from "./lib/local-analysis.mjs";
import { pathExists, readConfig } from "./lib/utils.mjs";

function parseArgs(argv) {
  const args = { repo: null, workspace: process.cwd(), format: "json", memoryRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      console.log("Usage: monkeys-memory validate-memory [--memory-root <dir>] [--repo <repo>] [--workspace <repo-dir>] [--format json|table]");
      process.exit(0);
    } else if (token === "--repo") { args.repo = argv[++i] ?? null; }
    else if (token === "--workspace") { args.workspace = argv[++i] ?? args.workspace; }
    else if (token === "--format") { args.format = argv[++i] ?? "json"; }
    else if (token === "--memory-root") { args.memoryRoot = argv[++i] ?? null; }
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.memoryRoot ? path.resolve(args.memoryRoot) : path.resolve(path.join(import.meta.dirname, ".."));
  const config = await readConfig(projectRoot);
  const allowedRepos = await getAllowedRepos(projectRoot);
  const repos = args.repo ? allowedRepos.filter((repo) => repo === args.repo) : allowedRepos;
  const workspace = path.resolve(args.workspace);
  const findings = [];
  const codeEntities = await discoverCodeEntities(workspace, { maxFiles: config.codeEntities?.maxFiles ?? 600 });
  const entityDefinitionMap = new Map();
  for (const entity of codeEntities) {
    const definitions = entityDefinitionMap.get(entity.id) ?? [];
    definitions.push(entity);
    entityDefinitionMap.set(entity.id, definitions);
  }

  for (const repo of repos) {
    const pack = await loadCompiledPack(projectRoot, config, repo);
    for (const item of allCompiledItems(pack)) {
      for (const scopePath of item.scope.paths ?? []) {
        const concrete = scopePath.replace(/\/?\*\*.*$/, "").replace(/\*.*$/, "");
        if (!concrete || concrete === ".") continue;
        if (!(await pathExists(path.join(workspace, concrete)))) {
          findings.push({ repo, id: item.id, reason: "missing-scope-path", scope: scopePath, claim: item.claim });
        }
      }
      for (const entityId of item.scope.entities ?? []) {
        const definitions = entityDefinitionMap.get(entityId) ?? [];
        if (definitions.length === 0) {
          findings.push({ repo, id: item.id, reason: "missing-entity-definition", entity: entityId, claim: item.claim });
          continue;
        }
        const scopedDefinitions = definitions.filter((definition) =>
          (item.scope.paths ?? []).some((scopePath) => definition.path === scopePath || definition.path.startsWith(scopePath.replace(/\/?\*\*.*$/, ""))),
        );
        if (scopedDefinitions.length === 0) {
          findings.push({
            repo,
            id: item.id,
            reason: "entity-outside-scope",
            entity: entityId,
            definitions: definitions.map((definition) => `${definition.path}:${definition.line}`),
            claim: item.claim,
          });
        }
      }
    }
    await writeAnalysis(projectRoot, config, repo, "consistency-report.json", {
      version: 1,
      generated_at: new Date().toISOString(),
      workspace,
      discovered_entity_count: codeEntities.length,
      findings: findings.filter((finding) => finding.repo === repo),
    });
  }

  if (args.format === "table") {
    if (findings.length === 0) console.log("No memory consistency findings.");
    else findings.forEach((finding) => console.log(`${finding.repo} ${finding.id} ${finding.reason} ${finding.scope}`));
  } else {
    console.log(JSON.stringify({ version: 1, generated_at: new Date().toISOString(), findings }, null, 2));
  }
} catch (error) {
  console.error(`[monkeys-memory] validate-memory failed: ${error.message}`);
  process.exit(1);
}
