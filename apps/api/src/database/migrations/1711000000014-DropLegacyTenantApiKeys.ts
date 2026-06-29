import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropLegacyTenantApiKeys1711000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${org.id}_api_keys"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "${org.id}_api_keys" (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(64) NOT NULL,
          key_hash VARCHAR(128) NOT NULL,
          name VARCHAR(128),
          last_used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          is_deleted BOOLEAN DEFAULT false
        )
      `);
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${org.id}_api_keys_hash" ON "${org.id}_api_keys"(key_hash)`,
      );
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "idx_${org.id}_api_keys_user" ON "${org.id}_api_keys"(user_id)`,
      );
    }
  }
}
