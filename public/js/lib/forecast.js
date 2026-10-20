/**
 * Forecast engine.
 *
 * Pure functions, no DOM and no network, so the exact same code can be tested
 * in Node and used in the browser. The output is always explainable: every
 * number carries the inputs it was derived from.
 */

const DAY = 86_400_000;

export function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysBetween(from, to) {
  return Math.max(0, (to.getTime() - from.getTime()) / DAY);
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Recency-weighted monthly cost, in BDT per day.
 *
 * `monthly` is [{ month: '2026-07', taka, unit }, ...] oldest first.
 * The current (partial) month is completed by scaling to elapsed days so a
 * slow start to the month does not look like a sudden drop in usage.
 */
export function dailyCostFromMonthly(monthly, now = new Date()) {
  const rows = (Array.isArray(monthly) ? monthly : []).filter(
    (row) => row && typeof row.taka === 'number' && row.taka > 0 && /^\d{4}-\d{2}$/.test(row.month || ''),
  );
  if (!rows.length) return { perDay: null, samples: [], method: 'none' };

  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const elapsed = now.getDate();
  const samples = [];

  rows.forEach((row, index) => {
    const age = rows.length - 1 - index;
    const weight = Math.pow(0.62, age);
    const isCurrent = row.month === currentKey;
    const days = isCurrent ? Math.max(elapsed, 1) : new Date(
      Number(row.month.slice(0, 4)),
      Number(row.month.slice(5, 7)),
      0,
    ).getDate();
    const taka = isCurrent ? row.taka : row.taka;
    samples.push({ month: row.month, perDay: taka / days, weight, isCurrent });
  });

  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const perDay = samples.reduce((sum, sample) => sum + sample.perDay * sample.weight, 0) / totalWeight;
  return { perDay: round2(perDay), samples, method: 'recency-weighted monthly readings' };
}

/** Fallback estimate from recharge history, in BDT per day. */
export function dailyCostFromRecharges(recharges, now = new Date()) {
  const rows = (Array.isArray(recharges) ? recharges : [])
    .map((row) => ({ ...row, dateObj: toDate(row.date) }))
    .filter((row) => row.dateObj && typeof row.amount === 'number' && row.amount > 0)
    .sort((a, b) => a.dateObj - b.dateObj);
  if (rows.length < 2) return { perDay: null, method: 'none' };

  const last = rows[rows.length - 1];
  const span = Math.max(daysBetween(rows[0].dateObj, now), 1);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return {
    perDay: round2(total / span),
    method: 'average recharge spend',
    lastRecharge: last.date,
  };
}

export function estimateDailyCost(account, now = new Date()) {
  const fromMonthly = dailyCostFromMonthly(account?.monthly, now);
  if (fromMonthly.perDay && fromMonthly.perDay > 0) {
    return { ...fromMonthly, source: 'monthly' };
  }
  const fromRecharges = dailyCostFromRecharges(account?.recharges, now);
  if (fromRecharges.perDay && fromRecharges.perDay > 0) {
    return { ...fromRecharges, source: 'recharges' };
  }
  return { perDay: null, method: 'none', source: 'none' };
}

/**
 * Balance runway.
 * Returns days remaining, the date the balance is expected to hit zero,
 * and a confidence label derived from how much history we have.
 */
export function forecastBalance(account, { now = new Date(), threshold = 100 } = {}) {
  const balance = typeof account?.balance === 'number' ? account.balance : null;
  const estimate = estimateDailyCost(account, now);
  const perDay = estimate.perDay;
  const monthlyCount = (account?.monthly || []).length;

  const confidence =
    monthlyCount >= 6 ? 'high' : monthlyCount >= 3 ? 'medium' : perDay ? 'low' : 'none';

  if (balance === null || !perDay || perDay <= 0) {
    return {
      perDay,
      method: estimate.method,
      confidence,
      balance,
      daysLeft: null,
      emptyDate: null,
      thresholdDate: null,
      safeDailySpend: null,
      monthly: null,
    };
  }

  const daysLeft = balance / perDay;
  const emptyDate = new Date(now.getTime() + daysLeft * DAY);
  const thresholdDate =
    balance > threshold ? new Date(now.getTime() + ((balance - threshold) / perDay) * DAY) : now;

  // What the meter can afford per day to last until the end of the month.
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const daysToMonthEnd = Math.max(daysBetween(now, endOfMonth), 1);

  return {
    perDay,
    method: estimate.method,
    confidence,
    balance,
    daysLeft: round2(daysLeft),
    emptyDate,
    thresholdDate,
    safeDailySpend: round2(balance / daysToMonthEnd),
    monthly: round2(perDay * 30),
    threshold: round2(threshold),
  };
}

/** Typical gap between recharges and typical amount, in BDT. */
export function rechargePattern(recharges) {
  const rows = (Array.isArray(recharges) ? recharges : [])
    .map((row) => ({ ...row, dateObj: toDate(row.date) }))
    .filter((row) => row.dateObj && typeof row.amount === 'number')
    .sort((a, b) => a.dateObj - b.dateObj);

  if (!rows.length) return { count: 0, medianGapDays: null, medianAmount: null, lastDate: null, nextExpected: null };

  const amounts = rows.map((row) => row.amount).sort((a, b) => a - b);
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    gaps.push(daysBetween(rows[index - 1].dateObj, rows[index].dateObj));
  }
  gaps.sort((a, b) => a - b);
  const medianGapDays = median(gaps);
  const lastDate = rows[rows.length - 1].dateObj;

  return {
    count: rows.length,
    medianGapDays: medianGapDays === null ? null : round2(medianGapDays),
    medianAmount: medianAmountOf(amounts),
    lastDate,
    nextExpected:
      medianGapDays === null ? null : new Date(lastDate.getTime() + medianGapDays * DAY),
    totalSpent: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
  };
}

