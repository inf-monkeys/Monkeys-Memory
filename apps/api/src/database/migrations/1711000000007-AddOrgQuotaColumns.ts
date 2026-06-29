import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrgQuotaColumns1711000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS max_repos INT NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS max_members INT NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS max_experiences INT NOT NULL DEFAULT 100`,
    );
    await queryRunner.query(
      `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS compile_config JSONB NOT NULL DEFAULT '{}'::jsonb`,
    );

    await queryRunner.query(`
      UPDATE orgs AS o
      SET
        max_repos = p.max_repos,
        max_members = p.max_members,
        max_experiences = p.max_experiences,
        updated_at = NOW()
      FROM plans AS p
      WHERE
        o.plan = p.name
        AND o.is_deleted = false
        AND COALESCE(o.quota_override, false) = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orgs DROP COLUMN IF EXISTS compile_config`);
    await queryRunner.query(`ALTER TABLE orgs DROP COLUMN IF EXISTS max_experiences`);
    await queryRunner.query(`ALTER TABLE orgs DROP COLUMN IF EXISTS max_members`);
    await queryRunner.query(`ALTER TABLE orgs DROP COLUMN IF EXISTS max_repos`);
  }
}
