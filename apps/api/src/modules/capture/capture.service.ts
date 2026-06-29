import { AppDataSource } from '../../database/ormconfig.js';
import { clamp, generateId, sha256, inferTaskType } from '../../shared/utils.js';
import { getCompileQueue } from '../../jobs/queue.js';
import type { CaptureRequest, AutoCaptureRequest } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';
import { BadRequestError } from '../../shared/errors.js';
import { scanAndRedactCapture } from './redaction.js';

export class CaptureService {
  async capture(orgId: string, userId: string, req: CaptureRequest) {
    const redaction = scanAndRedactCapture(req);
    const sanitized = redaction.request;
    // Find repo — must already exist
    const repos = await AppDataSource.query(
      `SELECT id FROM "${orgId}_repos" WHERE name = $1 AND is_deleted = false`,
      [sanitized.repo],
    );

    if (repos.length === 0) {
      throw new BadRequestError(`Repository "${sanitized.repo}" is not registered. Ask an admin to add it first.`);
    }

    const repoId = repos[0].id;

    const expId = generateId('exp');
    const now = new Date().toISOString();
    const contentHash = sha256(sanitized.claim);
    const lifecycle = sanitized.lifecycle ?? { state: 'active', updated_at: now };
    const provenance = {
      ...(sanitized.provenance ?? {}),
      source_type: sanitized.provenance?.source_type ?? 'manual',
      author: sanitized.provenance?.author ?? userId,
      redaction_findings: redaction.findings,
    };
    const policy = redaction.policy;
    const validity = sanitized.validity ?? { branches: [], valid_from_commit: null, valid_until_commit: null, tags: [] };
    const confidence = clamp(sanitized.confidence ?? 0.7, 0, 1);

    await AppDataSource.query(
      `INSERT INTO "${orgId}_experiences"
       (id, repo_id, author_id, title, claim, kind, scope, evidence, confidence, status, source_type, content_hash, lifecycle, provenance, relationships, policy, validity, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 'manual', $10, $11, $12, $13, $14, $15, $16, $16)`,
      [
        expId,
        repoId,
        userId,
        sanitized.title,
        sanitized.claim,
        sanitized.kind ?? 'rule',
        JSON.stringify(sanitized.scope),
        JSON.stringify(sanitized.evidence ?? []),
        confidence,
        contentHash,
        JSON.stringify(lifecycle),
        JSON.stringify(provenance),
        JSON.stringify(sanitized.relationships ?? {}),
        JSON.stringify(policy),
        JSON.stringify(validity),
        now,
      ],
    );

    // Trigger async compile (debounced 30s per org/repo pair)
    getCompileQueue().add('compile', { orgId, repoId }, {
      delay: 30000,
      removeOnComplete: true,
      deduplication: {
        id: `${orgId}:${repoId}`,
        ttl: 30000,
        extend: true,
        replace: true,
      },
    }).catch(() => {});

    logger.info('Captured experience', { orgId, repoId, expId, userId, redactionFindings: redaction.findings.length });
    return { id: expId, status: 'active', redaction_findings: redaction.findings };
  }

  async autoCapture(orgId: string, userId: string, req: AutoCaptureRequest) {
    const firstLine = req.commit_message.split('\n')[0].trim();
    const title = firstLine.slice(0, 80) || 'Auto-captured experience';
    const body = req.commit_message.split('\n').slice(1).join(' ').trim();
    const claim = body || firstLine || 'Auto-captured from recent commit.';

    const paths = req.changed_files.length > 0
      ? [...new Set(req.changed_files.map(f => {
          const dir = f.split('/').slice(0, -1).join('/');
          return dir ? `${dir}/**` : '**';
        }))]
      : ['**'];

    const taskType = inferTaskType(req.commit_message);

    return this.capture(orgId, userId, {
      repo: req.repo,
      title,
      claim,
      scope: { paths, task_types: [taskType] },
      kind: 'rule',
      evidence: [],
    });
  }
}

export const captureService = new CaptureService();
