import { describe, expect, it } from 'vitest';
import { assertSecureProductionConfig, env } from '../../src/config/env.js';

describe('local environment defaults', () => {
  it('allows local deployment mode in production', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    expect(env.deployment.mode).toBe('local');
    expect(() => assertSecureProductionConfig()).not.toThrow();

    process.env.NODE_ENV = originalNodeEnv;
  });
});