function median(sortedValues) {
  if (!sortedValues.length) return null;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

function medianAmountOf(sortedAmounts) {
  const value = median(sortedAmounts);
  return value === null ? null : Math.round(value);
}

/**
 * Month-to-date stats with a comparison against the same point of last month.
 * The comparison is an approximation: it assumes daily spend this month is
 * roughly stable, then compares against last month's full total scaled by the
 * fraction of the month elapsed.
 */
export function monthToDate(account, now = new Date()) {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
  const monthly = Array.isArray(account?.monthly) ? account.monthly : [];
  const current = monthly.find((row) => row.month === key) || null;
  const previous = monthly.find((row) => row.month === previousKey) || null;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();

  const currentTaka = current?.taka ?? account?.currentMonth?.taka ?? null;
  const projected = currentTaka === null ? null : Math.round((currentTaka / dayOfMonth) * daysInMonth);
  const previousPace =
    previous?.taka === null || previous?.taka === undefined
      ? null
      : Math.round((previous.taka / daysInMonth) * dayOfMonth);
  const changePct =
    previousPace && projected !== null ? round2(((projected - previousPace) / previousPace) * 100) : null;

  return {
    monthKey: key,
    dayOfMonth,
    daysInMonth,
    spent: currentTaka,
    unit: current?.unit ?? account?.currentMonth?.unit ?? null,
    projected,
    previousSpent: previous?.taka ?? null,
    previousPace,
    changePct,
  };
}

/**
 * Estimated daily usage series, built by spreading each month's cost across
 * its days. DESCO only publishes monthly totals, so this is an estimate and
 * the UI labels it as such.
 */
export function dailySeries(account, { days = 45, now = new Date() } = {}) {
  const monthly = Array.isArray(account?.monthly) ? account.monthly : [];
  if (!monthly.length) return [];

  const points = [];
  const monthMap = new Map(monthly.map((row) => [row.month, row]));

  for (let back = days - 1; back >= 0; back -= 1) {
    const date = new Date(now.getTime() - back * DAY);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const row = monthMap.get(key);
    if (!row || typeof row.taka !== 'number') continue;
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    points.push({
      date: `${key}-${String(date.getDate()).padStart(2, '0')}`,
      taka: round2(row.taka / daysInMonth),
      unit: row.unit ? round2(row.unit / daysInMonth) : null,
      partial: date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(),
    });
  }
  return points;
}

/** Human-friendly countdown used across the interface. */
export function formatDays(days) {
  if (days === null || days === undefined) return '--';
  if (days < 0.5) return 'under a day';
  if (days < 1) return 'about a day';
  if (days < 2) return '1 day';
  return `${Math.round(days)} days`;
}

/**
 * Risk level drives the colour of the balance card.
 * Thresholds are deliberately conservative: a prepaid meter that runs out
 * means the lights go off.
 */
export function riskLevel(forecast, threshold = 100) {
  if (!forecast || forecast.daysLeft === null) return 'unknown';
  if (forecast.daysLeft < 1) return 'critical';
  if (forecast.daysLeft < 3) return 'high';
  if (forecast.balance !== null && forecast.balance <= threshold) return 'high';
  if (forecast.daysLeft < 7) return 'medium';
  return 'low';
}
