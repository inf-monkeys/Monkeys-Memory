import { getAuditQueue } from '../../jobs/queue.js';

export function enqueueAccountAudit(
  accountId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown>,
  ipAddress?: string | null,
) {
  getAuditQueue().add('audit', {
    orgId: 'account',
    entry: {
      user_id: accountId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata,
      ip_address: ipAddress ?? '',
    },
  }).catch(() => {});
}
