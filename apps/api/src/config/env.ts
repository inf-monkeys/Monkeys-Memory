import { readConfig } from './read-yaml.js';

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveAllowedOrigins(webBaseUrl: string, configuredOrigins?: string | string[]): string[] {
  const defaults = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
  ];

  const configured = Array.isArray(configuredOrigins)
    ? configuredOrigins
    : typeof configuredOrigins === 'string'
      ? configuredOrigins.split(',')
      : [];

  return Array.from(new Set(
    [...defaults, webBaseUrl, ...configured]
      .map(origin => origin.trim())
      .filter(Boolean)
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  ));
}

const consoleBaseUrl = readConfig('console.baseUrl', 'http://localhost:5173');
const allowedOrigins = resolveAllowedOrigins(
  consoleBaseUrl,
  readConfig<string | string[] | undefined>('cors.allowedOrigins', undefined),
);

export const env = {
  deployment: {
    mode: readConfig<'local' | 'production'>('deployment.mode', 'local'),
  },

  port: readConfig('server.port', 3000),
  host: readConfig('server.host', '0.0.0.0'),

  db: {
    host: readConfig('database.host', 'localhost'),
    port: readConfig('database.port', 5432),
    user: readConfig('database.user', 'postgres'),
    password: readConfig('database.password', 'postgres'),
    name: readConfig('database.name', 'monkeys_memory'),
    logging: readConfig('database.logging', false),
  },

  redis: {
    host: readConfig('redis.host', 'localhost'),
    port: readConfig('redis.port', 6379),
    password: readConfig<string | undefined>('redis.password', undefined),
  },

  consistency: {
    scheduleEnabled: String(readConfig('consistency.scheduleEnabled', true)) === 'true',
    scheduleCron: readConfig('consistency.scheduleCron', '0 3 * * *'),
  },

  agentActions: {
    repoScanFreshnessHours: Number(readConfig('agentActions.repoScanFreshnessHours', 24)),
    leaseSeconds: Number(readConfig('agentActions.leaseSeconds', 1800)),
  },

  embeddings: {
    enabled: String(readConfig('embeddings.enabled', true)) === 'true',
    provider: readConfig('embeddings.provider', 'local-hash'),
    model: readConfig<string | undefined>('embeddings.model', undefined),
    dimensions: Number(readConfig('embeddings.dimensions', 64)),
    apiKey: readConfig<string | undefined>('embeddings.apiKey', undefined),
    baseUrl: readConfig<string | undefined>('embeddings.baseUrl', undefined),
    timeoutMs: Number(readConfig('embeddings.timeoutMs', 10_000)),
    fallbackToLocal: String(readConfig('embeddings.fallbackToLocal', true)) === 'true',
  },

  cors: {
    apiBaseUrl: readConfig('server.publicBaseUrl', 'http://localhost:3000'),
    consoleBaseUrl,
    allowedOrigins,
  },

  defaultCompileConfig: {
    runtimeRuleLimit: 5,
    onboardingRuleLimit: 10,
    fuzzyMergeThreshold: 0.7,
    confidenceDecayStartDays: 90,
    confidenceDecayRatePerMonth: 0.02,
    confidenceDecayMax: 0.2,
  },
};

export function assertSecureProductionConfig(): void {}
