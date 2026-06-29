import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity.js';

@Entity({ name: 'orgs' })
export class OrgEntity extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: string;

  @Column({ name: 'compile_config', type: 'jsonb', default: '{}' })
  compileConfig!: Record<string, unknown>;
}
