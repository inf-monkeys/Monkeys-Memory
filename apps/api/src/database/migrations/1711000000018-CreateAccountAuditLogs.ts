import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountAuditLogs1711000000018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS account_audit_logs (
        id VARCHAR(64) PRIMARY KEY,
        account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        action VARCHAR(128) NOT NULL,
        resource_type VARCHAR(64),
        resource_id VARCHAR(255),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address VARCHAR(128),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_account_audit_logs_account
      ON account_audit_logs(account_id, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS account_audit_logs`);
  }
}
