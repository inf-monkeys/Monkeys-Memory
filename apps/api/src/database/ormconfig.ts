import { DataSource } from 'typeorm';
import { env } from '../config/env.js';
import { OrgEntity } from './entities/org.entity.js';
import { CreateCoreTables1711000000000 } from './migrations/1711000000000-CreateCoreTables.js';
import { CreateOrgTenantTables1711000000001 } from './migrations/1711000000001-CreateOrgTables.js';
import { AddSoftDeleteToCompiledRules1711000000011 } from './migrations/1711000000011-AddSoftDeleteToCompiledRules.js';
import { DropLegacyTenantApiKeys1711000000014 } from './migrations/1711000000014-DropLegacyTenantApiKeys.js';
import { AddMemoryV2TenantTables1711000000019 } from './migrations/1711000000019-AddMemoryV2TenantTables.js';
import { AddTrajectoryEvents1711000000020 } from './migrations/1711000000020-AddTrajectoryEvents.js';
import { AddReviewEventMetadata1711000000021 } from './migrations/1711000000021-AddReviewEventMetadata.js';
import { AddAgentActions1711000000022 } from './migrations/1711000000022-AddAgentActions.js';
import { AddFeedbackEventMetadata1711000000024 } from './migrations/1711000000024-AddFeedbackEventMetadata.js';
import { RepairAgentActionsSchema1711000000025 } from './migrations/1711000000025-RepairAgentActionsSchema.js';
import { AddVectorIndexes1711000000026 } from './migrations/1711000000026-AddVectorIndexes.js';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.db.host,
  port: env.db.port,
  username: env.db.user,
  password: env.db.password,
  database: env.db.name,
  synchronize: false,
  logging: env.db.logging,
  entities: [OrgEntity],
  migrations: [
    CreateCoreTables1711000000000,
    CreateOrgTenantTables1711000000001,
    AddSoftDeleteToCompiledRules1711000000011,
    DropLegacyTenantApiKeys1711000000014,
    AddMemoryV2TenantTables1711000000019,
    AddTrajectoryEvents1711000000020,
    AddReviewEventMetadata1711000000021,
    AddAgentActions1711000000022,
    AddFeedbackEventMetadata1711000000024,
    RepairAgentActionsSchema1711000000025,
    AddVectorIndexes1711000000026,
  ],
  migrationsTableName: 'migrations',
});
