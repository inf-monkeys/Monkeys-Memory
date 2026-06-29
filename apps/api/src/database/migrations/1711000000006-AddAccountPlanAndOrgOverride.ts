import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountPlanAndOrgOverride1711000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plan VARCHAR(64) NOT NULL DEFAULT 'community'`,
    );

    // 2. plans: add max_orgs column
    await queryRunner.query(
      `ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_orgs INT NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(`UPDATE plans SET max_orgs = 1000 WHERE name = 'community'`);

    // 3. orgs: add quota_override flag
    await queryRunner.query(
      `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS quota_override BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    // 4. Sync existing orgs: set plan from owner account's plan
    //    For orgs whose owner already has an account, inherit the org's current plan to the account
    //    (reverse-sync: since accounts didn't have plan before, infer from the orgs they own)
    const orgs = await queryRunner.query(
      `SELECT o.id, o.plan, o.owner_email FROM orgs o WHERE o.is_deleted = false`,
    ) as Array<{ id: string; plan: string; owner_email: string }>;

    for (const org of orgs) {
      if (org.plan && org.plan !== 'community') {
        await queryRunner.query(
          `UPDATE accounts SET plan = $1 WHERE email = $2 AND plan = 'community'`,
          [org.plan, org.owner_email],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orgs DROP COLUMN IF EXISTS quota_override`);
    await queryRunner.query(`ALTER TABLE plans DROP COLUMN IF EXISTS max_orgs`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS plan`);
  }
}
