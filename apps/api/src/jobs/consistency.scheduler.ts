import { closeRedis } from '../config/redis.js';
import { env } from '../config/env.js';
import { AppDataSource } from '../database/ormconfig.js';
import { getConsistencyQueue } from './queue.js';
import { logger } from '../shared/logger.js';

type OrgRow = {
  id: string;
};

async function syncConsistencySchedules(): Promise<{ scheduled: number; disabled: boolean }> {
  if (!env.consistency.scheduleEnabled) {
    logger.info('Consistency scheduler disabled');
    return { scheduled: 0, disabled: true };
  }

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    logger.info('Database connected');
  }

  const rows = await AppDataSource.query(
    `SELECT id
       FROM orgs
      WHERE status = 'active'
        AND is_deleted = false
      ORDER BY created_at ASC`,
  ) as OrgRow[];

  const queue = getConsistencyQueue();
  for (const row of rows) {
    await queue.add(
      'scan-org',
      { orgId: row.id },
      {
        jobId: `consistency-scan-org-${row.id}`,
        repeat: { pattern: env.consistency.scheduleCron },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }

  logger.info('Consistency schedules synced', { scheduled: rows.length, cron: env.consistency.scheduleCron });
  return { scheduled: rows.length, disabled: false };
}

async function startConsistencyScheduler() {
  const result = await syncConsistencySchedules();

  const shutdown = async () => {
    logger.info('Shutting down consistency scheduler...');
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

  logger.info('Consistency scheduler started', result);
  return result;
}

export const consistencySchedulerReady = startConsistencyScheduler().catch(async (error) => {
  logger.error('Failed to start consistency scheduler', { error: (error as Error).message });
  await closeRedis().catch(() => {});
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy().catch(() => {});
  }
  process.exit(1);
});
