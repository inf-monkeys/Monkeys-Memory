import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReviewEventMetadata1711000000021 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(`SELECT id FROM orgs WHERE is_deleted = false`) as Array<{ id: string }>;
    for (const org of orgs) {
      await queryRunner.query(
        `ALTER TABLE "${org.id}_review_events"
         ADD COLUMN IF NOT EXISTS metadata JSONB`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(`SELECT id FROM orgs WHERE is_deleted = false`) as Array<{ id: string }>;
    for (const org of orgs) {
      await queryRunner.query(
        `ALTER TABLE "${org.id}_review_events"
         DROP COLUMN IF EXISTS metadata`,
      );
    }
  }
}
