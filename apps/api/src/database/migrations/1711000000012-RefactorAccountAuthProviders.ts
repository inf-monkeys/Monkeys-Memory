import { generateId } from '../../shared/utils.js';
import type { MigrationInterface, QueryRunner } from 'typeorm';

type LocalAccount = {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
};

export class RefactorAccountAuthProviders1711000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS account_emails (
        id VARCHAR(64) PRIMARY KEY,
        account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL UNIQUE,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        is_verified BOOLEAN NOT NULL DEFAULT FALSE,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_account_emails_primary
      ON account_emails(account_id) WHERE is_primary = true AND is_deleted = false
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_account_emails_account
      ON account_emails(account_id)
    `);

    await queryRunner.query(`
      ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS primary_email VARCHAR(255)
    `);

    await queryRunner.query(`
      ALTER TABLE orgs
      ADD COLUMN IF NOT EXISTS owner_account_id VARCHAR(64)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_orgs_owner_account_id
      ON orgs(owner_account_id)
    `);

    const accounts = await queryRunner.query(
      `SELECT id, email, created_at, updated_at, is_deleted FROM accounts`,
    ) as LocalAccount[];

    for (const account of accounts) {
      if (!account.email) continue;

      await queryRunner.query(
        `UPDATE accounts SET primary_email = $1 WHERE id = $2`,
        [account.email, account.id],
      );

      const existingEmail = await queryRunner.query(
        `SELECT id FROM account_emails WHERE email = $1 LIMIT 1`,
        [account.email],
      ) as Array<{ id: string }>;

      if (existingEmail.length === 0) {
        await queryRunner.query(
          `INSERT INTO account_emails
             (id, account_id, email, is_primary, is_verified, verified_at, created_at, updated_at, is_deleted)
           VALUES ($1, $2, $3, true, true, $4, $5, $6, $7)`,
          [
            generateId('aem'),
            account.id,
            account.email,
            account.created_at,
            account.created_at,
            account.updated_at,
            account.is_deleted,
          ],
        );
      }
    }

    await queryRunner.query(`
      UPDATE orgs o
      SET owner_account_id = a.id
      FROM accounts a
      WHERE o.owner_account_id IS NULL
        AND a.email = o.owner_email
        AND a.is_deleted = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS account_emails`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_orgs_owner_account_id`);
    await queryRunner.query(`ALTER TABLE orgs DROP COLUMN IF EXISTS owner_account_id`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS primary_email`);
  }
}
