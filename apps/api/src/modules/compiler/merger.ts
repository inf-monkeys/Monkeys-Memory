import { normalizeText, matchGlob, uniqueSorted, normalizeTaskType } from '../../shared/utils.js';
import type { Experience } from '../../shared/types.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'in', 'for', 'of', 'and', 'or', 'not', 'no',
  'should', 'must', 'always', 'never', 'do', 'does',
  'it', 'its', 'this', 'that', 'with', 'from', 'by', 'on', 'at',
]);

export function extractClaimTokens(claim: string): string[] {
  return normalizeText(claim)
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function makeGroupKey(exp: Experience): string {
  const kind = exp.kind ?? 'rule';
  const paths = uniqueSorted(exp.scope.paths).join('|');
  const tasks = uniqueSorted((exp.scope.task_types ?? []).map(normalizeTaskType)).join('|');
  return [kind, normalizeText(exp.claim), paths, tasks].join('::');
}

export function mergeGroupsByFuzzyClaim(
  grouped: Map<string, Experience[]>,
  threshold: number,
): Map<string, Experience[]> {
  if (threshold >= 1.0) return grouped;

  const keys = [...grouped.keys()];
  const parent = new Map<string, string>();
  for (const key of keys) parent.set(key, key);

  function find(k: string): string {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)!)!);
      k = parent.get(k)!;
    }
    return k;
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const tokenCache = new Map<string, Set<string>>();
  for (const key of keys) {
    const bucket = grouped.get(key)!;
    tokenCache.set(key, new Set(extractClaimTokens(bucket[0].claim)));
  }

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [kindA] = keys[i].split('::');
      const [kindB] = keys[j].split('::');
      if (kindA !== kindB) continue;

      const tokensA = tokenCache.get(keys[i])!;
      const tokensB = tokenCache.get(keys[j])!;
      if (jaccardSimilarity(tokensA, tokensB) >= threshold) {
        const pathsA = uniqueSorted(grouped.get(keys[i])!.flatMap(e => e.scope.paths));
        const pathsB = uniqueSorted(grouped.get(keys[j])!.flatMap(e => e.scope.paths));
        const hasOverlap = pathsA.some(pa =>
          pathsB.some(pb => pa === pb || matchGlob(pa, pb) || matchGlob(pb, pa)),
        );
        if (hasOverlap) union(keys[i], keys[j]);
      }
    }
  }

  const merged = new Map<string, Experience[]>();
  for (const key of keys) {
    const root = find(key);
    const bucket = merged.get(root) ?? [];
    bucket.push(...grouped.get(key)!);
    merged.set(root, bucket);
  }
  return merged;
}
