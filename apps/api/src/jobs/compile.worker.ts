import { Worker } from 'bullmq';
import { closeRedis, getRedis } from '../config/redis.js';
import { AppDataSource } from '../database/ormconfig.js';
import { compilerService } from '../modules/compiler/compiler.service.js';
import { logger } from '../shared/logger.js';

async function startCompileWorker() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    logger.info('Database connected');
  }

  const worker = new Worker(
    'compile',
    async (job) => {
      const { orgId, repoId } = job.data;
      logger.info('Compile job started', { orgId, repoId });

      const result = await compilerService.compileRepo(orgId, repoId);

      // Also compile org-level rules
      await compilerService.compileOrgRules(orgId);

      logger.info('Compile job completed', { orgId, repoId, ...result });
      return result;
    },
    { connection: getRedis(), concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    logger.error('Compile job failed', { jobId: job?.id, error: err.message });
  });

  const shutdown = async () => {
    logger.info('Shutting down compile worker...');
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

  logger.info('Compile worker started');
  return worker;
}

export const compileWorkerReady = startCompileWorker().catch(async (error) => {
  logger.error('Failed to start compile worker', { error: (error as Error).message });
  await closeRedis().catch(() => {});
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy().catch(() => {});
  }
  process.exit(1);
});
