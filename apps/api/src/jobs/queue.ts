import { Queue, Worker } from 'bullmq';
import { getRedis } from '../config/redis.js';
import { logger } from '../shared/logger.js';

const connection = getRedis();

// Compile queue
const compileQueue = new Queue('compile', { connection });

// Audit queue
const auditQueue = new Queue('audit', { connection });

// Consistency scan queue
const consistencyQueue = new Queue('consistency', { connection });

export function getCompileQueue() {
  return compileQueue;
}

export function getAuditQueue() {
  return auditQueue;
}

export function getConsistencyQueue() {
  return consistencyQueue;
}

export async function closeQueues() {
  await compileQueue.close();
  await auditQueue.close();
  await consistencyQueue.close();
}
