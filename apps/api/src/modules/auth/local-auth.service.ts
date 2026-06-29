import { AppDataSource } from '../../database/ormconfig.js';
import { OrgService } from '../../services/org.service.js';
import { BadRequestError, ForbiddenError } from '../../shared/errors.js';

export const LOCAL_ACCOUNT_ID = 'acct_local';
export const LOCAL_USER_ID = 'user_local';
export const LOCAL_EMAIL = 'local@monkeys-memory.local';
export const LOCAL_NAME = 'Local Owner';
export const LOCAL_ORG_NAME = 'Local Workspace';
const LOCAL_EMAIL_ID = 'aem_local';

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

async function ensureLocalAccount(): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO accounts (id, email, name, plan, primary_email)
     VALUES ($1, $2, $3, 'community', $2)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           plan = EXCLUDED.plan,
           primary_email = EXCLUDED.primary_email,
           is_deleted = false,
           updated_at = NOW()`,
    [LOCAL_ACCOUNT_ID, LOCAL_EMAIL, LOCAL_NAME],
  );

  await AppDataSource.query(
    `INSERT INTO account_emails (id, account_id, email, is_primary, is_verified, verified_at)
     VALUES ($1, $2, $3, true, true, NOW())
     ON CONFLICT (email) DO UPDATE
       SET account_id = EXCLUDED.account_id,
           is_primary = true,
           is_verified = true,
           verified_at = COALESCE(account_emails.verified_at, NOW()),
           is_deleted = false,
           updated_at = NOW()`,
    [LOCAL_EMAIL_ID, LOCAL_ACCOUNT_ID, LOCAL_EMAIL],
  );
}

async function ensureLocalOwnerUser(orgId: string): Promise<string> {
  const safeOrgId = assertLocalOrgId(orgId);
  const rows = await AppDataSource.query(
    `SELECT id FROM "${safeOrgId}_users" WHERE account_id = $1 AND is_deleted = false LIMIT 1`,
    [LOCAL_ACCOUNT_ID],
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
          SET account_id = $1,
              role = 'owner',
              name = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [LOCAL_ACCOUNT_ID, LOCAL_NAME, emailRows[0].id],
    );
    return emailRows[0].id;
  }

  await AppDataSource.query(
    `INSERT INTO "${safeOrgId}_users" (id, account_id, email, name, role)
     VALUES ($1, $2, $3, $4, 'owner')
     ON CONFLICT (id) DO UPDATE
       SET account_id = EXCLUDED.account_id,
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           role = 'owner',
           is_deleted = false,
           updated_at = NOW()`,
    [LOCAL_USER_ID, LOCAL_ACCOUNT_ID, LOCAL_EMAIL, LOCAL_NAME],
  );

  return LOCAL_USER_ID;
}

export class LocalAuthService {
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
    await ensureLocalAccount();

    const orgName = name.trim();
    const orgService = new OrgService();
    const { orgId } = await orgService.createOrg({
      name: orgName,
      plan: 'community',
      ownerEmail: LOCAL_EMAIL,
      ownerAccountId: LOCAL_ACCOUNT_ID,
      maxRepos: 1000,
      maxMembers: 1000,
      maxExperiences: 1000000,
      ownerUser: {
        id: LOCAL_USER_ID,
        accountId: LOCAL_ACCOUNT_ID,
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
    await ensureLocalAccount();

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
    await ensureLocalAccount();

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

export const localAuthService = new LocalAuthService();
