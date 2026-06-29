import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdatePlanFeatures1711000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE plans SET features = $1 WHERE name = 'community'`,
      [JSON.stringify(['basicRetrieval', 'compilation', 'conflictDetection', 'auditLogs', 'aiAutoCapture', 'advancedAnalytics', 'dataExport'])],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE plans SET features = '[]' WHERE name = 'community'`);
  }
}
