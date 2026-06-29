import { QueryRunner, Table, TableIndex } from 'typeorm';

export class TenantTableManager {
  constructor(private queryRunner: QueryRunner, private orgId: string) {}

  async createAllTables() {
    await this.createUsersTable();
    await this.createReposTable();
    await this.createExperiencesTable();
    await this.createCompiledRulesTable();
    await this.createFeedbackEventsTable();
    await this.createReviewEventsTable();
    await this.createTrajectoryEventsTable();
    await this.createAgentActionsTable();
    await this.createAuditLogsTable();
    await this.createUsageMetricsTable();
  }

  private getTableName(base: string): string {
    return `${this.orgId}_${base}`;
  }

  private async createUsersTable() {
    const t = this.getTableName('users');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'varchar', length: '64', isPrimary: true },
        { name: 'account_id', type: 'varchar', length: '64', isNullable: true },
        { name: 'email', type: 'varchar', length: '255' },
        { name: 'name', type: 'varchar', length: '255' },
        { name: 'role', type: 'varchar', length: '32', default: "'member'" },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'is_deleted', type: 'boolean', default: false },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_email`, columnNames: ['email'], isUnique: true }));
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_account`, columnNames: ['account_id'] }));
  }

  private async createReposTable() {
    const t = this.getTableName('repos');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
        { name: 'name', type: 'varchar', length: '128' },
        { name: 'allowlisted', type: 'boolean', default: true },
        { name: 'last_compiled_at', type: 'timestamptz', isNullable: true },
        { name: 'compile_version', type: 'int', default: 0 },
        { name: 'experience_count', type: 'int', default: 0 },
        { name: 'metadata', type: 'jsonb', isNullable: true },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'is_deleted', type: 'boolean', default: false },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_name`, columnNames: ['name'] }));
  }

  private async createExperiencesTable() {
    const t = this.getTableName('experiences');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'varchar', length: '64', isPrimary: true },
        { name: 'repo_id', type: 'uuid' },
        { name: 'author_id', type: 'varchar', length: '64' },
        { name: 'title', type: 'text' },
        { name: 'claim', type: 'text' },
        { name: 'kind', type: 'varchar', length: '16', default: "'rule'" },
        { name: 'scope', type: 'jsonb' },
        { name: 'evidence', type: 'jsonb', default: "'[]'" },
        { name: 'confidence', type: 'decimal', precision: 3, scale: 2, default: 0.7 },
        { name: 'status', type: 'varchar', length: '16', default: "'active'" },
        { name: 'source_type', type: 'varchar', length: '16', default: "'manual'" },
        { name: 'content_hash', type: 'varchar', length: '64', isNullable: true },
        { name: 'lifecycle', type: 'jsonb', isNullable: true },
        { name: 'provenance', type: 'jsonb', isNullable: true },
        { name: 'relationships', type: 'jsonb', isNullable: true },
        { name: 'policy', type: 'jsonb', isNullable: true },
        { name: 'validity', type: 'jsonb', isNullable: true },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'is_deleted', type: 'boolean', default: false },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_repo`, columnNames: ['repo_id', 'status'] }));
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_author`, columnNames: ['author_id'] }));
  }

  private async createFeedbackEventsTable() {
    const t = this.getTableName('feedback_events');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'varchar', length: '64', isPrimary: true },
        { name: 'repo_id', type: 'uuid' },
        { name: 'compiled_rule_id', type: 'varchar', length: '128' },
        { name: 'source_experience_ids', type: 'jsonb', default: "'[]'" },
        { name: 'outcome', type: 'varchar', length: '32' },
        { name: 'note', type: 'text', isNullable: true },
        { name: 'metadata', type: 'jsonb', isNullable: true },
        { name: 'user_id', type: 'varchar', length: '64' },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_repo_rule`, columnNames: ['repo_id', 'compiled_rule_id'] }));
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_user_time`, columnNames: ['user_id', 'created_at'] }));
  }

  private async createReviewEventsTable() {
    const t = this.getTableName('review_events');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'varchar', length: '64', isPrimary: true },
        { name: 'repo_id', type: 'uuid' },
        { name: 'compiled_rule_id', type: 'varchar', length: '128' },
        { name: 'review_item_reason', type: 'varchar', length: '64', isNullable: true },
        { name: 'action', type: 'varchar', length: '32' },
        { name: 'note', type: 'text', isNullable: true },
        { name: 'source_experience_ids', type: 'jsonb', default: "'[]'" },
        { name: 'metadata', type: 'jsonb', isNullable: true },
        { name: 'user_id', type: 'varchar', length: '64' },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_repo_rule`, columnNames: ['repo_id', 'compiled_rule_id'] }));
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_action_time`, columnNames: ['action', 'created_at'] }));
  }

  private async createTrajectoryEventsTable() {
    const t = this.getTableName('trajectory_events');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'varchar', length: '64', isPrimary: true },
        { name: 'repo_id', type: 'uuid' },
        { name: 'user_id', type: 'varchar', length: '64' },
        { name: 'task', type: 'varchar', length: '64', isNullable: true },
        { name: 'outcome', type: 'varchar', length: '32' },
        { name: 'summary', type: 'text', isNullable: true },
        { name: 'events', type: 'jsonb', default: "'{}'" },
        { name: 'candidates', type: 'jsonb', default: "'[]'" },
        { name: 'status', type: 'varchar', length: '32', default: "'pending'" },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_repo_status`, columnNames: ['repo_id', 'status'] }));
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_user_time`, columnNames: ['user_id', 'created_at'] }));
  }

  private async createCompiledRulesTable() {
    const t = this.getTableName('compiled_rules');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
        { name: 'repo_id', type: 'uuid', isNullable: true },
        { name: 'rule_type', type: 'varchar', length: '32' },
        { name: 'content', type: 'jsonb' },
        { name: 'path_index', type: 'jsonb', isNullable: true },
        { name: 'onboarding', type: 'text', isNullable: true },
        { name: 'version', type: 'int' },
        { name: 'source_experience_count', type: 'int', default: 0 },
        { name: 'compiled_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'is_deleted', type: 'boolean', default: false },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_repo_ver`, columnNames: ['repo_id', 'version'] }));
  }

  private async createAgentActionsTable() {
    const t = this.getTableName('agent_actions');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'varchar', length: '64', isPrimary: true },
        { name: 'repo_id', type: 'uuid', isNullable: true },
        { name: 'scope_type', type: 'varchar', length: '32', default: "'repo'" },
        { name: 'scope_key', type: 'varchar', length: '255', isNullable: true },
        { name: 'type', type: 'varchar', length: '64' },
        { name: 'status', type: 'varchar', length: '32', default: "'pending'" },
        { name: 'payload', type: 'jsonb', isNullable: true },
        { name: 'result', type: 'jsonb', isNullable: true },
        { name: 'leased_by', type: 'varchar', length: '64', isNullable: true },
        { name: 'lease_expires_at', type: 'timestamptz', isNullable: true },
        { name: 'completed_at', type: 'timestamptz', isNullable: true },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_repo_type_status`, columnNames: ['repo_id', 'type', 'status'] }));
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_scope_type_status`, columnNames: ['scope_type', 'scope_key', 'type', 'status'] }));
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_lease`, columnNames: ['lease_expires_at'] }));
  }

  private async createAuditLogsTable() {
    const t = this.getTableName('audit_logs');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
        { name: 'user_id', type: 'varchar', length: '64', isNullable: true },
        { name: 'action', type: 'varchar', length: '32' },
        { name: 'resource_type', type: 'varchar', length: '32', isNullable: true },
        { name: 'resource_id', type: 'varchar', length: '128', isNullable: true },
        { name: 'metadata', type: 'jsonb', isNullable: true },
        { name: 'ip_address', type: 'inet', isNullable: true },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_time`, columnNames: ['created_at'] }));
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_user`, columnNames: ['user_id', 'created_at'] }));
  }

  private async createUsageMetricsTable() {
    const t = this.getTableName('usage_metrics');
    await this.queryRunner.createTable(new Table({
      name: t,
      columns: [
        { name: 'id', type: 'varchar', length: '255', isPrimary: true },
        { name: 'date', type: 'date' },
        { name: 'metric_type', type: 'varchar', length: '32' },
        { name: 'count', type: 'int', default: 0 },
        { name: 'details', type: 'jsonb', isNullable: true },
        { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
      ],
    }), true);
    await this.queryRunner.createIndex(t, new TableIndex({ name: `idx_${t}_date`, columnNames: ['date'] }));
  }

  async dropAllTables() {
    const tables = ['usage_metrics', 'audit_logs', 'agent_actions', 'trajectory_events', 'review_events', 'feedback_events', 'compiled_rules', 'experiences', 'repos', 'users'];
    for (const base of tables) {
      await this.queryRunner.dropTable(this.getTableName(base), true);
    }
  }
}
