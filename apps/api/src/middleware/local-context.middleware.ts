import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError, ForbiddenError } from '../shared/errors.js';
import type { WorkspaceContext } from '../shared/types.js';
import { localWorkspaceService } from '../modules/workspace/local-workspace.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    workspace: WorkspaceContext;
  }
}

/** Resolve the local organization and owner user. */
export async function localContextMiddleware(req: FastifyRequest): Promise<void> {
  const orgIdHeader = typeof req.headers['x-org-id'] === 'string' ? req.headers['x-org-id'] : undefined;
  const organization = await localWorkspaceService.resolveOrganization(orgIdHeader);

  req.workspace = {
    orgId: organization.id,
    userId: organization.user_id,
    role: 'owner',
  };
}

export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.workspace) throw new UnauthorizedError();
    if (!roles.includes(req.workspace.role)) {
      throw new ForbiddenError(`Requires role: ${roles.join(' or ')}`);
    }
  };
}
