import { Worker } from 'bullmq';
import { closeRedis, getRedis } from '../config/redis.js';
import { AppDataSource } from '../database/ormconfig.js';
import { logger } from '../shared/logger.js';
import type { AuditEntry } from '../shared/types.js';

async function startAuditWorker() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    logger.info('Database connected');
  }

  const worker = new Worker(
    'audit',
    async (job) => {
      const { orgId, entry } = job.data as { orgId: string; entry: AuditEntry };

      await AppDataSource.query(
        `INSERT INTO "${orgId}_audit_logs" (user_id, action, resource_type, resource_id, metadata, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.user_id,
          entry.action,
          entry.resource_type ?? null,
          entry.resource_id ?? null,
          JSON.stringify(entry.metadata),
          entry.ip_address ?? null,
        ],
      );

      // Also update usage metrics
      const date = new Date().toISOString().slice(0, 10);
      const metricType = entry.action === 'retrieve' ? 'retrievals' : entry.action === 'capture' ? 'captures' : null;

      if (metricType) {
        const metricId = `${date}_${metricType}`;
        await AppDataSource.query(
          `INSERT INTO "${orgId}_usage_metrics" (id, date, metric_type, count, details)
           VALUES ($1, $2, $3, 1, '{}')
           ON CONFLICT (id) DO UPDATE SET count = "${orgId}_usage_metrics".count + 1`,
          [metricId, date, metricType],
        );
      }
    },
    { connection: getRedis(), concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    logger.error('Audit job failed', { jobId: job?.id, error: err.message });
  });

  const shutdown = async () => {
    logger.info('Shutting down audit worker...');
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

  logger.info('Audit worker started');
  return worker;
}

export const auditWorkerReady = startAuditWorker().catch(async (error) => {
  logger.error('Failed to start audit worker', { error: (error as Error).message });
  await closeRedis().catch(() => {});
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy().catch(() => {});
  }
  process.exit(1);
});
