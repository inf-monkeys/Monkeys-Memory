import crypto from 'node:crypto';

// --- Text normalization ---

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function slugify(text: string): string {
  return normalizeText(text).replace(/\s+/g, '-').slice(0, 80);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const TASK_ALIASES: Record<string, string> = {
  fix: 'bugfix', bug: 'bugfix', bugfix: 'bugfix',
  hotfix: 'hotfix',
  refactor: 'refactor', cleanup: 'refactor',
  feat: 'feature', feature: 'feature',
  review: 'review', cr: 'review',
};

export function normalizeTaskType(task: string): string {
  return TASK_ALIASES[task.toLowerCase().trim()] ?? task.toLowerCase().trim();
}

const EVIDENCE_ALIASES: Record<string, string> = {
  mr: 'merge_request', 'merge-request': 'merge_request', merge_request: 'merge_request',
  pr: 'pull_request', 'pull-request': 'pull_request', pull_request: 'pull_request',
  commit: 'commit', doc: 'doc', issue: 'issue',
};

export function normalizeEvidenceType(t: string): string {
  return EVIDENCE_ALIASES[t.toLowerCase().trim()] ?? t.toLowerCase().trim();
}

// --- Glob matching (ported from local version) ---

export function matchGlob(pattern: string, target: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(target);
}

function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += pattern[i + 2] === '/' ? 3 : 2;
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '[') {
      const close = pattern.indexOf(']', i);
      if (close === -1) { re += '\\['; i++; }
      else { re += pattern.slice(i, close + 1); i = close + 1; }
    } else if ('.+^${}()|\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

export function specificity(pattern: string): number {
  if (pattern === '**' || pattern === '**/*') return 0;
  return pattern.split('/').filter(s => !s.includes('*')).length;
}

// --- Confidence ---

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function confidenceBucket(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

// --- Sorting ---

export function uniqueSorted(arr: string[]): string[] {
  return [...new Set(arr)].sort();
}

export function maxIsoDate(dates: (string | undefined)[]): string {
  const valid = dates.filter(Boolean) as string[];
  if (valid.length === 0) return new Date().toISOString();
  return valid.sort().pop()!;
}

// --- Hashing ---

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function generateId(prefix: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '_');
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${date}_${rand}`;
}

// --- Task type inference from commit message ---

export function inferTaskType(message: string): string {
  const lower = message.toLowerCase();
  if (/\bfix(es|ed)?\b/.test(lower) || /\bbug\b/.test(lower)) return 'bugfix';
  if (/\bhotfix\b/.test(lower)) return 'hotfix';
  if (/\brefactor\b/.test(lower)) return 'refactor';
  if (/\bfeat(ure)?\b/.test(lower)) return 'feature';
  if (/\breview\b/.test(lower)) return 'review';
  return 'feature';
}
