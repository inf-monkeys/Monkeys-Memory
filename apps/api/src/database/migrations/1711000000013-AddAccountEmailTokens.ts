import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountEmailTokens1711000000013 implements MigrationInterface {
  public async up(_queryRunner: QueryRunner): Promise<void> {}

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
