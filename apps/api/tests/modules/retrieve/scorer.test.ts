import { describe, expect, it } from 'vitest';
import { explainRule } from '../../../src/modules/retrieve/scorer.js';
import type { CompiledRule } from '../../../src/shared/types.js';

function makeRule(overrides: Partial<CompiledRule>): CompiledRule {
  return {
    id: 'rule_1',
    kind: 'rule',
    title: 'Rule',
    claim: 'Validate before process',
    scope: { paths: ['src/**'], task_types: ['bugfix'] },
    confidence: 'high',
    confidence_score: 0.75,
    source_count: 2,
    evidence_count: 1,
    updated_at: '2026-03-29T00:00:00.000Z',
    sources: ['exp_1'],
    ...overrides,
  };
}

describe('retrieve/scorer retired memory', () => {
  it('retires deprecated, superseded, and stale memory from runtime retrieval', () => {
    for (const state of ['deprecated', 'superseded', 'stale'] as const) {
      const result = explainRule(makeRule({ lifecycle: { state } }), 'src/service.ts', 'bugfix');

      expect(result.score).toBe(0);
      expect(result.explanation.risks).toContain('memory is retired from runtime retrieval');
    }
  });
});
