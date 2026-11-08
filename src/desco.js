import { requestJson } from './http.js';
import { AppError, accountNotFound, badRequest, upstreamError } from './errors.js';
import { config } from './config.js';
import { randomUUID } from 'node:crypto';
import { api, accountIdFor, credentials, descoBase, hasPersonalClient } from './desco-session.js';

/**
 * DESCO exposes two generations of the same public API:
 *
 *   /api/tkdes/customer/*     older meters (also returns balance)
 *   /api/unified/customer/*   newer meters (sometimes balance is null)
 *
 * Both are public, unauthenticated JSON endpoints used by the official
 * customer portal at https://prepaid.desco.org.bd/customer.
 * They are undocumented and can change without notice.
 */
const API_BASE = 'https://prepaid.desco.org.bd/api';
const SOURCES = [
  { id: 'tkdes', base: `${API_BASE}/tkdes/customer` },
  { id: 'unified', base: `${API_BASE}/unified/customer` },
];

const BALANCE_KEYS = ['balance', 'remainingbalance', 'balanceamount', 'remainingbalanceamount'];
const METER_KEYS = ['meterno', 'meternumber', 'meterid'];
const READING_KEYS = ['readingtime', 'lastreadingtime', 'readingdate', 'lastreadingdate', 'updatedtime'];
const MONTH_COST_KEYS = ['currentmonthconsumedtaka', 'currentmonthconsumption', 'currentmonthbill', 'monthlyconsumption', 'currentmonthcost'];
const MONTH_UNIT_KEYS = ['currentmonthunit', 'currentmonthconsumptionunit', 'monthlyunit'];

export function normalizeAccountNo(value) {
  return String(value ?? '').replace(/[^\d]/g, '');
}

export function validateAccountNo(value) {
  const account = normalizeAccountNo(value);
  if (account.length < 6 || account.length > 16) {
    throw badRequest('A DESCO account number must contain 6 to 16 digits.');
  }
  return account;
}

/** DESCO sometimes returns `data` as an object, sometimes as [[key, value], ...]. */
export function toObject(data) {
  if (!data) return {};
  if (Array.isArray(data)) {
    if (data.every((row) => Array.isArray(row) && row.length >= 2)) {
      return Object.fromEntries(data.map(([key, value]) => [String(key), value]));
    }
    if (data.length === 1 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      return data[0];
    }
    return {};
  }
  return typeof data === 'object' ? data : {};
}

function indexKeys(object) {
  const index = new Map();
  for (const [key, value] of Object.entries(object || {})) {
    index.set(key.toLowerCase().replace(/[^a-z0-9]/g, ''), value);
  }
  return index;
}

function pickString(index, keys) {
  for (const key of keys) {
    const value = index.get(key);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

function pickNumber(index, keys) {
  const raw = pickString(index, keys);
  if (raw === null) return null;
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

const MONTH_NAMES = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  'জানুয়ারি': '01', 'ফেব্রুয়ারি': '02', 'মার্চ': '03', 'এপ্রিল': '04', 'মে': '05',
  'জুন': '06', 'জুলাই': '07', 'আগস্ট': '08', 'সেপ্টেম্বর': '09', 'অক্টোবর': '10',
  'নভেম্বর': '11', 'ডিসেম্বর': '12',
};

/** Best-effort conversion of the many month formats DESCO has used. */
export function parseMonth(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}/.test(text)) return text.slice(0, 7);
  const isoMonth = text.match(/^(\d{1,2})[/-](\d{4})$/);
  if (isoMonth) return `${isoMonth[2]}-${isoMonth[1].padStart(2, '0')}`;
  const monthYear = text.match(/^([A-Za-z\u0980-\u09FF]+)[\s,/-]+(\d{4})$/);
  if (monthYear) {
    const month = MONTH_NAMES[monthYear[1].toLowerCase()];
    if (month) return `${monthYear[2]}-${month}`;
  }
  const yearMonth = text.match(/^(\d{4})[\s,/-]+([A-Za-z\u0980-\u09FF]+)$/);
  if (yearMonth) {
    const month = MONTH_NAMES[yearMonth[2].toLowerCase()];
    if (month) return `${yearMonth[1]}-${month}`;
  }
  return null;
}

