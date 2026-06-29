import { normalizeText, matchGlob } from '../../shared/utils.js';
import { extractClaimTokens } from './merger.js';
import type { CompiledRule } from '../../shared/types.js';

const NEGATION_WORDS = new Set(['not', 'never', 'avoid', "don't", 'do-not', 'dont', 'no']);
const AFFIRM_WORDS = new Set(['always', 'must', 'should', 'require', 'ensure']);

export function detectConflicts(rules: CompiledRule[]): void {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i], b = rules[j];

      // Check path overlap
      const pathsOverlap = a.scope.paths.some(pa =>
        b.scope.paths.some(pb => pa === pb || matchGlob(pa, pb) || matchGlob(pb, pa)),
      );
      if (!pathsOverlap) continue;

      // Check content similarity
      const contentA = new Set(extractClaimTokens(a.claim).filter(t => !NEGATION_WORDS.has(t) && !AFFIRM_WORDS.has(t)));
      const contentB = new Set(extractClaimTokens(b.claim).filter(t => !NEGATION_WORDS.has(t) && !AFFIRM_WORDS.has(t)));
      let intersection = 0;
      for (const t of contentA) { if (contentB.has(t)) intersection++; }
      const union = contentA.size + contentB.size - intersection;
      if (union === 0 || intersection / union < 0.3) continue;

      // Check negation vs affirmation
      const allA = normalizeText(a.claim).split(/\s+/).filter(t => t.length > 1);
      const allB = normalizeText(b.claim).split(/\s+/).filter(t => t.length > 1);
      const hasNegA = allA.some(t => NEGATION_WORDS.has(t));
      const hasNegB = allB.some(t => NEGATION_WORDS.has(t));
      const hasAffA = allA.some(t => AFFIRM_WORDS.has(t));
      const hasAffB = allB.some(t => AFFIRM_WORDS.has(t));

      if ((hasNegA && hasAffB && !hasNegB) || (hasNegB && hasAffA && !hasNegA)) {
        a.conflicts_with ??= [];
        b.conflicts_with ??= [];
        if (!a.conflicts_with.includes(b.id)) a.conflicts_with.push(b.id);
        if (!b.conflicts_with.includes(a.id)) b.conflicts_with.push(a.id);
      }
    }
  }
}
