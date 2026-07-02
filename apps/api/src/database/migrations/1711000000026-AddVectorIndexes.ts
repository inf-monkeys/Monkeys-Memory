import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVectorIndexes1711000000026 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      const table = `${org.id}_vector_indexes`;
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "${table}" (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          repo_id uuid,
          compiled_rule_id uuid NOT NULL,
          compiled_version int NOT NULL,
          provider varchar(64) NOT NULL,
          collection varchar(255) NOT NULL,
          embedding_provider varchar(64) NOT NULL,
          embedding_model varchar(128) NOT NULL,
          embedding_dimensions int NOT NULL,
          point_count int DEFAULT 0,
          status varchar(32) NOT NULL DEFAULT 'ready',
          error text,
          created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${table}_repo_version" ON "${table}" (repo_id, compiled_version)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${table}_compiled_rule" ON "${table}" (compiled_rule_id)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${table}_status" ON "${table}" (status)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${org.id}_vector_indexes"`);
    }
  }
}
