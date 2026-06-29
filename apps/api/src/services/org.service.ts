import { AppDataSource } from '../database/ormconfig.js';
import { OrgEntity } from '../database/entities/org.entity.js';
import { TenantTableManager } from '../database/tenant-table-manager.js';

export class OrgService {
  async createOrg(data: {
    name: string;
    plan: string;
    ownerEmail: string;
    ownerAccountId?: string;
    maxRepos?: number;
    maxMembers?: number;
    maxExperiences?: number;
    ownerUser?: {
      id: string;
      accountId?: string;
      email: string;
      name: string;
      role: string;
    };
  }) {
    const orgId = this.generateOrgId();

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. 创建组织记录
      await queryRunner.manager.insert(OrgEntity, {
        id: orgId,
        name: data.name,
        plan: data.plan,
        ownerEmail: data.ownerEmail,
        ownerAccountId: data.ownerAccountId ?? null,
        status: 'active',
        maxRepos: data.maxRepos ?? 1,
        maxMembers: data.maxMembers ?? 1,
        maxExperiences: data.maxExperiences ?? 100,
      });

      // 2. 创建租户表
      const tableManager = new TenantTableManager(queryRunner, orgId);
      await tableManager.createAllTables();

      if (data.ownerUser) {
        await queryRunner.query(
          `INSERT INTO "${orgId}_users" (id, account_id, email, name, role)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            data.ownerUser.id,
            data.ownerUser.accountId ?? null,
            data.ownerUser.email,
            data.ownerUser.name,
            data.ownerUser.role,
          ],
        );
      }

      await queryRunner.commitTransaction();
      return { orgId };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private generateOrgId(): string {
    return `org_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
