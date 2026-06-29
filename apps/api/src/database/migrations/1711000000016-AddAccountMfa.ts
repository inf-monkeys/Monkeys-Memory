import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountMfa1711000000016 implements MigrationInterface {
  public async up(_queryRunner: QueryRunner): Promise<void> {}

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
