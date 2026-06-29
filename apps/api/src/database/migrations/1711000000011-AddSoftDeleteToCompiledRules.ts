import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeleteToCompiledRules1711000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(
        `ALTER TABLE "${org.id}_compiled_rules" ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(
        `ALTER TABLE "${org.id}_compiled_rules" DROP COLUMN IF EXISTS is_deleted`,
      );
    }
  }
}
