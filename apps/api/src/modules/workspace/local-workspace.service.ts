import { AppDataSource } from '../../database/ormconfig.js';
import { OrgService } from '../../services/org.service.js';
import { BadRequestError, ForbiddenError } from '../../shared/errors.js';

export const LOCAL_USER_ID = 'user_local';
export const LOCAL_EMAIL = 'local@monkeys-memory.local';
export const LOCAL_NAME = 'Local Owner';
export const LOCAL_ORG_NAME = 'Local Workspace';

export interface LocalOrganizationSummary {
  id: string;
  name: string;
  role: 'owner';
  user_id: string;
  created_at?: string;
}

function assertLocalOrgId(orgId: string): string {
  const trimmed = orgId.trim();
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    throw new BadRequestError('Invalid X-Org-Id header');
  }
  return trimmed;
}

async function ensureLocalOwnerUser(orgId: string): Promise<string> {
  const safeOrgId = assertLocalOrgId(orgId);
  const rows = await AppDataSource.query(
    `SELECT id FROM "${safeOrgId}_users" WHERE id = $1 AND is_deleted = false LIMIT 1`,
    [LOCAL_USER_ID],
  ) as Array<{ id: string }>;

  if (rows[0]?.id) {
    await AppDataSource.query(
      `UPDATE "${safeOrgId}_users"
          SET role = 'owner',
              name = $1,
              email = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [LOCAL_NAME, LOCAL_EMAIL, rows[0].id],
    );
    return rows[0].id;
  }

  const emailRows = await AppDataSource.query(
    `SELECT id FROM "${safeOrgId}_users" WHERE email = $1 AND is_deleted = false LIMIT 1`,
    [LOCAL_EMAIL],
  ) as Array<{ id: string }>;

  if (emailRows[0]?.id) {
    await AppDataSource.query(
      `UPDATE "${safeOrgId}_users"
          SET role = 'owner',
              name = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [LOCAL_NAME, emailRows[0].id],
    );
    return emailRows[0].id;
  }

  await AppDataSource.query(
    `INSERT INTO "${safeOrgId}_users" (id, email, name, role)
     VALUES ($1, $2, $3, 'owner')
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           role = 'owner',
           is_deleted = false,
           updated_at = NOW()`,
    [LOCAL_USER_ID, LOCAL_EMAIL, LOCAL_NAME],
  );

  return LOCAL_USER_ID;
}

export class LocalWorkspaceService {
  async listOrganizations(): Promise<LocalOrganizationSummary[]> {
    await this.ensureDefaultOrganization();

    const rows = await AppDataSource.query(
      `SELECT id, name, created_at
         FROM orgs
        WHERE status = 'active'
          AND is_deleted = false
        ORDER BY created_at DESC`,
    ) as Array<{ id: string; name: string; created_at?: string }>;

    const organizations: LocalOrganizationSummary[] = [];
    for (const row of rows) {
      organizations.push({
        id: row.id,
        name: row.name,
        role: 'owner',
        user_id: await ensureLocalOwnerUser(row.id),
        created_at: row.created_at,
      });
    }

    return organizations;
  }

  async createOrganization(name: string): Promise<{ organization: LocalOrganizationSummary }> {
    const orgName = name.trim();
    const orgService = new OrgService();
    const { orgId } = await orgService.createOrg({
      name: orgName,
      ownerUser: {
        id: LOCAL_USER_ID,
        email: LOCAL_EMAIL,
        name: LOCAL_NAME,
        role: 'owner',
      },
    });

    return {
      organization: {
        id: orgId,
        name: orgName,
        role: 'owner',
        user_id: LOCAL_USER_ID,
      },
    };
  }

  async ensureDefaultOrganization(): Promise<LocalOrganizationSummary> {
    const rows = await AppDataSource.query(
      `SELECT id, name, created_at
         FROM orgs
        WHERE status = 'active'
          AND is_deleted = false
        ORDER BY created_at ASC
        LIMIT 1`,
    ) as Array<{ id: string; name: string; created_at?: string }>;

    if (rows[0]) {
      return {
        id: rows[0].id,
        name: rows[0].name,
        role: 'owner',
        user_id: await ensureLocalOwnerUser(rows[0].id),
        created_at: rows[0].created_at,
      };
    }

    const created = await this.createOrganization(LOCAL_ORG_NAME);
    return created.organization;
  }

  async resolveOrganization(orgId?: string): Promise<LocalOrganizationSummary> {
    if (!orgId?.trim()) {
      return this.ensureDefaultOrganization();
    }

    const rows = await AppDataSource.query(
      `SELECT id, name, created_at
         FROM orgs
        WHERE id = $1
          AND status = 'active'
          AND is_deleted = false
        LIMIT 1`,
      [assertLocalOrgId(orgId)],
    ) as Array<{ id: string; name: string; created_at?: string }>;

    if (!rows[0]) throw new ForbiddenError('Organization not found');

    return {
      id: rows[0].id,
      name: rows[0].name,
      role: 'owner',
      user_id: await ensureLocalOwnerUser(rows[0].id),
      created_at: rows[0].created_at,
    };
  }
}

export const localWorkspaceService = new LocalWorkspaceService();
