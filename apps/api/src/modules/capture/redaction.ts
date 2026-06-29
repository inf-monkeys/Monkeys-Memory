import type { CaptureRequest, MemoryPolicy, RedactionSeverity } from '../../shared/types.js';

export type RedactionFinding = {
  type: 'generic-secret' | 'private-key' | 'email' | 'github-token' | 'openai-key' | 'slack-token' | 'aws-access-key' | 'jwt' | 'ipv4-address' | 'phone-number';
  field: 'title' | 'claim' | 'evidence.ref';
  count: number;
  severity: RedactionSeverity;
};

export type RedactionResult = {
  request: CaptureRequest;
  findings: RedactionFinding[];
  policy: MemoryPolicy;
};

type Pattern = {
  type: RedactionFinding['type'];
  regex: RegExp;
  replacement: string;
  severity: RedactionSeverity;
};

const PATTERNS: Pattern[] = [
  {
    type: 'private-key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
    severity: 'high',
  },
  {
    type: 'github-token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
    severity: 'high',
  },
  {
    type: 'openai-key',
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_OPENAI_KEY]',
    severity: 'high',
  },
  {
    type: 'slack-token',
    regex: /\bxox(?:b|p|o|a|r|s)-[A-Za-z0-9-]{20,}\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
    severity: 'high',
  },
  {
    type: 'aws-access-key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_ACCESS_KEY]',
    severity: 'high',
  },
  {
    type: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED_JWT]',
    severity: 'high',
  },
  {
    type: 'generic-secret',
    regex: /\b(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{12,}/gi,
    replacement: '$1=[REDACTED_SECRET]',
    severity: 'high',
  },
  {
    type: 'email',
    regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    replacement: '[REDACTED_EMAIL]',
    severity: 'medium',
  },
  {
    type: 'phone-number',
    regex: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,
    replacement: '[REDACTED_PHONE]',
    severity: 'medium',
  },
  {
    type: 'ipv4-address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[REDACTED_IP]',
    severity: 'low',
  },
];

function redactField(value: string, field: RedactionFinding['field']): { value: string; findings: RedactionFinding[] } {
  let next = value;
  const findings: RedactionFinding[] = [];
  for (const pattern of PATTERNS) {
    const matches = [...next.matchAll(pattern.regex)];
    if (matches.length === 0) continue;
    findings.push({ type: pattern.type, field, count: matches.length, severity: pattern.severity });
    next = next.replace(pattern.regex, pattern.replacement);
  }
  return { value: next, findings };
}

export function scanAndRedactCapture(req: CaptureRequest): RedactionResult {
  const title = redactField(req.title, 'title');
  const claim = redactField(req.claim, 'claim');
  const evidence = (req.evidence ?? []).map((item) => {
    const ref = redactField(item.ref, 'evidence.ref');
    return { item: { ...item, ref: ref.value }, findings: ref.findings };
  });
  const findings = [
    ...title.findings,
    ...claim.findings,
    ...evidence.flatMap(item => item.findings),
  ];
  const hasSecret = findings.some(finding => finding.severity === 'high');
  const hasAny = findings.length > 0;
  const categories = [...new Set(findings.map(finding => finding.type))].sort();
  const policy: MemoryPolicy = {
    visibility: req.policy?.visibility ?? 'repo',
    sensitivity: hasSecret ? 'secret-adjacent' : req.policy?.sensitivity ?? (hasAny ? 'internal' : 'normal'),
    redaction_status: hasAny ? 'redacted' : req.policy?.redaction_status ?? 'clean',
  };
  if (categories.length > 0) policy.redaction_categories = categories;
  if (req.policy?.user_id) policy.user_id = req.policy.user_id;
  if (req.policy?.team_id) policy.team_id = req.policy.team_id;
  if (req.policy?.template_id) policy.template_id = req.policy.template_id;

  return {
    request: {
      ...req,
      title: title.value,
      claim: claim.value,
      evidence: evidence.map(item => item.item),
      policy,
    },
    findings,
    policy,
  };
}
