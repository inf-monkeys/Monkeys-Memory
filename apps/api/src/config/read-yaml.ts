import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'yaml';

// Config file resolution order:
// 1. MONKEYS_MEMORY_CONFIG environment variable
// 2. -c / --config command line argument
// 3. /etc/monkeys-memory/config.yaml
// 4. ./config.yaml

function getConfigFileFromCommandLine(): string | undefined {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '-c' || argv[i] === '--config') {
      return argv[i + 1];
    }
  }
}

function loadConfigs(): Record<string, any> {
  const cliConfig = getConfigFileFromCommandLine();

  let candidates: string[];
  if (process.env.MONKEYS_MEMORY_CONFIG) {
    candidates = [path.resolve(process.env.MONKEYS_MEMORY_CONFIG)];
  } else if (cliConfig) {
    candidates = [path.resolve(cliConfig)];
  } else {
    candidates = [
      path.resolve('/etc/monkeys-memory/config.yaml'),
      path.resolve('./config.yaml'),
    ];
  }

  const configs = candidates
    .filter(f => fs.existsSync(f))
    .map(f => {
      const content = fs.readFileSync(f, 'utf-8');
      console.log(`[config] loaded: ${f}`);
      return yaml.parse(content) ?? {};
    });

  // Deep merge
  return configs.reduce((prev, curr) => deepMerge(prev, curr), {});
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

const config = loadConfigs();

/**
 * Read config value by dot-notation key.
 * Supports environment variable override:
 *   readConfig('database.host') can be overridden by DATABASE_HOST env var
 */
export function readConfig<T = any>(key: string, defaultValue?: T): T {
  // Check env var override: database.host → DATABASE_HOST
  const envKey = key.split('.').map(s => s.replace(/([A-Z])/g, '_$1').toUpperCase()).join('_');
  if (process.env[envKey] !== undefined) {
    return process.env[envKey] as unknown as T;
  }

  // Walk the config object
  const parts = key.split('.');
  let current: any = config;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return defaultValue as T;
    current = current[part];
  }

  return (current ?? defaultValue) as T;
}
