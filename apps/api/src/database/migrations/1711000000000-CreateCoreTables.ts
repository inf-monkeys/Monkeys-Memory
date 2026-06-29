import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateCoreTables1711000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'orgs',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'status', type: 'varchar', length: '32', default: "'active'" },
          { name: 'compile_config', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
          { name: 'is_deleted', type: 'boolean', default: false },
        ],
      }),
      true
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('orgs');
  }
}
