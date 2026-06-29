import { AppDataSource } from './database/ormconfig.js';

async function migrate() {
  await AppDataSource.initialize();
  console.log('Connected');

  const queries = [
    `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS max_repos INT DEFAULT 1`,
    `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS max_members INT DEFAULT 1`,
    `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS max_experiences INT DEFAULT 100`,
    `ALTER TABLE orgs ADD COLUMN IF NOT EXISTS compile_config JSONB DEFAULT '{}'`,
  ];

  for (const q of queries) {
    await AppDataSource.query(q);
    console.log('OK:', q.slice(0, 60));
  }

  await AppDataSource.destroy();
  console.log('Done');
}

migrate().catch(e => { console.error(e); process.exit(1); });
