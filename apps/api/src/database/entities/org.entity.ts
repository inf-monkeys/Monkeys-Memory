import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity.js';

@Entity({ name: 'orgs' })
export class OrgEntity extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 32, default: 'community' })
  plan!: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: string;

  @Column({ name: 'owner_email', type: 'varchar', length: 255 })
  ownerEmail!: string;

  @Column({ name: 'owner_account_id', type: 'varchar', length: 64, nullable: true })
  ownerAccountId!: string | null;

  @Column({ name: 'max_repos', type: 'int', default: 1000 })
  maxRepos!: number;

  @Column({ name: 'max_members', type: 'int', default: 1000 })
  maxMembers!: number;

  @Column({ name: 'max_experiences', type: 'int', default: 1000000 })
  maxExperiences!: number;

  @Column({ name: 'compile_config', type: 'jsonb', default: '{}' })
  compileConfig!: Record<string, unknown>;
}
