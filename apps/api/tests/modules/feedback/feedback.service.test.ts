import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  generateId: vi.fn(() => 'fb_fixed'),
  capture: vi.fn(),
  compileRepo: vi.fn(),
  compileOrgRules: vi.fn(),
}));

vi.mock('../../../src/database/ormconfig.js', () => ({
  AppDataSource: { query: mocks.query },
}));

vi.mock('../../../src/shared/utils.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/shared/utils.js')>('../../../src/shared/utils.js');
  return { ...actual, generateId: mocks.generateId };
});

vi.mock('../../../src/modules/capture/capture.service.js', () => ({
  captureService: {
    capture: mocks.capture,
  },
}));

vi.mock('../../../src/modules/compiler/compiler.service.js', () => ({
  compilerService: {
    compileRepo: mocks.compileRepo,
    compileOrgRules: mocks.compileOrgRules,
  },
}));

const { FeedbackService } = await import('../../../src/modules/feedback/feedback.service.js');

describe('FeedbackService memory repair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deprecates source experiences when direct feedback marks a rule outdated', async () => {
    mocks.query
      .mockResolvedValueOnce([{
        content: {
          rules: [{
            id: 'rule_1',
            sources: ['exp_1', 'exp_2'],
          }],
          exceptions: [],
        },
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.compileRepo.mockResolvedValueOnce({ ruleCount: 0, exceptionCount: 0 });
    mocks.compileOrgRules.mockResolvedValueOnce(0);

    const service = new FeedbackService();
    await expect(service.addFeedback('org_local', 'user_local', 'repo_1', 'rule_1', {
      outcome: 'outdated',
      note: 'The local repo now uses the new runtime boundary.',
    })).resolves.toMatchObject({
      id: 'fb_fixed',
      status: 'recorded',
      repair_action: 'deprecated',
    });

    expect(mocks.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE "org_local_experiences"'),
      expect.arrayContaining([
        expect.stringContaining('"state":"deprecated"'),
        '[]',
        'repo_1',
        ['exp_1', 'exp_2'],
      ]),
    );
    expect(mocks.compileRepo).toHaveBeenCalledWith('org_local', 'repo_1');
    expect(mocks.compileOrgRules).toHaveBeenCalledWith('org_local');
  });

  it('captures a correction and supersedes outdated source experiences', async () => {
    mocks.generateId.mockReturnValueOnce('fb_agent_1');
    mocks.capture.mockResolvedValueOnce({ id: 'exp_corrected', status: 'active' });
    mocks.query
      .mockResolvedValueOnce([{ id: 'repo_1' }])
      .mockResolvedValueOnce([{
        content: {
          rules: [{
            id: 'rule_old',
            kind: 'rule',
            title: 'Old runtime rule',
            claim: 'Compute owns model credentials',
            scope: { paths: ['apps/api/src/runtime/**'], task_types: ['feature'] },
            confidence_score: 0.72,
            sources: ['exp_old'],
          }],
          exceptions: [],
          procedures: [],
          checklists: [],
          notes: [],
        },
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.compileRepo.mockResolvedValueOnce({ ruleCount: 1, exceptionCount: 0 });
    mocks.compileOrgRules.mockResolvedValueOnce(0);

    const service = new FeedbackService();
    await expect(service.addAgentEvaluation('org_local', 'user_local', {
      repo: 'monkeys-memory',
      evaluations: [{
        rule_id: 'rule_old',
        outcome: 'outdated',
        adopted: false,
        confidence: 0.93,
        note: 'Kernel owns credentials now.',
        evidence: ['npm test passed'],
        correction: {
          title: 'Kernel owns credentials',
          claim: 'Keep model and credential management in Kernel; Compute only receives compatibility fields.',
        },
      }],
    })).resolves.toMatchObject({
      status: 'recorded',
      recorded_count: 1,
      items: [{ correction_experience_id: 'exp_corrected' }],
    });

    expect(mocks.capture).toHaveBeenCalledWith('org_local', 'user_local', expect.objectContaining({
      repo: 'monkeys-memory',
      title: 'Kernel owns credentials',
      claim: 'Keep model and credential management in Kernel; Compute only receives compatibility fields.',
      scope: { paths: ['apps/api/src/runtime/**'], task_types: ['feature'] },
      relationships: { supersedes: ['exp_old'] },
      lifecycle: expect.objectContaining({ state: 'active', reason: 'agent:correction' }),
    }));
    expect(mocks.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE "org_local_experiences"'),
      expect.arrayContaining([
        expect.stringContaining('"state":"superseded"'),
        '["exp_corrected"]',
        'repo_1',
        ['exp_old'],
      ]),
    );
  });
});
