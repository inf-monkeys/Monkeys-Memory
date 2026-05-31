import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureRepoInitialized } from "./repo-init.mjs";
import { compileRepo } from "./compiler.mjs";
import { getRepoCompiledStatus } from "./staleness.mjs";
import { matchGlob, pathExists, readJson, uniqueSorted, writeJson } from "./utils.mjs";

const execFileAsync = promisify(execFile);

export async function runGit(workspace, args) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: workspace, encoding: "utf8" });
    return stdout.trim();
  } catch {
    return "";
  }
}

export function detectSensitiveText(value) {
  const text = JSON.stringify(value);
  const findings = [];
  const patterns = [
    { type: "private-key", severity: "high", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
    { type: "github-token", severity: "high", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g },
    { type: "openai-key", severity: "high", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
    { type: "slack-token", severity: "high", regex: /\bxox(?:b|p|o|a|r|s)-[A-Za-z0-9-]{20,}\b/g },
    { type: "aws-access-key", severity: "high", regex: /\bAKIA[0-9A-Z]{16}\b/g },
    { type: "jwt", severity: "high", regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
    { type: "generic-secret", severity: "high", regex: /(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{12,}/gi },
    { type: "email", severity: "medium", regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
    { type: "phone-number", severity: "medium", regex: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g },
    { type: "ipv4-address", severity: "low", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern.regex);
    if (matches?.length) {
      findings.push({ type: pattern.type, severity: pattern.severity, count: matches.length });
    }
  }
  return findings;
}

export async function loadCompiledPack(projectRoot, config, repoName) {
  const { compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repoName);
  const rulesPath = path.join(compiledDir, "rules.json");
  const status = await getRepoCompiledStatus(projectRoot, repoName);
  if (!(await pathExists(rulesPath)) || status.stale) {
    await compileRepo(projectRoot, repoName);
  }
  return readJson(rulesPath);
}

export async function loadReviewQueue(projectRoot, config, repoName) {
  const { compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repoName);
  const queuePath = path.join(compiledDir, "review-queue.json");
  if (!(await pathExists(queuePath))) {
    await compileRepo(projectRoot, repoName);
  }
  return (await readJson(queuePath)).items ?? [];
}

export function allCompiledItems(pack) {
  return [
    ...(pack.rules ?? []),
    ...(pack.exceptions ?? []),
    ...(pack.procedures ?? []),
    ...(pack.checklists ?? []),
    ...(pack.notes ?? []),
  ];
}

export async function writeAnalysis(projectRoot, config, repoName, fileName, value) {
  const { compiledDir } = await ensureRepoInitialized(projectRoot, config.memoryRoot, repoName);
  const filePath = path.join(compiledDir, fileName);
  await writeJson(filePath, value);
  return filePath;
}

export function scopedItemsForPath(items, changedPath) {
  return items.filter((item) => item.scope?.paths?.some((scopePath) => matchGlob(scopePath, changedPath) || matchGlob(changedPath, scopePath)));
}

export function classifySemanticRelation(left, right) {
  const stopWords = new Set(["the", "a", "an", "is", "are", "to", "in", "for", "of", "and", "or", "should", "must", "always", "never", "do", "does", "use", "through", "first", "when", "before", "after", "with", "without", "into", "from", "by", "on"]);
  const a = String(left.claim ?? "").toLowerCase();
  const b = String(right.claim ?? "").toLowerCase();
  const neg = /\b(never|avoid|do not|don't|no|without)\b/;
  const aff = /\b(always|must|should|require|ensure|use)\b/;
  const enforce = /\b(use|require|requires|required|ensure|apply|call|route|validate|verify|check|guard|protect|enforce)\b/;
  const bypass = /\b(skip|bypass|bypassing|avoid|disable|remove|omit|ignore|without)\b/;
  const supersede = /\b(replace|replaces|replaced|instead|new|v2|supersede|supersedes|migrate|migration)\b/;
  const actionWords = new Set(["use", "require", "requires", "required", "ensure", "apply", "call", "route", "validate", "verify", "check", "guard", "protect", "enforce", "skip", "bypass", "bypassing", "avoid", "disable", "remove", "omit", "ignore", "replace", "replaces", "replaced", "instead", "new", "migrate", "migration", "v2"]);
  const tokensA = new Set(a.split(/[^a-z0-9]+/).map(normalizeSemanticToken).filter((token) => token.length > 2 && !stopWords.has(token)));
  const tokensB = new Set(b.split(/[^a-z0-9]+/).map(normalizeSemanticToken).filter((token) => token.length > 2 && !stopWords.has(token)));
  const objectTokensA = new Set([...tokensA].filter((token) => !actionWords.has(token)));
  const objectTokensB = new Set([...tokensB].filter((token) => !actionWords.has(token)));
  const similarity = setJaccard(tokensA, tokensB);
  const objectSimilarity = setJaccard(objectTokensA, objectTokensB);
  const semanticSimilarity = Math.max(similarity, objectSimilarity);
  const sameScope = (left.scope?.paths ?? []).some((pa) => (right.scope?.paths ?? []).some((pb) => pa === pb || matchGlob(pa, pb) || matchGlob(pb, pa)));
  const supersession = classifySupersession(left, right, semanticSimilarity);
  if (supersession) return supersession;
  const actionA = supersede.test(a) ? "replace" : bypass.test(a) ? "bypass" : enforce.test(a) ? "enforce" : "other";
  const actionB = supersede.test(b) ? "replace" : bypass.test(b) ? "bypass" : enforce.test(b) ? "enforce" : "other";
  const polarityA = neg.test(a) ? "negate" : aff.test(a) ? "affirm" : "neutral";
  const polarityB = neg.test(b) ? "negate" : aff.test(b) ? "affirm" : "neutral";
  const oppositeAction = (actionA === "enforce" && actionB === "bypass") || (actionA === "bypass" && actionB === "enforce");
  const oppositePolarity = (polarityA === "negate" && polarityB === "affirm") || (polarityA === "affirm" && polarityB === "negate");
  if (sameScope && objectSimilarity >= 0.22 && (oppositeAction || oppositePolarity)) {
    return { relation: "contradicts", confidence: Number(Math.min(0.95, semanticSimilarity + 0.35).toFixed(2)) };
  }
  if (sameScope && (similarity >= 0.72 || (actionA === actionB && objectSimilarity >= 0.62 && polarityA === polarityB))) {
    return { relation: "duplicates", confidence: Number(semanticSimilarity.toFixed(2)) };
  }
  if (semanticSimilarity >= 0.45 && (left.scope?.paths ?? []).length < (right.scope?.paths ?? []).length) return { relation: "generalizes", confidence: Number(semanticSimilarity.toFixed(2)) };
  if (semanticSimilarity >= 0.45 && (left.scope?.paths ?? []).length > (right.scope?.paths ?? []).length) return { relation: "specializes", confidence: Number(semanticSimilarity.toFixed(2)) };
  if (sameScope && semanticSimilarity >= 0.2) return { relation: "related_to", confidence: Number(semanticSimilarity.toFixed(2)) };
  if (semanticSimilarity >= 0.35) return { relation: "related_to", confidence: Number(semanticSimilarity.toFixed(2)) };
  return { relation: "unrelated", confidence: Number(semanticSimilarity.toFixed(2)) };
}

function setJaccard(left, right) {
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  const union = left.size + right.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

function normalizeSemanticToken(token) {
  if (token === "reauthentication" || token === "reauthenticate") return "reauth";
  if (token === "changes" || token === "changed" || token === "changing") return "change";
  if (token === "settings" || token === "setting") return "config";
  if (token === "checks" || token === "checking") return "check";
  if (token === "updates" || token === "updated" || token === "updating") return "update";
  return token;
}

function classifySupersession(left, right, similarity) {
  const newerThan = (a, b) => new Date(a.updated_at ?? 0).getTime() > new Date(b.updated_at ?? 0).getTime();
  const a = String(left.claim ?? "").toLowerCase();
  const b = String(right.claim ?? "").toLowerCase();
  const supersedeTerms = /\b(replace|replaces|replaced|instead|new|v2|supersede|supersedes|migrate|migration)\b/;
  const leftPaths = left.scope?.paths ?? [];
  const rightPaths = right.scope?.paths ?? [];
  const sameOrOverlappingScope = leftPaths.some((pa) => rightPaths.some((pb) => pa === pb || matchGlob(pa, pb) || matchGlob(pb, pa)));
  if (!sameOrOverlappingScope || similarity < 0.25) return null;
  if (supersedeTerms.test(a) && newerThan(left, right)) {
    return { relation: "supersedes", confidence: Number(Math.min(0.92, similarity + 0.3).toFixed(2)) };
  }
  if (supersedeTerms.test(b) && newerThan(right, left)) {
    return { relation: "superseded_by", confidence: Number(Math.min(0.92, similarity + 0.3).toFixed(2)) };
  }
  return null;
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) return 0;
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += left[i] * right[i];
    normA += left[i] * left[i];
    normB += right[i] * right[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function summarizeTrajectory(events) {
  const filesRead = new Set();
  const filesEdited = new Set();
  const commands = [];
  let failedTests = 0;
  let passedTests = 0;
  for (const event of events) {
    if (event.type === "read" && event.path) filesRead.add(event.path);
    if (event.type === "edit" && event.path) filesEdited.add(event.path);
    if (event.type === "command" && event.command) commands.push(event.command);
    if (event.type === "test" && event.status === "failed") failedTests += 1;
    if (event.type === "test" && event.status === "passed") passedTests += 1;
  }
  return {
    files_read: [...filesRead].sort(),
    files_edited: [...filesEdited].sort(),
    commands,
    failed_tests: failedTests,
    passed_tests: passedTests,
  };
}

const CODE_FILE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".rb", ".php"]);

export async function discoverCodeEntities(workspaceRoot, options = {}) {
  const root = options.workspace ?? workspaceRoot;
  const maxFiles = options.maxFiles ?? 600;
  const entities = [];
  let seenFiles = 0;

  async function walk(dir) {
    if (seenFiles >= maxFiles) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seenFiles >= maxFiles) return;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".monkeys-memory" || entry.name === "dist" || entry.name === "build") {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !CODE_FILE_EXTENSIONS.has(path.extname(entry.name))) continue;
      seenFiles += 1;
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      const text = await fs.readFile(fullPath, "utf8").catch(() => "");
      entities.push(...extractCodeEntitiesFromText(text, relativePath));
    }
  }

  await walk(root);
  return entities.sort((left, right) => left.id.localeCompare(right.id));
}

export function extractCodeEntitiesFromText(text, filePath) {
  const entities = [];
  const add = (kind, name, line) => {
    if (!name) return;
    entities.push({ id: `${kind}:${name}`, kind, name, path: filePath, line });
  };
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = lines[i];
    for (const match of line.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) add("function", match[1], lineNo);
    for (const match of line.matchAll(/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g)) add("class", match[1], lineNo);
    for (const match of line.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)) add("function", match[1], lineNo);
    for (const match of line.matchAll(/\b(?:app|router|server)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g)) add("route", `${match[1].toUpperCase()} ${match[2]}`, lineNo);
    for (const match of line.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][\w]*)["`]?/gi)) add("table", match[1], lineNo);
  }
  return entities;
}

export function inferEntitiesForMemory(item, codeEntities) {
  const claim = String(item.claim ?? "").toLowerCase();
  const title = String(item.title ?? "").toLowerCase();
  const paths = item.scope?.paths ?? [];
  const inferred = [];
  for (const entity of codeEntities) {
    const entityPathMatches = paths.some((scopePath) => matchGlob(scopePath, entity.path) || matchGlob(entity.path, scopePath));
    const name = entity.name.toLowerCase();
    const compactName = name.replace(/[^a-z0-9]+/g, "");
    const textMatches = claim.includes(name) || title.includes(name) || claim.replace(/[^a-z0-9]+/g, "").includes(compactName);
    if (entityPathMatches && (textMatches || paths.length === 1)) inferred.push(entity.id);
  }
  return uniqueSorted(inferred).slice(0, 12);
}
