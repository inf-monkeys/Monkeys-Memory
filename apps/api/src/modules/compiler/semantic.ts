import { matchGlob, uniqueSorted } from '../../shared/utils.js';
import type { CompiledRule, SemanticRelation } from '../../shared/types.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'in', 'for', 'of', 'and', 'or',
  'should', 'must', 'always', 'never', 'do', 'does', 'use', 'through', 'first',
  'when', 'before', 'after', 'with', 'without', 'into', 'from', 'by', 'on',
]);

const ENFORCE_TERMS = /\b(use|require|requires|required|ensure|apply|call|route|validate|verify|check|guard|protect|enforce)\b/;
const BYPASS_TERMS = /\b(skip|bypass|bypassing|avoid|disable|remove|omit|ignore|without)\b/;
const SUPERSEDE_TERMS = /\b(replace|replaces|replaced|instead|new|v2|supersede|supersedes|migrate|migration)\b/;
const NEGATION_TERMS = /\b(never|avoid|do not|don't|no|without)\b/;
const AFFIRMATION_TERMS = /\b(always|must|should|require|ensure|use)\b/;

type SemanticFeatures = {
  tokens: Set<string>;
  objectTokens: Set<string>;
  action: 'enforce' | 'bypass' | 'replace' | 'other';
  polarity: 'affirm' | 'negate' | 'neutral';
};

function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .split(/[^a-z0-9]+/)
      .map(normalizeSemanticToken)
      .filter(token => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function normalizeSemanticToken(token: string): string {
  if (token === 'reauthentication' || token === 'reauthenticate') return 'reauth';
  if (token === 'changes' || token === 'changed' || token === 'changing') return 'change';
  if (token === 'settings' || token === 'setting') return 'config';
  if (token === 'checks' || token === 'checking') return 'check';
  if (token === 'updates' || token === 'updated' || token === 'updating') return 'update';
  return token;
}

function semanticFeatures(text: string): SemanticFeatures {
  const normalized = text.toLowerCase();
  const tokenSet = tokens(normalized);
  const action = SUPERSEDE_TERMS.test(normalized)
    ? 'replace'
    : BYPASS_TERMS.test(normalized)
      ? 'bypass'
      : ENFORCE_TERMS.test(normalized)
        ? 'enforce'
        : 'other';
  const polarity = NEGATION_TERMS.test(normalized)
    ? 'negate'
    : AFFIRMATION_TERMS.test(normalized)
      ? 'affirm'
      : 'neutral';
  const actionWords = new Set(['use', 'require', 'requires', 'required', 'ensure', 'apply', 'call', 'route', 'validate', 'verify', 'check', 'guard', 'protect', 'enforce', 'skip', 'bypass', 'bypassing', 'avoid', 'disable', 'remove', 'omit', 'ignore', 'replace', 'replaces', 'replaced', 'instead', 'new', 'migrate', 'migration', 'v2']);
  const objectTokens = new Set([...tokenSet].filter(token => !actionWords.has(token)));
  return { tokens: tokenSet, objectTokens, action, polarity };
}

function jaccard(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  const union = left.size + right.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

function scopesOverlap(left: CompiledRule, right: CompiledRule): boolean {
  return (left.scope.paths ?? []).some(pa =>
    (right.scope.paths ?? []).some(pb => pa === pb || matchGlob(pa, pb) || matchGlob(pb, pa)),
  );
}

export function classifySemanticRelation(left: CompiledRule, right: CompiledRule): Pick<SemanticRelation, 'relation' | 'confidence'> {
  const a = left.claim.toLowerCase();
  const b = right.claim.toLowerCase();
  const leftFeatures = semanticFeatures(a);
  const rightFeatures = semanticFeatures(b);
  const similarity = jaccard(leftFeatures.tokens, rightFeatures.tokens);
  const objectSimilarity = jaccard(leftFeatures.objectTokens, rightFeatures.objectTokens);
  const semanticSimilarity = Math.max(similarity, objectSimilarity);
  const sameScope = scopesOverlap(left, right);
  const leftNewer = new Date(left.updated_at).getTime() > new Date(right.updated_at).getTime();
  const rightNewer = new Date(right.updated_at).getTime() > new Date(left.updated_at).getTime();
  const oppositeAction = (leftFeatures.action === 'enforce' && rightFeatures.action === 'bypass')
    || (leftFeatures.action === 'bypass' && rightFeatures.action === 'enforce');
  const oppositePolarity = (leftFeatures.polarity === 'negate' && rightFeatures.polarity === 'affirm')
    || (leftFeatures.polarity === 'affirm' && rightFeatures.polarity === 'negate');

  if (sameScope && semanticSimilarity >= 0.25 && SUPERSEDE_TERMS.test(a) && leftNewer) {
    return { relation: 'supersedes', confidence: Number(Math.min(0.92, semanticSimilarity + 0.3).toFixed(2)) };
  }
  if (sameScope && semanticSimilarity >= 0.25 && SUPERSEDE_TERMS.test(b) && rightNewer) {
    return { relation: 'superseded_by', confidence: Number(Math.min(0.92, semanticSimilarity + 0.3).toFixed(2)) };
  }
  if (sameScope && objectSimilarity >= 0.22 && (oppositeAction || oppositePolarity)) {
    return { relation: 'contradicts', confidence: Number(Math.min(0.95, semanticSimilarity + 0.35).toFixed(2)) };
  }
  if (sameScope && (similarity >= 0.72 || (leftFeatures.action === rightFeatures.action && objectSimilarity >= 0.62 && leftFeatures.polarity === rightFeatures.polarity))) {
    return { relation: 'duplicates', confidence: Number(semanticSimilarity.toFixed(2)) };
  }
  if (semanticSimilarity >= 0.45 && left.scope.paths.length < right.scope.paths.length) return { relation: 'generalizes', confidence: Number(semanticSimilarity.toFixed(2)) };
  if (semanticSimilarity >= 0.45 && left.scope.paths.length > right.scope.paths.length) return { relation: 'specializes', confidence: Number(semanticSimilarity.toFixed(2)) };
  if (sameScope && semanticSimilarity >= 0.2) return { relation: 'related_to', confidence: Number(semanticSimilarity.toFixed(2)) };
  if (semanticSimilarity >= 0.35) return { relation: 'related_to', confidence: Number(semanticSimilarity.toFixed(2)) };
  return { relation: 'unrelated', confidence: Number(semanticSimilarity.toFixed(2)) };
}

export function attachSemanticRelation(left: CompiledRule, right: CompiledRule, relation: SemanticRelation['relation']) {
  left.relationships ??= {};
  right.relationships ??= {};
  const push = (target: CompiledRule, field: keyof NonNullable<CompiledRule['relationships']>, value: string) => {
    target.relationships![field] = uniqueSorted([...(target.relationships![field] ?? []), value]);
  };

  if (relation === 'duplicates' || relation === 'related_to') {
    push(left, 'related_to', right.id);
    push(right, 'related_to', left.id);
  } else if (relation === 'contradicts') {
    push(left, 'contradicts', right.id);
    push(right, 'contradicts', left.id);
  } else if (relation === 'supersedes') {
    push(left, 'supersedes', right.id);
    push(right, 'superseded_by', left.id);
  } else if (relation === 'superseded_by') {
    push(left, 'superseded_by', right.id);
    push(right, 'supersedes', left.id);
  } else if (relation === 'generalizes') {
    push(left, 'generalizes', right.id);
    push(right, 'specializes', left.id);
  } else if (relation === 'specializes') {
    push(left, 'specializes', right.id);
    push(right, 'generalizes', left.id);
  }
}

export function buildSemanticRelations(rulePack: { repo_name?: string; rules?: CompiledRule[]; exceptions?: CompiledRule[]; procedures?: CompiledRule[]; checklists?: CompiledRule[]; notes?: CompiledRule[] }): SemanticRelation[] {
  const items = [
    ...(rulePack.rules ?? []),
    ...(rulePack.exceptions ?? []),
    ...(rulePack.procedures ?? []),
    ...(rulePack.checklists ?? []),
    ...(rulePack.notes ?? []),
  ];
  const relations: SemanticRelation[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const relation = classifySemanticRelation(items[i], items[j]);
      if (relation.relation === 'unrelated') continue;
      attachSemanticRelation(items[i], items[j], relation.relation);
      relations.push({
        repo: rulePack.repo_name,
        from: items[i].id,
        to: items[j].id,
        relation: relation.relation,
        confidence: relation.confidence,
      });
    }
  }
  return relations;
}
