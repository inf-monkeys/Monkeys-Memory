import { DataSource } from 'typeorm';
import { env } from '../config/env.js';
import { OrgEntity } from './entities/org.entity.js';
import { CreateCoreTables1711000000000 } from './migrations/1711000000000-CreateCoreTables.js';
import { CreateOrgTenantTables1711000000001 } from './migrations/1711000000001-CreateOrgTables.js';
import { AddPasswordHashToTenantUsers1711000000002 } from './migrations/1711000000002-AddPasswordHashToTenantUsers.js';
import { CreateAccountsAndInvites1711000000003 } from './migrations/1711000000003-CreateAccountsAndInvites.js';
import { CreateGlobalAdmins1711000000004 } from './migrations/1711000000004-CreateGlobalAdmins.js';
import { CreatePlans1711000000005 } from './migrations/1711000000005-CreatePlans.js';
import { AddAccountPlanAndOrgOverride1711000000006 } from './migrations/1711000000006-AddAccountPlanAndOrgOverride.js';
import { AddOrgQuotaColumns1711000000007 } from './migrations/1711000000007-AddOrgQuotaColumns.js';
import { CreateAccountApiKeys1711000000009 } from './migrations/1711000000009-CreateAccountApiKeys.js';
import { UpdatePlanFeatures1711000000010 } from './migrations/1711000000010-UpdatePlanFeatures.js';
import { AddSoftDeleteToCompiledRules1711000000011 } from './migrations/1711000000011-AddSoftDeleteToCompiledRules.js';
import { RefactorAccountAuthProviders1711000000012 } from './migrations/1711000000012-RefactorAccountAuthProviders.js';
import { AddAccountEmailTokens1711000000013 } from './migrations/1711000000013-AddAccountEmailTokens.js';
import { DropLegacyTenantApiKeys1711000000014 } from './migrations/1711000000014-DropLegacyTenantApiKeys.js';
import { HardenGlobalAdminSecurity1711000000015 } from './migrations/1711000000015-HardenGlobalAdminSecurity.js';
import { AddAccountMfa1711000000016 } from './migrations/1711000000016-AddAccountMfa.js';
import { HardenAccountSessions1711000000017 } from './migrations/1711000000017-HardenAccountSessions.js';
import { CreateAccountAuditLogs1711000000018 } from './migrations/1711000000018-CreateAccountAuditLogs.js';
import { AddMemoryV2TenantTables1711000000019 } from './migrations/1711000000019-AddMemoryV2TenantTables.js';
import { AddTrajectoryEvents1711000000020 } from './migrations/1711000000020-AddTrajectoryEvents.js';
import { AddReviewEventMetadata1711000000021 } from './migrations/1711000000021-AddReviewEventMetadata.js';
import { AddAgentActions1711000000022 } from './migrations/1711000000022-AddAgentActions.js';
import { AddCliDeviceAuth1711000000023 } from './migrations/1711000000023-AddCliDeviceAuth.js';
import { AddFeedbackEventMetadata1711000000024 } from './migrations/1711000000024-AddFeedbackEventMetadata.js';
import { RepairAgentActionsSchema1711000000025 } from './migrations/1711000000025-RepairAgentActionsSchema.js';

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
    AddPasswordHashToTenantUsers1711000000002,
    CreateAccountsAndInvites1711000000003,
    CreateGlobalAdmins1711000000004,
    CreatePlans1711000000005,
    AddAccountPlanAndOrgOverride1711000000006,
    AddOrgQuotaColumns1711000000007,
    CreateAccountApiKeys1711000000009,
    UpdatePlanFeatures1711000000010,
    AddSoftDeleteToCompiledRules1711000000011,
    RefactorAccountAuthProviders1711000000012,
    AddAccountEmailTokens1711000000013,
    DropLegacyTenantApiKeys1711000000014,
    HardenGlobalAdminSecurity1711000000015,
    AddAccountMfa1711000000016,
    HardenAccountSessions1711000000017,
    CreateAccountAuditLogs1711000000018,
    AddMemoryV2TenantTables1711000000019,
    AddTrajectoryEvents1711000000020,
    AddReviewEventMetadata1711000000021,
    AddAgentActions1711000000022,
    AddCliDeviceAuth1711000000023,
    AddFeedbackEventMetadata1711000000024,
    RepairAgentActionsSchema1711000000025,
  ],
  migrationsTableName: 'migrations',
});
