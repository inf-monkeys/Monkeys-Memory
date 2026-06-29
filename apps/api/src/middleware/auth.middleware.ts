import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError, ForbiddenError } from '../shared/errors.js';
import type { AccountContext, AuthContext } from '../shared/types.js';
import { LOCAL_ACCOUNT_ID, localAuthService } from '../modules/auth/local-auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
    account: AccountContext;
  }
}

/** Attach the local owner account used by this local product. */
export async function accountAuthMiddleware(req: FastifyRequest): Promise<void> {
  await localAuthService.ensureDefaultOrganization();
  req.account = { accountId: LOCAL_ACCOUNT_ID };
}

export async function accountWriteGuard(_req: FastifyRequest): Promise<void> {
  return;
}

export async function accountRecentReauthGuard(_req: FastifyRequest): Promise<void> {
  return;
}

/** Resolve the local organization and owner user. */
export async function authMiddleware(req: FastifyRequest): Promise<void> {
  const orgIdHeader = typeof req.headers['x-org-id'] === 'string' ? req.headers['x-org-id'] : undefined;
  const organization = await localAuthService.resolveOrganization(orgIdHeader);

  req.account = { accountId: LOCAL_ACCOUNT_ID };
  req.auth = {
    orgId: organization.id,
    userId: organization.user_id,
    role: 'owner',
    accountId: LOCAL_ACCOUNT_ID,
  };
}

/** Require specific roles */
export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.auth) throw new UnauthorizedError();
    if (!roles.includes(req.auth.role)) {
      throw new ForbiddenError(`Requires role: ${roles.join(' or ')}`);
    }
  };
}
