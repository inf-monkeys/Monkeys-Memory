import { AppDataSource } from './database/ormconfig.js';
import { buildApp } from './app.js';
import { assertSecureProductionConfig, env } from './config/env.js';
import { closeRedis } from './config/redis.js';
import { closeQueues } from './jobs/queue.js';
import { logger } from './shared/logger.js';

async function main() {
  try {
    assertSecureProductionConfig();

    // Initialize database
    await AppDataSource.initialize();
    logger.info('Database connected');

    // Build and start Fastify app
    const app = await buildApp();
    await app.listen({ port: env.port, host: env.host });
    logger.info(`Server listening on ${env.host}:${env.port}`);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await app.close();
      await closeQueues();
      await closeRedis();
      await AppDataSource.destroy();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
}

main();
