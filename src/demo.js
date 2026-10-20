import { config } from './config.js';

/**
 * Deterministic demo data.
 *
 * The numbers are generated from a hash of the meter number, so the same
 * account always shows the same history -- screenshots stay stable and the
 * UI is easy to demo without touching a real utility portal.
 *
 * Demo responses are always flagged `demo: true` and are shown with a badge
 * in the interface. They never claim to be a real meter reading.
 */

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Bangladesh residential demand peaks in the hot, humid months.
const SEASON_FACTOR = [0.82, 0.78, 0.94, 1.12, 1.28, 1.34, 1.31, 1.24, 1.12, 0.99, 0.88, 0.8];

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoLocal(date) {
  const offset = 6 * 60;
  const local = new Date(date.getTime() + offset * 60_000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(
    local.getUTCHours(),
  )}:${pad(local.getUTCMinutes())}:00+06:00`;
}

export function demoProfile(provider, accountNo) {
  const seed = hashString(`${provider}:${accountNo}`);
  const random = mulberry32(seed);
  const now = new Date();

  const baseMonthly = 2400 + Math.round(random() * 900); // BDT for a mid-size flat
  const tariff = 7.4 + random() * 1.4; // BDT per kWh, roughly DESCO's blended rate
  const monthly = [];

  for (let back = 11; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const factor = SEASON_FACTOR[date.getUTCMonth()];
    const noise = 0.92 + random() * 0.16;
    let taka = Math.round(baseMonthly * factor * noise);
    if (back === 0) {
      const dayOfMonth = now.getUTCDate();
      taka = Math.round((taka * Math.min(dayOfMonth, 28)) / 30);
    }
    monthly.push({
      month: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`,
      unit: Math.round(taka / tariff),
      taka,
      demand: Math.round((1.6 + random() * 2.4) * 10) / 10,
    });
  }

  const spentThisMonth = monthly[monthly.length - 1].taka;
  const currentDay = now.getUTCDate();
  const projectedMonthly = Math.round((spentThisMonth / Math.max(currentDay, 1)) * 30);
  const nextMonthFactor = SEASON_FACTOR[(now.getUTCMonth() + 1) % 12];
  const expectedMonthly = Math.round((projectedMonthly * 0.65 + baseMonthly * nextMonthFactor * 0.35));

  // Recharges roughly follow consumption, in round amounts people actually buy.
  const recharges = [];
  const historyDays = 210;
  let cursor = new Date(now.getTime() - historyDays * 86_400_000);
  while (cursor < now) {
    const amount = [500, 1000, 1000, 1500, 2000, 2000, 3000][Math.floor(random() * 7)];
    const date = new Date(cursor);
    date.setUTCHours(6 + Math.floor(random() * 12), 1 + Math.floor(random() * 58), 0, 0);
    recharges.push({
      date: isoLocal(date),
      amount,
      energyAmount: Math.round((amount / 1.05 / tariff) * 100) / 100,
      vat: Math.round(amount * 0.05 * 100) / 100,
      method: ['bKash', 'Nagad', 'Rocket', 'Card', 'DESCO counter'][Math.floor(random() * 5)],
      tokenNo: String(100000000000 + Math.floor(random() * 899999999999)),
      status: 'Success',
    });
    cursor = new Date(cursor.getTime() + (9 + Math.floor(random() * 14)) * 86_400_000);
  }
  recharges.sort((a, b) => b.date.localeCompare(a.date));

  const balance = Math.round((260 + random() * 900) * 100) / 100;
  const readingTime = new Date(now.getTime() - Math.floor(random() * 8) * 3_600_000);

  return {
    provider,
    accountNo,
    source: 'demo',
    demo: true,
    balance,
    meterNo: provider === 'desco' ? `MH${Math.floor(random() * 9e9) + 1e9}` : String(Math.floor(random() * 9e11) + 1e11),
    readingTime: isoLocal(readingTime),
    customer: {
      name: 'Demo Customer',
      address: provider === 'desco' ? 'Dhanmondi, Dhaka' : 'Bogura Sadar, Bogura',
      mobile: '01XXXXXXXXX',
      tariff: `LT-A (${provider.toUpperCase()})`,
      feeder: 'Demo Feeder 03',
      division: provider === 'desco' ? 'Dhanmondi S&D' : 'Bogura S&D',
      meterType: '1 Phase',
      installationDate: '2022-03-14T00:00:00+06:00',
      consumerNo: accountNo,
      meterStatus: 'Active',
    },
    currentMonth: {
      month: monthly[monthly.length - 1].month,
      taka: spentThisMonth,
      unit: monthly[monthly.length - 1].unit,
    },
    monthly,
    recharges,
    forecastHint: { expectedMonthly, tariff },
    fetchedAt: new Date().toISOString(),
    meta: {
      historyDays,
      demo: true,
      note: 'Generated demo data - not a real meter reading.',
      monthLabel: MONTH_LABELS[now.getUTCMonth()],
    },
  };
}

export function fetchDemo(provider, accountNo) {
  const clean = String(accountNo || '000000').replace(/\D/g, '') || '000000';
  if (!['desco', 'nesco'].includes(provider)) {
    return demoProfile('desco', clean);
  }
  return demoProfile(provider, clean);
}

export const demoDefaults = {
  provider: 'desco',
  accountNo: '104237569',
  demoMode: config.demoMode,
};
