import { MigrationInterface, QueryRunner } from 'typeorm';

// 这个 migration 用于创建租户表
// 实际使用时，需要动态传入 orgId
export class CreateOrgTenantTables1711000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 租户表在组织创建时动态生成
    // 这里只是示例，实际不会运行
    console.log('Tenant tables are created dynamically when org is created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 不需要实现
  }
}
