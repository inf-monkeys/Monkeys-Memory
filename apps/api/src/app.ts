import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config/env.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';
import { retrieveRoutes } from './modules/retrieve/retrieve.controller.js';
import { captureRoutes } from './modules/capture/capture.controller.js';
import { feedbackRoutes } from './modules/feedback/feedback.controller.js';
import { reviewRoutes } from './modules/review/review.controller.js';
import { policyRoutes } from './modules/policy/policy.controller.js';
import { trajectoryRoutes } from './modules/trajectory/trajectory.controller.js';
import { consistencyRoutes } from './modules/consistency/consistency.controller.js';
import { agentActionRoutes } from './modules/agent-actions/agent-actions.controller.js';
import { orgRoutes } from './modules/admin/org.controller.js';
import { repoRoutes } from './modules/admin/repo.controller.js';
import { memberRoutes } from './modules/admin/member.controller.js';
import { auditRoutes } from './modules/admin/audit.controller.js';
import { analyticsRoutes } from './modules/admin/analytics.controller.js';

export async function buildApp() {
  const app = Fastify({ logger: false, trustProxy: true });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || env.auth.allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'same-origin' },
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok' }));

  // Mount product routes. The open-source local product runs with a default
  // local owner and no public account browser surface.
  await retrieveRoutes(app);
  await captureRoutes(app);
  await feedbackRoutes(app);
  await reviewRoutes(app);
  await policyRoutes(app);
  await trajectoryRoutes(app);
  await consistencyRoutes(app);
  await agentActionRoutes(app);
  await orgRoutes(app);
  await repoRoutes(app);
  await memberRoutes(app);
  await auditRoutes(app);
  await analyticsRoutes(app);

  // Error handler
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    return reply.status(500).send({ error: 'Internal server error' });
  });

  return app;
}
