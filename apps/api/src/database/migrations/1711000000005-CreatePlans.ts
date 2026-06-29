import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlans1711000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        price_monthly DECIMAL(10, 2) NOT NULL DEFAULT 0,
        price_yearly DECIMAL(10, 2) NOT NULL DEFAULT 0,
        max_repos INT NOT NULL DEFAULT 1,
        max_members INT NOT NULL DEFAULT 1,
        max_experiences INT NOT NULL DEFAULT 100,
        features JSONB DEFAULT '[]',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const plans = [
      {
        id: 'plan_community',
        name: 'community',
        display_name: 'Community',
        price_monthly: 0,
        price_yearly: 0,
        max_repos: 1000,
        max_members: 1000,
        max_experiences: 1000000,
        sort_order: 1,
      },
    ];

    for (const p of plans) {
      await queryRunner.query(
        `INSERT INTO plans (id, name, display_name, price_monthly, price_yearly, max_repos, max_members, max_experiences, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (name) DO NOTHING`,
        [p.id, p.name, p.display_name, p.price_monthly, p.price_yearly, p.max_repos, p.max_members, p.max_experiences, p.sort_order],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS plans`);
  }
}
