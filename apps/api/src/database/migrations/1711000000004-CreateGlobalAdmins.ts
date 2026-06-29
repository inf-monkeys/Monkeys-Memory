import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGlobalAdmins1711000000004 implements MigrationInterface {
  public async up(_queryRunner: QueryRunner): Promise<void> {}

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
