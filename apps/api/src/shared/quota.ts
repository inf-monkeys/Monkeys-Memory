import { AppDataSource } from '../database/ormconfig.js';
import { QuotaExceededError } from './errors.js';

interface OrgQuota {
  max_repos: number;
  max_members: number;
  max_experiences: number;
}

async function getOrgQuota(orgId: string): Promise<OrgQuota> {
  const rows = await AppDataSource.query(
    `SELECT max_repos, max_members, max_experiences FROM orgs WHERE id = $1 AND is_deleted = false LIMIT 1`,
    [orgId],
  );
  return rows[0] ?? { max_repos: 1, max_members: 1, max_experiences: 100 };
}

export async function checkRepoQuota(orgId: string): Promise<void> {
  const quota = await getOrgQuota(orgId);
  const result = await AppDataSource.query(
    `SELECT COUNT(*) as count FROM "${orgId}_repos" WHERE is_deleted = false`,
  );
  if (parseInt(result[0].count) >= quota.max_repos) {
    throw new QuotaExceededError(`Repo limit reached (${quota.max_repos})`);
  }
}

export async function checkMemberQuota(orgId: string): Promise<void> {
  const quota = await getOrgQuota(orgId);
  const result = await AppDataSource.query(
    `SELECT COUNT(*) as count FROM "${orgId}_users" WHERE is_deleted = false`,
  );
  if (parseInt(result[0].count) >= quota.max_members) {
    throw new QuotaExceededError(`Member limit reached (${quota.max_members})`);
  }
}

export async function checkExperienceQuota(orgId: string): Promise<void> {
  const quota = await getOrgQuota(orgId);
  const result = await AppDataSource.query(
    `SELECT COUNT(*) as count FROM "${orgId}_experiences" WHERE is_deleted = false`,
  );
  if (parseInt(result[0].count) >= quota.max_experiences) {
    throw new QuotaExceededError(`Experience limit reached (${quota.max_experiences})`);
  }
}
