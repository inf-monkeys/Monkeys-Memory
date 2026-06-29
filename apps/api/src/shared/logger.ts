const levels = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof levels;

const currentLevel: Level = (process.env.LOG_LEVEL as Level) || 'info';

function log(level: Level, msg: string, data?: Record<string, unknown>) {
  if (levels[level] > levels[currentLevel]) return;
  const entry = { time: new Date().toISOString(), level, msg, ...data };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
  debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
};
