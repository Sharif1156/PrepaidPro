/**
 * Health check for the signed-in DESCO portal.
 *
 * It signs in, calls every endpoint PrepaidPro depends on, and reports:
 *   - which calls failed,
 *   - where the portal returned rows that our readers could not understand
 *     (the usual sign that DESCO renamed a field),
 *   - the SHAPE of each answer (field names and types only, never values), so
 *     a report can be shared or posted publicly without leaking account data.
 */
import { api, accountIdFor, credentials } from './desco-session.js';
import {
  fetchDesco,
  fetchDescoNotices,
  rowsOf,
  monthRange,
  dateRange,
  normalizeMonthly,
  normalizeRecharges,
  normalizeDaily,
  normalizeTokens,
} from './desco.js';

/** Field names and value types only. Arrays show their first element. */
export function shapeOf(value, depth = 0) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1), `(${value.length} items)`] : [];
  if (typeof value === 'object') {
    if (depth > 3) return 'object';
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item, depth + 1)]));
  }
  return typeof value;
}

const LISTS = [
  { name: 'usage/monthly', path: 'usage/monthly', query: () => monthRange(11), parse: normalizeMonthly },
  { name: 'usage/daily', path: 'usage/daily', query: () => dateRange(30), parse: normalizeDaily },
  { name: 'transactions', path: 'transactions', query: () => dateRange(180), parse: normalizeRecharges },
  { name: 'tokens', path: 'tokens', query: () => dateRange(180), parse: normalizeTokens },
];

export async function checkPortal({ accountNo = process.env.WATCH_ACCOUNT_NO || '' } = {}) {
  const checks = [];
  const shapes = {};
  const add = (name, status, note = '') => checks.push({ name, status, note });

  if (!credentials()) {
    add('credentials', 'fail', 'DESCO_USERNAME / DESCO_PASSWORD are not set.');
    return { ok: false, checks, shapes };
  }

  // 1. sign in and pick a meter that is already linked (never link new ones from a check)
  let list;
  try {
    list = await api('/api/accounts');
    shapes['accounts'] = shapeOf(list);
    add('sign in', 'ok');
  } catch (error) {
    add('sign in', 'fail', `${error.code || 'ERROR'}: ${error.message}`);
    return { ok: false, checks, shapes };
  }
  const linked = (list?.accounts || []).map((item) => String(item.accountNo));
  const target = accountNo && linked.includes(String(accountNo)) ? String(accountNo) : linked[0];
  if (!target) {
    add('linked meter', 'fail', 'The DESCO login has no linked meters to check.');
    return { ok: false, checks, shapes };
  }
  add('linked meter', 'ok', `${linked.length} linked`);

  const id = await accountIdFor(target);
  const base = `/api/accounts/${encodeURIComponent(id)}`;

  // 2. the balance call and the pieces the dashboard cannot work without
  try {
    const balance = await api(`${base}/balance`);
    shapes['balance'] = shapeOf(balance);
  } catch (error) {
    add('balance call', 'fail', `${error.code}: ${error.message}`);
    return { ok: false, checks, shapes };
  }
  try {
    const account = await fetchDesco(target);
    add('balance number', typeof account.balance === 'number' ? 'ok' : 'fail');
    add('reading time', account.readingTime ? 'ok' : 'fail', account.readingTime ? '' : 'not understood');
    add('meter number', account.meterNo ? 'ok' : 'warn');
  } catch (error) {
    add('full lookup', 'fail', `${error.code}: ${error.message}`);
  }

  // 3. each list: did the call work, and did our reader understand what came back?
  for (const item of LISTS) {
    try {
      const payload = await api(`${base}/${item.path}`, { query: item.query() });
      shapes[item.name] = shapeOf(payload);
      const rows = rowsOf(payload);
      const parsed = item.parse(rows);
      if (rows.length === 0) add(item.name, 'warn', 'portal returned no rows (may be normal)');
      else if (parsed.length < rows.length * 0.5) {
        add(item.name, 'fail', `${rows.length} rows came back but only ${parsed.length} were understood. A field was probably renamed.`);
      } else add(item.name, 'ok', `${parsed.length} rows`);
    } catch (error) {
      add(item.name, 'fail', `${error.code}: ${error.message}`);
    }
  }

  // 4. public notices (no login)
  try {
    await fetchDescoNotices();
    add('notices', 'ok');
  } catch (error) {
    add('notices', 'warn', `${error.code || 'ERROR'}: ${error.message}`);
  }

  return { ok: !checks.some((check) => check.status === 'fail'), checks, shapes };
}

export function formatReport(result) {
  const icon = { ok: '✅', warn: '⚠️', fail: '❌' };
  const lines = [
    result.ok ? '# DESCO portal check: all good' : '# DESCO portal check: PROBLEM FOUND',
    '',
    '| Check | Result | Note |',
    '|---|---|---|',
    ...result.checks.map((check) => `| ${check.name} | ${icon[check.status]} ${check.status} | ${check.note || ''} |`),
  ];
  if (!result.ok) {
    lines.push('', 'Answer shapes (field names and types only, no personal data):', '', '```json');
    lines.push(JSON.stringify(result.shapes, null, 2).slice(0, 9000), '```');
  }
  return lines.join('\n');
}
