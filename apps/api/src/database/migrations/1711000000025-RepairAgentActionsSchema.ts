import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairAgentActionsSchema1711000000025 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      const table = `${org.id}_agent_actions`;
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS repo_id uuid`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS scope_type varchar(32) NOT NULL DEFAULT 'repo'`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS scope_key varchar(255)`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS type varchar(64) NOT NULL DEFAULT 'repo_scan'`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS status varchar(32) NOT NULL DEFAULT 'pending'`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS payload jsonb`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS result jsonb`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS leased_by varchar(64)`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS completed_at timestamptz`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT CURRENT_TIMESTAMP`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT CURRENT_TIMESTAMP`);

      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${table}_repo_type_status" ON "${table}" (repo_id, type, status)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${table}_scope_type_status" ON "${table}" (scope_type, scope_key, type, status)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${table}_lease" ON "${table}" (lease_expires_at)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`ALTER TABLE "${org.id}_agent_actions" DROP COLUMN IF EXISTS result`);
    }
  }
}
