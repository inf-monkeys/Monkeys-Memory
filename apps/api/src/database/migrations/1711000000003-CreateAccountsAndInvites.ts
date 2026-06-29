import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountsAndInvites1711000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);

    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      const table = `"${org.id}_users"`;
      const indexName = `idx_${org.id}_users_account`;

      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS account_id VARCHAR(64)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "${indexName}" ON ${table} (account_id)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      const table = `"${org.id}_users"`;
      await queryRunner.query(`DROP INDEX IF EXISTS "idx_${org.id}_users_account"`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS account_id`);
    }

    await queryRunner.query(`DROP TABLE IF EXISTS accounts`);
  }
}
