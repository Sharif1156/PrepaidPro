const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

export const config = {
  port: number(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  cacheTtlMs: number(process.env.CACHE_TTL_SECONDS, 180) * 1000,
  historyDays: Math.min(number(process.env.HISTORY_DAYS, 335), 730),
  rateLimitPerMinute: number(process.env.RATE_LIMIT_PER_MINUTE, 30),
  /**
   * DEMO_MODE answers every meter lookup with generated data. Useful for
   * screenshots, offline development and any environment that cannot reach
   * the utility portals (such as CI or a sandboxed preview).
   */
  demoMode: bool(process.env.DEMO_MODE, false),
  version: '1.0.0',
  appName: 'PrepaidPro',
};

export function publicConfig() {
  return {
    appName: config.appName,
    version: config.version,
    demoMode: config.demoMode,
    providers: [
      { id: 'desco', name: 'DESCO', fullName: 'Dhaka Electric Supply Company' },
      { id: 'nesco', name: 'NESCO', fullName: 'Northern Electricity Supply Company' },
    ],
  };
}
