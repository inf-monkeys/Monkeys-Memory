import type { CompiledRule, RetrieveRequest } from '../../shared/types.js';

export type PolicyDecision = {
  allowed: boolean;
  reasons: string[];
};

export function evaluateMemoryPolicy(rule: CompiledRule, req: RetrieveRequest): PolicyDecision {
  const reasons: string[] = [];

  if (rule.policy?.redaction_status === 'blocked') {
    reasons.push('redaction-blocked');
  }
  if (rule.policy?.sensitivity === 'secret-adjacent' && !req.include_sensitive) {
    reasons.push('secret-adjacent-hidden');
  }
  if (rule.policy?.visibility === 'user' && rule.policy.user_id && rule.policy.user_id !== req.user_id) {
    reasons.push('user-visibility-mismatch');
  }
  if (rule.policy?.visibility === 'team' && rule.policy.team_id && rule.policy.team_id !== req.team_id) {
    reasons.push('team-visibility-mismatch');
  }
  if (rule.policy?.template_id && rule.policy.template_id !== req.template_id) {
    reasons.push('template-mismatch');
  }
  if (req.branch) {
    const branches = rule.validity?.branches ?? [];
    if (branches.length > 0 && !branches.includes(req.branch)) {
      reasons.push('branch-mismatch');
    }
  }
  if (req.tag) {
    const tags = rule.validity?.tags ?? [];
    if (tags.length > 0 && !tags.includes(req.tag)) {
      reasons.push('tag-mismatch');
    }
  }
  if (req.commit) {
    const fromCommit = rule.validity?.valid_from_commit ?? null;
    const untilCommit = rule.validity?.valid_until_commit ?? null;
    if (fromCommit && req.commit.localeCompare(fromCommit) < 0) {
      reasons.push('commit-before-validity');
    }
    if (untilCommit && req.commit.localeCompare(untilCommit) > 0) {
      reasons.push('commit-after-validity');
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}
