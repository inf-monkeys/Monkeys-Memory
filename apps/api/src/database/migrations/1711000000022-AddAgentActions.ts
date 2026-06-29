import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentActions1711000000022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "${org.id}_agent_actions" (
          id varchar(64) PRIMARY KEY,
          repo_id uuid,
          scope_type varchar(32) NOT NULL DEFAULT 'repo',
          scope_key varchar(255),
          type varchar(64) NOT NULL,
          status varchar(32) NOT NULL DEFAULT 'pending',
          payload jsonb,
          result jsonb,
          leased_by varchar(64),
          lease_expires_at timestamptz,
          completed_at timestamptz,
          created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_agent_actions_repo_type_status" ON "${org.id}_agent_actions" (repo_id, type, status)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_agent_actions_scope_type_status" ON "${org.id}_agent_actions" (scope_type, scope_key, type, status)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_agent_actions_lease" ON "${org.id}_agent_actions" (lease_expires_at)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${org.id}_agent_actions"`);
    }
  }
}