const DATE_PATTERNS = [
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/,
];

/**
 * Normalise dates to an ISO-8601 string in Bangladesh time (+06:00).
 * Unknown formats are returned untouched so the UI can still show something.
 */
export function parseBdDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  let match = text.match(DATE_PATTERNS[0]);
  if (match) return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+06:00`;
  match = text.match(DATE_PATTERNS[1]);
  if (match) return `${match[1]}-${match[2]}-${match[3]}T00:00:00+06:00`;
  match = text.match(DATE_PATTERNS[2]);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    return `${match[3]}-${month}-${day}T00:00:00+06:00`;
  }
  const named = text.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{4})$/);
  if (named) {
    const month = MONTH_NAMES[named[2].toLowerCase()];
    if (month) return `${named[3]}-${month}-${named[1].padStart(2, '0')}T00:00:00+06:00`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

export function monthRange(monthsBack) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  return { monthFrom: from.toISOString().slice(0, 7), monthTo: now.toISOString().slice(0, 7) };
}

export function dateRange(daysBack) {
  const now = new Date();
  const from = new Date(now.getTime() - daysBack * 86_400_000);
  return { dateFrom: ymd(from), dateTo: ymd(now) };
}

function yearMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function normalizeMonthly(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const index = indexKeys(toObject(row));
      const month =
        pickString(index, ['month', 'monthname', 'consumptionmonth', 'billyearmonth', 'monthyear', 'billingmonth', 'periodmonth']) ||
        pickString(index, ['yearmonth']);
      const normalisedMonth = parseMonth(month);
      if (!normalisedMonth) return null;
      return {
        month: normalisedMonth,
        unit: pickNumber(index, ['consumedunit', 'consumptionunit', 'unit', 'totalunit', 'consumedkwh', 'kwh', 'energykwh', 'consumedenergy']),
        taka: pickNumber(index, ['consumedtaka', 'consumptiontaka', 'taka', 'amount', 'bill', 'totalamount']),
        demand: pickNumber(index, ['maximumdemand', 'maxdemand', 'demand']),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function normalizeRecharges(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const index = indexKeys(toObject(row));
      const date = parseBdDate(
        pickString(index, ['rechargedate', 'rechargedtime', 'purchasedate', 'date', 'transactiondate', 'transactiontime', 'paidat', 'createdat', 'timestamp']),
      );
      const amount = pickNumber(index, ['totalamount', 'rechargeamount', 'amount', 'paidamount', 'grossamount', 'netamount']);
      return {
        date,
        amount,
        energyAmount: pickNumber(index, ['energyamount', 'purchaseamount', 'energy']),
        vat: pickNumber(index, ['vat', 'vatamount']),
        method: pickString(index, ['salename', 'method', 'rechargemethod', 'paymentmethod']),
        tokenNo: pickString(index, ['tokenno', 'token', 'tokenumber']),
      };
    })
    .filter((row) => row.date || row.amount !== null)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function normalizeCustomer(index) {
  return {
    name: pickString(index, ['customername', 'name', 'consumername']),
    address: pickString(index, ['address', 'customeraddress']),
    mobile: pickString(index, ['mobile', 'mobileno', 'phone', 'contactno']),
    tariff: pickString(index, ['tariff', 'tariffcategory', 'tarifftype']),
    feeder: pickString(index, ['feeder', 'feedername']),
    division: pickString(index, ['sndivision', 'division', 'salesdistributiondivision', 'sddivision']),
    meterType: pickString(index, ['metertype', 'phasetype']),
    installationDate: parseBdDate(pickString(index, ['installationdate', 'installdate'])),
    consumerNo: pickString(index, ['consumerno', 'customerno', 'consumerid']),
  };
}

async function tryJson(url) {
  try {
    return await requestJson(url, { timeoutMs: 12_000 });
  } catch (error) {
    return { __error: error };
  }
}

/**
 * Fetch and normalise a DESCO prepaid account.
 * Throws AppError with a machine-readable code on failure.
 */
async function fetchDescoPublic(accountNo, { historyDays = config.historyDays, refresh = false } = {}) {
  const account = validateAccountNo(accountNo);
  const query = `accountNo=${encodeURIComponent(account)}`;

  let balancePayload = null;
  let source = null;
  let lastError = null;

  // The three "details" calls (info, monthly, recharges) do not depend on the
  // balance value, only on which API generation answers. Start them for the
  // first source at the same time as its balance call instead of afterwards:
  // one round trip of waiting instead of two.
  const extrasBySource = new Map();
  const extrasFor = (candidate) => {
    if (!extrasBySource.has(candidate.id)) {
      const base = candidate.base;
      extrasBySource.set(
        candidate.id,
        Promise.all([
          tryJson(`${base}/getCustomerInfo?${query}`),
          tryJson(
            `${base}/getCustomerMonthlyConsumption?${query}&monthFrom=${monthRange(11).monthFrom}&monthTo=${
              monthRange(0).monthTo
            }`,
          ),
          tryJson(
            `${base}/getRechargeHistory?${query}&dateFrom=${dateRange(historyDays).dateFrom}&dateTo=${
              dateRange(0).dateTo
            }`,
          ),
        ]),
      );
    }
    return extrasBySource.get(candidate.id);
  };

  const firstBalance = tryJson(`${SOURCES[0].base}/getBalance?${query}`);
  extrasFor(SOURCES[0]);

  for (const candidate of SOURCES) {
    const payload = candidate === SOURCES[0] ? await firstBalance : await tryJson(`${candidate.base}/getBalance?${query}`);
    if (payload.__error) {
      lastError = payload.__error;
      continue;
    }
    const data = toObject(payload?.data ?? payload);
    const index = indexKeys(data);
    const balance = pickNumber(index, BALANCE_KEYS);
    if (balance !== null) {
      balancePayload = data;
      source = candidate;
      break;
    }
    // Keep an empty payload as a last resort so "no balance" accounts still
    // get customer details instead of a hard failure.
    if (!balancePayload) {
      balancePayload = data;
      source = candidate;
    }
  }

  if (!balancePayload) {
    throw lastError || accountNotFound('DESCO');
  }

  const balanceIndex = indexKeys(balancePayload);
  const [infoPayload, monthlyPayload, rechargePayload] = await extrasFor(source);

  const infoIndex = infoPayload.__error ? new Map() : indexKeys(toObject(infoPayload?.data ?? infoPayload));
  const customer = normalizeCustomer(infoIndex);
  const monthly = monthlyPayload.__error ? [] : normalizeMonthly(monthlyPayload?.data);
  const recharges = rechargePayload.__error ? [] : normalizeRecharges(rechargePayload?.data);

  const balance = pickNumber(balanceIndex, BALANCE_KEYS);
  const meterNo = pickString(balanceIndex, METER_KEYS) || pickString(infoIndex, METER_KEYS);
  const readingTime = parseBdDate(pickString(balanceIndex, READING_KEYS) || pickString(infoIndex, READING_KEYS));

  const currentMonth =
    monthly.find((row) => row.month === yearMonth(new Date())) || monthly[monthly.length - 1] || null;

  if (balance === null && !customer.name && !meterNo && recharges.length === 0) {
    throw accountNotFound('DESCO');
  }

  return {
    provider: 'desco',
    accountNo: account,
    source: source.id,
    demo: false,
    balance,
    meterNo: meterNo || null,
    readingTime: readingTime || null,
    customer,
    currentMonth: currentMonth
      ? { month: currentMonth.month, taka: currentMonth.taka, unit: currentMonth.unit }
      : {
          month: yearMonth(new Date()),
          taka: pickNumber(balanceIndex, MONTH_COST_KEYS),
          unit: pickNumber(balanceIndex, MONTH_UNIT_KEYS),
        },
    monthly,
    recharges,
    fetchedAt: new Date().toISOString(),
    meta: { historyDays, refresh },
  };
}

/** First array found in a payload, whatever the portal calls it. */
export function rowsOf(payload, depth = 0) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object' || depth > 2) return [];
  for (const value of Object.values(payload)) if (Array.isArray(value)) return value;
  for (const value of Object.values(payload)) {
    const rows = rowsOf(value, depth + 1);
    if (rows.length) return rows;
  }
  return [];
}

async function trySession(path, query) {
  try {
    return await api(path, { query });
  } catch (error) {
    return { __error: error };
  }
}

/** New portal: signed-in session, meter linked to the server's DESCO login. */
async function fetchDescoSession(accountNo, { historyDays = config.historyDays, refresh = false } = {}) {
  const account = validateAccountNo(accountNo);
  const id = await accountIdFor(account);
  const base = `/api/accounts/${encodeURIComponent(id)}`;

  const [balancePayload, summaryPayload, monthlyPayload, transactionPayload, dailyPayload, tokenPayload] =
    await Promise.all([
      api(`${base}/balance`),
      trySession(`${base}/summary`),
      trySession(`${base}/usage/monthly`, monthRange(11)),
      trySession(`${base}/transactions`, dateRange(historyDays)),
      trySession(`${base}/usage/daily`, dateRange(30)),
      trySession(`${base}/tokens`, dateRange(historyDays)),
    ]);

  const balanceIndex = indexKeys(toObject(balancePayload?.data ?? balancePayload));
  const infoIndex = summaryPayload.__error
    ? new Map()
    : indexKeys(toObject(summaryPayload?.data ?? summaryPayload));
  const customer = normalizeCustomer(infoIndex);
  const monthly = monthlyPayload.__error ? [] : normalizeMonthly(rowsOf(monthlyPayload));
  const recharges = transactionPayload.__error ? [] : normalizeRecharges(rowsOf(transactionPayload));
  const daily = dailyPayload.__error ? [] : normalizeDaily(rowsOf(dailyPayload));
  const tokens = tokenPayload.__error ? [] : normalizeTokens(rowsOf(tokenPayload));

  const balance = pickNumber(balanceIndex, BALANCE_KEYS);
  if (balance === null) throw accountNotFound('DESCO');
  const meterNo = pickString(balanceIndex, METER_KEYS) || pickString(infoIndex, METER_KEYS);
  const readingTime = parseBdDate(pickString(balanceIndex, READING_KEYS));
  const currentMonth =
    monthly.find((row) => row.month === yearMonth(new Date())) || monthly[monthly.length - 1] || null;

  return {
    provider: 'desco',
    accountNo: account,
    source: 'portal',
    demo: false,
    balance,
    meterNo: meterNo || null,
    readingTime: readingTime || null,
    customer,
    currentMonth: currentMonth
      ? { month: currentMonth.month, taka: currentMonth.taka, unit: currentMonth.unit }
      : {
          month: yearMonth(new Date()),
          taka: pickNumber(balanceIndex, MONTH_COST_KEYS),
          unit: pickNumber(balanceIndex, MONTH_UNIT_KEYS),
        },
    monthly,
    recharges,
    daily,
    tokens,
    fetchedAt: new Date().toISOString(),
    meta: { historyDays, refresh, stale: balancePayload?.stale === true },
  };
}

/**
 * With DESCO_USERNAME / DESCO_PASSWORD set, use the new signed-in portal.
 * Without them, fall back to the old public endpoints.
 */
export function fetchDesco(accountNo, options) {
  return credentials() || hasPersonalClient()
    ? fetchDescoSession(accountNo, options)
    : fetchDescoPublic(accountNo, options);
}

/* ------------------------- daily usage and token lists ------------------------ */

export function normalizeDaily(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const index = indexKeys(toObject(row));
      const raw = pickString(index, ['date', 'day', 'usagedate', 'consumptiondate', 'readingdate', 'consumeddate']);
      const iso = parseBdDate(raw);
      if (!iso) return null;
      return {
        date: String(iso).slice(0, 10),
        unit: pickNumber(index, ['consumedunit', 'consumptionunit', 'unit', 'totalunit', 'consumedkwh', 'kwh', 'energykwh', 'consumedenergy']),
        taka: pickNumber(index, ['consumedtaka', 'consumptiontaka', 'taka', 'amount', 'bill', 'totalamount']),
      };
    })
    .filter((row) => row && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeTokens(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const index = indexKeys(toObject(row));
      return {
        date: parseBdDate(
          pickString(index, ['tokendate', 'issuedat', 'rechargedate', 'transactiondate', 'transactiontime', 'createdat', 'date', 'timestamp']),
        ),
        tokenNo: pickString(index, ['tokenno', 'token', 'tokennumber', 'tokenvalue', 'tokencode']),
        amount: pickNumber(index, ['totalamount', 'rechargeamount', 'amount', 'paidamount', 'grossamount']),
        unit: pickNumber(index, ['tokenunit', 'unit', 'units', 'kwh', 'energy', 'energykwh']),
      };
    })
    .filter((row) => row.tokenNo)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/* ------------------------------ DESCO notices ------------------------------ */

function noticeWindowOpen(item, now) {
  const starts = item.startsAt ? Date.parse(item.startsAt) : null;
  const ends = item.endsAt ? Date.parse(item.endsAt) : null;
  return !(starts && now < starts) && !(ends && now > ends);
}

/** Public announcements from the DESCO portal (no login needed). */
export async function fetchDescoNotices() {
  const base = descoBase();
  const [active, homepage] = await Promise.all([
    requestJson(`${base}/api/public/notices/active`, { timeoutMs: 12_000 }).catch(() => []),
    requestJson(`${base}/api/public/notices/homepage`, { timeoutMs: 12_000 }).catch(() => []),
  ]);
  const now = Date.now();
  const seen = new Set();
  const list = [];
  for (const item of [...rowsOf(homepage), ...rowsOf(active)]) {
    if (!item || typeof item !== 'object' || !item.title || !noticeWindowOpen(item, now)) continue;
    const id = String(item.id ?? item.title);
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({
      id,
      title: String(item.title).slice(0, 200),
      body: String(item.body || '').slice(0, 2500),
      priority: String(item.priority || 'NORMAL').toUpperCase(),
      updatedAt: item.updatedAt || item.startsAt || null,
    });
  }
  const rank = { EMERGENCY: 0, HIGH: 1, NORMAL: 2 };
  return list.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)).slice(0, 5);
}

/* --------------------------- realtime meter balance --------------------------- */

const REALTIME_GAP_MS = 60 * 60 * 1000; // the portal itself allows only 3 per meter per day
const realtimeLast = new Map();

/**
 * Ask the meter itself for its balance right now. The portal limits this to a
 * few requests a day per meter, so we also wait an hour between our own calls.
 */
export async function requestRealtimeBalance(accountNo) {
  const account = validateAccountNo(accountNo);
  if (!credentials() && !hasPersonalClient()) {
    throw new AppError('DESCO_LOGIN_MISSING', 'Sign in with your DESCO account first.', { status: 503, retryable: false });
  }
  const last = realtimeLast.get(account) || 0;
  const wait = last + REALTIME_GAP_MS - Date.now();
  if (wait > 0) {
    throw new AppError(
      'REALTIME_COOLDOWN',
      `The meter was asked a moment ago. Try again in ${Math.ceil(wait / 60_000)} minutes.`,
      { status: 429, retryable: false, details: { retryAfterSeconds: Math.ceil(wait / 1000) } },
    );
  }
  const id = await accountIdFor(account);
  let result;
  try {
    result = await api(`/api/accounts/${encodeURIComponent(id)}/realtime-balance`, {
      method: 'POST',
      body: { idempotencyKey: randomUUID() },
      timeoutMs: 40_000,
    });
  } catch (error) {
    if (error?.code === 'UPSTREAM_HTTP_ERROR') {
      throw new AppError(
        'REALTIME_REFUSED',
        error.details?.message || 'The portal did not allow a live meter reading right now.',
        { status: 409, retryable: false, details: error.details },
      );
    }
    throw error;
  }
  realtimeLast.set(account, Date.now());
  const index = indexKeys(toObject(result));
  const balance = pickNumber(index, BALANCE_KEYS);
  if (balance === null) {
    throw new AppError('REALTIME_REFUSED', 'The meter did not send a balance. Try again later.', { status: 409, retryable: false });
  }
  return {
    balance,
    readingTime: parseBdDate(pickString(index, ['receivedat', 'readingtime', 'requestedat'])),
    remainingAttempts: pickNumber(index, ['remainingattempts']),
  };
}
