import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemoryV2TenantTables1711000000019 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" ADD COLUMN IF NOT EXISTS lifecycle jsonb`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" ADD COLUMN IF NOT EXISTS provenance jsonb`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" ADD COLUMN IF NOT EXISTS relationships jsonb`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" ADD COLUMN IF NOT EXISTS policy jsonb`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" ADD COLUMN IF NOT EXISTS validity jsonb`);
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "${org.id}_feedback_events" (
          id varchar(64) PRIMARY KEY,
          repo_id uuid NOT NULL,
          compiled_rule_id varchar(128) NOT NULL,
          source_experience_ids jsonb DEFAULT '[]',
          outcome varchar(32) NOT NULL,
          note text,
          user_id varchar(64) NOT NULL,
          created_at timestamptz DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_feedback_events_repo_rule" ON "${org.id}_feedback_events" (repo_id, compiled_rule_id)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_feedback_events_user_time" ON "${org.id}_feedback_events" (user_id, created_at)`);
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "${org.id}_review_events" (
          id varchar(64) PRIMARY KEY,
          repo_id uuid NOT NULL,
          compiled_rule_id varchar(128) NOT NULL,
          review_item_reason varchar(64),
          action varchar(32) NOT NULL,
          note text,
          source_experience_ids jsonb DEFAULT '[]',
          user_id varchar(64) NOT NULL,
          created_at timestamptz DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_review_events_repo_rule" ON "${org.id}_review_events" (repo_id, compiled_rule_id)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_review_events_action_time" ON "${org.id}_review_events" (action, created_at)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${org.id}_review_events"`);
      await queryRunner.query(`DROP TABLE IF EXISTS "${org.id}_feedback_events"`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" DROP COLUMN IF EXISTS validity`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" DROP COLUMN IF EXISTS policy`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" DROP COLUMN IF EXISTS relationships`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" DROP COLUMN IF EXISTS provenance`);
      await queryRunner.query(`ALTER TABLE "${org.id}_experiences" DROP COLUMN IF EXISTS lifecycle`);
    }
  }
}
