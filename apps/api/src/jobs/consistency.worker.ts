import { Worker } from 'bullmq';
import { closeRedis, getRedis } from '../config/redis.js';
import { AppDataSource } from '../database/ormconfig.js';
import { consistencyService } from '../modules/consistency/consistency.service.js';
import { logger } from '../shared/logger.js';

type ConsistencyJob =
  | { orgId: string; repoId: string }
  | { orgId: string; repoId?: undefined };

async function scanOrgRepos(orgId: string) {
  const rows = await AppDataSource.query(
    `SELECT id
       FROM "${orgId}_repos"
      WHERE allowlisted = true
        AND is_deleted = false
      ORDER BY created_at ASC`,
  ) as Array<{ id: string }>;

  const reports = [];
  for (const row of rows) {
    reports.push(await consistencyService.scanRepo(orgId, row.id));
  }
  return {
    repo_count: rows.length,
    finding_count: reports.reduce((sum, report) => sum + report.finding_count, 0),
  };
}

async function startConsistencyWorker() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    logger.info('Database connected');
  }

  const worker = new Worker(
    'consistency',
    async (job) => {
      const data = job.data as ConsistencyJob;
      logger.info('Consistency job started', { orgId: data.orgId, repoId: data.repoId ?? null });

      const result = data.repoId
        ? await consistencyService.scanRepo(data.orgId, data.repoId)
        : await scanOrgRepos(data.orgId);

      logger.info('Consistency job completed', { orgId: data.orgId, repoId: data.repoId ?? null, ...result });
      return result;
    },
    { connection: getRedis(), concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    logger.error('Consistency job failed', { jobId: job?.id, error: err.message });
  });

  const shutdown = async () => {
    logger.info('Shutting down consistency worker...');
    await worker.close();
    await closeRedis();
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });

  logger.info('Consistency worker started');
  return worker;
}

export const consistencyWorkerReady = startConsistencyWorker().catch(async (error) => {
  logger.error('Failed to start consistency worker', { error: (error as Error).message });
  await closeRedis().catch(() => {});
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy().catch(() => {});
  }
  process.exit(1);
});
