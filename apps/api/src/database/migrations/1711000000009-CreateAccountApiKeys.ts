import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountApiKeys1711000000009 implements MigrationInterface {
  public async up(_queryRunner: QueryRunner): Promise<void> {}

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
