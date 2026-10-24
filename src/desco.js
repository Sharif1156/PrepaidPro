import { requestJson } from './http.js';
import { accountNotFound, badRequest, upstreamError } from './errors.js';
import { config } from './config.js';

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
const MONTH_COST_KEYS = ['currentmonthconsumption', 'currentmonthbill', 'monthlyconsumption', 'currentmonthcost'];
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

function monthRange(monthsBack) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  return { monthFrom: from.toISOString().slice(0, 7), monthTo: now.toISOString().slice(0, 7) };
}

function dateRange(daysBack) {
  const now = new Date();
  const from = new Date(now.getTime() - daysBack * 86_400_000);
  return { dateFrom: ymd(from), dateTo: ymd(now) };
}

function yearMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalizeMonthly(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const index = indexKeys(toObject(row));
      const month =
        pickString(index, ['month', 'monthname', 'consumptionmonth', 'billyearmonth']) ||
        pickString(index, ['yearmonth']);
      const normalisedMonth = parseMonth(month);
      if (!normalisedMonth) return null;
      return {
        month: normalisedMonth,
        unit: pickNumber(index, ['consumedunit', 'consumptionunit', 'unit', 'totalunit', 'consumedkwh']),
        taka: pickNumber(index, ['consumedtaka', 'consumptiontaka', 'taka', 'amount', 'bill', 'totalamount']),
        demand: pickNumber(index, ['maximumdemand', 'maxdemand', 'demand']),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.month.localeCompare(b.month));
}

function normalizeRecharges(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const index = indexKeys(toObject(row));
      const date = parseBdDate(
        pickString(index, ['rechargedate', 'rechargedtime', 'purchasedate', 'date', 'transactiondate']),
      );
      const amount = pickNumber(index, ['totalamount', 'rechargeamount', 'amount', 'paidamount']);
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
export async function fetchDesco(accountNo, { historyDays = config.historyDays, refresh = false } = {}) {
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
