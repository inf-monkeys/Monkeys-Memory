import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrajectoryEvents1711000000020 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "${org.id}_trajectory_events" (
          id varchar(64) PRIMARY KEY,
          repo_id uuid NOT NULL,
          user_id varchar(64) NOT NULL,
          task varchar(64),
          outcome varchar(32) NOT NULL,
          summary text,
          events jsonb DEFAULT '{}',
          candidates jsonb DEFAULT '[]',
          status varchar(32) DEFAULT 'pending',
          created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_trajectory_events_repo_status" ON "${org.id}_trajectory_events" (repo_id, status)`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_${org.id}_trajectory_events_user_time" ON "${org.id}_trajectory_events" (user_id, created_at)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const orgs = await queryRunner.query(
      `SELECT id FROM orgs WHERE is_deleted = false`,
    ) as Array<{ id: string }>;

    for (const org of orgs) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${org.id}_trajectory_events"`);
    }
  }
}
