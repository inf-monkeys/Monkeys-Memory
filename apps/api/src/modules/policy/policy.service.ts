import { AppDataSource } from '../../database/ormconfig.js';
import type { CompiledRule, RetrieveRequest, RulePack } from '../../shared/types.js';
import { evaluateMemoryPolicy } from './policy-engine.js';

type RepoRow = {
  id: string;
  name: string;
};

type ExperiencePolicyRow = {
  redaction_status: string | null;
  sensitivity: string | null;
  count: string;
};

type CompiledRow = {
  repo_id: string;
  repo_name: string;
  content: RulePack | string;
  compiled_at: string;
};

function parseRulePack(content: RulePack | string): RulePack & { review_queue?: { items?: Array<{ id: string; reason: string; priority: string; claim: string }> } } {
  return typeof content === 'string' ? JSON.parse(content) as RulePack : content;
}

function allItems(pack: RulePack): CompiledRule[] {
  return [
    ...(pack.rules ?? []),
    ...(pack.exceptions ?? []),
    ...(pack.procedures ?? []),
    ...(pack.checklists ?? []),
    ...(pack.notes ?? []),
  ];
}

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? '0'), 10) || 0;
}

export class PolicyService {
  async overview(orgId: string) {
    const policyRows = await AppDataSource.query(
      `SELECT
          COALESCE(policy ->> 'redaction_status', 'not_scanned') as redaction_status,
          COALESCE(policy ->> 'sensitivity', 'normal') as sensitivity,
          COUNT(*) as count
         FROM "${orgId}_experiences"
        WHERE is_deleted = false
        GROUP BY redaction_status, sensitivity`,
    ) as ExperiencePolicyRow[];

    const compiledRows = await AppDataSource.query(
      `SELECT cr.repo_id, r.name as repo_name, cr.content, cr.compiled_at
         FROM "${orgId}_compiled_rules" cr
         JOIN "${orgId}_repos" r ON r.id = cr.repo_id
        WHERE cr.rule_type = 'repo'
          AND cr.is_deleted = false
          AND r.is_deleted = false
        ORDER BY cr.repo_id, cr.version DESC`,
    ) as CompiledRow[];

    const latest = new Map<string, CompiledRow & { pack: ReturnType<typeof parseRulePack> }>();
    for (const row of compiledRows) {
      if (!latest.has(row.repo_id)) latest.set(row.repo_id, { ...row, pack: parseRulePack(row.content) });
    }

    const sensitiveItems = [];
    const reviewItems = [];
    const redactionCategoryCounts: Record<string, number> = {};
    for (const [repoId, row] of latest) {
      const pack = row.pack;
      for (const item of allItems(pack)) {
        for (const category of item.policy?.redaction_categories ?? []) {
          redactionCategoryCounts[category] = (redactionCategoryCounts[category] ?? 0) + 1;
        }
        if (item.policy?.sensitivity && item.policy.sensitivity !== 'normal') {
          sensitiveItems.push({
            id: item.id,
            repo_id: repoId,
            repo_name: row.repo_name,
            kind: item.kind,
            claim: item.claim,
            sensitivity: item.policy.sensitivity,
            redaction_status: item.policy.redaction_status ?? 'not_scanned',
            redaction_categories: item.policy.redaction_categories ?? [],
            source_count: item.source_count,
            lifecycle: item.lifecycle,
          });
        }
      }
      for (const reviewItem of pack.review_queue?.items ?? []) {
        if (reviewItem.reason === 'policy-sensitive') {
          reviewItems.push({
            ...reviewItem,
            repo_id: repoId,
            repo_name: row.repo_name,
            compiled_at: row.compiled_at,
          });
        }
      }
    }

    return {
      experience_policy_counts: policyRows.map(row => ({
        redaction_status: row.redaction_status ?? 'not_scanned',
        sensitivity: row.sensitivity ?? 'normal',
        count: toInt(row.count),
      })),
      sensitive_memory_count: sensitiveItems.length,
      policy_review_count: reviewItems.length,
      redaction_category_counts: redactionCategoryCounts,
      sensitive_items: sensitiveItems.slice(0, 50),
      review_items: reviewItems.slice(0, 50),
    };
  }

  async simulateRetrieve(orgId: string, req: RetrieveRequest) {
    const repos = await AppDataSource.query(
      `SELECT id, name FROM "${orgId}_repos" WHERE name = $1 AND is_deleted = false AND allowlisted = true LIMIT 1`,
      [req.repo],
    ) as RepoRow[];
    if (repos.length === 0) {
      return { enabled: false, reason: 'repo not in allowlist', repo: req.repo, allowed: [], hidden: [], summary: { allowed: 0, hidden: 0, reasons: {} } };
    }

    const rows = await AppDataSource.query(
      `SELECT content FROM "${orgId}_compiled_rules"
       WHERE repo_id = $1 AND rule_type = 'repo' AND is_deleted = false
       ORDER BY version DESC LIMIT 1`,
      [repos[0].id],
    ) as Array<{ content: RulePack | string }>;
    if (rows.length === 0) {
      return { enabled: true, repo: req.repo, allowed: [], hidden: [], summary: { allowed: 0, hidden: 0, reasons: {} } };
    }

    const pack = parseRulePack(rows[0].content);
    const allowed = [];
    const hidden = [];
    const reasons: Record<string, number> = {};

    for (const item of allItems(pack)) {
      const decision = evaluateMemoryPolicy(item, req);
      const entry = {
        id: item.id,
        kind: item.kind,
        claim: item.claim,
        sensitivity: item.policy?.sensitivity ?? 'normal',
        redaction_status: item.policy?.redaction_status ?? 'not_scanned',
        redaction_categories: item.policy?.redaction_categories ?? [],
        lifecycle: item.lifecycle,
        validity: item.validity,
      };
      if (decision.allowed) {
        allowed.push(entry);
      } else {
        for (const reason of decision.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
        hidden.push({ ...entry, reasons: decision.reasons });
      }
    }

    return {
      enabled: true,
      repo: req.repo,
      request: {
        path: req.path ?? null,
        task: req.task ?? null,
        branch: req.branch ?? null,
        tag: req.tag ?? null,
        commit: req.commit ?? null,
        user_id: req.user_id ?? null,
        team_id: req.team_id ?? null,
        template_id: req.template_id ?? null,
        include_sensitive: Boolean(req.include_sensitive),
      },
      allowed,
      hidden,
      summary: {
        allowed: allowed.length,
        hidden: hidden.length,
        reasons,
      },
    };
  }
}

export const policyService = new PolicyService();
