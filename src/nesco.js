import { request, requestText } from './http.js';
import { accountNotFound, badRequest, upstreamError } from './errors.js';
import { normalizeAccountNo } from './desco.js';
import { config } from './config.js';

/**
 * NESCO (Northern Electricity Supply Company) has no public JSON API.
 * Its customer portal renders balance / recharge / usage data server-side,
 * inside a session that starts with a CSRF token and a cookie.
 *
 * This module recreates that three-step flow:
 *   1. GET  /pre/panel                       -> token + session cookie
 *   2. POST /pre/panel (recharge history)    -> customer info + recharges
 *   3. POST /pre/panel (monthly usage)       -> monthly consumption table
 *
 * Because it is HTML scraping it is inherently more fragile than DESCO's
 * JSON endpoints. Parsers live here as pure functions so they can be tested
 * against saved fixtures.
 */
export const PORTAL_ORIGIN = 'https://customer.nesco.gov.bd';
export const PANEL_URL = `${PORTAL_ORIGIN}/pre/panel`;

// The portal's submit buttons are identified by their Bengali labels.
export const SUBMIT_HISTORY = '\u09B0\u09BF\u099A\u09BE\u09B0\u09CD\u099C \u09B9\u09BF\u09B8\u09CD\u099F\u09CD\u09B0\u09BF'; // রিচার্জ হিস্ট্রি
export const SUBMIT_MONTHLY = '\u09AE\u09BE\u09B8\u09BF\u0995 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0'; // মাসিক ব্যবহার

export function validateCustomerNo(value) {
  const customer = normalizeAccountNo(value);
  if (customer.length < 5 || customer.length > 14) {
    throw badRequest('A NESCO customer number must contain 5 to 14 digits.');
  }
  return customer;
}

export function extractCsrfToken(html) {
  const patterns = [
    /name=["']_token["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']_token["']/i,
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function cookieHeaderFrom(setCookies) {
  const jar = new Map();
  for (const raw of setCookies || []) {
    const [pair] = String(raw).split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function setCookieList(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function textOf(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function inputValues(html) {
  const values = [];
  const re = /<input\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const tag = match[0];
    if (!/value\s*=/i.test(tag)) continue;
    const value = tag.match(/value\s*=\s*["']([^"']*)["']/i);
    if (value) values.push(value[1].trim());
  }
  return values;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`data-${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function stripTags(value) {
  return textOf(value);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const MONTH_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  'জানুয়ারি': 1, 'ফেব্রুয়ারি': 2, 'মার্চ': 3, 'এপ্রিল': 4, 'মে': 5, 'জুন': 6,
  'জুলাই': 7, 'আগস্ট': 8, 'সেপ্টেম্বর': 9, 'অক্টোবর': 10, 'নভেম্বর': 11, 'ডিসেম্বর': 12,
};

function parseMonthCell(text) {
  const value = String(text || '').trim().toLowerCase();
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  for (const [name, month] of Object.entries(MONTH_MAP)) {
    if (value.includes(name)) return String(month).padStart(2, '0');
  }
  return null;
}

/**
 * Parse the customer information block plus recharge history rows.
 * Returns { info, history } where `history` keeps the raw data-* map.
 */
export function parseNescoPanel(html) {
  const source = String(html || '');
  const info = {};

  const start = source.indexOf('id="con_info_div"');
  if (start >= 0) {
    let end = source.indexOf('consumerRechargeData', start);
    if (end < 0) end = source.indexOf('arrear_notice_div', start);
    if (end < 0) end = Math.min(start + 40_000, source.length);
    const segment = source.slice(start, end);
    const values = inputValues(segment);
    const take = (index) => (values[index] || '').trim();
    const positional = {
      name: take(0),
      fatherOrHusband: take(1),
      address: take(2),
      mobile: take(3),
      office: take(4),
      feeder: take(5),
      consumerNo: take(6),
      meterNo: take(7),
      sanctionedLoad: take(8),
      tariff: take(9),
      meterType: take(10),
      meterStatus: take(11),
      installDate: take(12),
      minimumRecharge: take(13),
      balance: take(14),
    };
    Object.assign(info, positional);
  }

  // Label-aware fallbacks: some portal versions render the balance outside
  // the information div, for example inside a card header.
  if (!info.balance) {
    const patterns = [
      /অবশিষ্ট\s*ব্যালেন্স[\s\S]{0,300}?value\s*=\s*["']\s*(-?[\d,.]+)\s*["']/i,
      /(?:remaining|অবশিষ্ট)\s*(?:balance|ব্যালেন্স)[\s\S]{0,300}?(-?\d[\d,]*\.?\d*)/i,
      /data-balance\s*=\s*["'](-?[\d,.]+)["']/i,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        info.balance = match[1].replace(/[,\s]/g, '');
        break;
      }
    }
  }

  const dateMatch = source.match(
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
  );
  if (dateMatch) info.readingDate = dateMatch[1].trim();

  const history = [];
  const rowRe = /<[^>]*?data-totalamount\s*=\s*["'][^"']*["'][^>]*>/gi;
  let row;
  while ((row = rowRe.exec(source))) {
    const tag = row[0];
    const record = {
      order: attr(tag, 'order'),
      token: attr(tag, 'token'),
      seq: attr(tag, 'seq'),
      rent: toNumber(attr(tag, 'rent')),
      demandCharge: toNumber(attr(tag, 'demandcharge')),
      vat: toNumber(attr(tag, 'tax')),
      pfc: toNumber(attr(tag, 'pfc')),
      subsidy: toNumber(attr(tag, 'subsidyamount')),
      electricityAmount: toNumber(attr(tag, 'purchaseamount')),
      rechargeAmount: toNumber(attr(tag, 'totalamount')),
      energyUnit: toNumber(attr(tag, 'purchaseenergy')),
      method: attr(tag, 'salename'),
      rechargeDate: attr(tag, 'purchasedate'),
      debtAmount: toNumber(attr(tag, 'debtamount')),
      paidAmount: toNumber(attr(tag, 'paidamount')),
      meterNo: attr(tag, 'meterno'),
      customerNo: attr(tag, 'customerno'),
      customerName: attr(tag, 'customername'),
      tariff: attr(tag, 'tariff'),
      organization: attr(tag, 'organization'),
      rechargeStatus: '',
    };

    // The last cell of the row carries the success/failure status.
    const cellStart = row.index + tag.length;
    let rowEnd = source.indexOf('</tr>', cellStart);
    if (rowEnd < 0 || rowEnd - cellStart > 20_000) rowEnd = Math.min(cellStart + 20_000, source.length);
    const cells = [...source.slice(cellStart, rowEnd).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    for (const cell of cells) {
      const value = stripTags(cell[1]);
      if (value) record.rechargeStatus = value;
    }
    if (record.rechargeStatus.length > 30) record.rechargeStatus = '';
    history.push(record);
  }

  if (!info.consumerNo && history.length) {
    const first = history[0];
    info.consumerNo = first.customerNo || '';
    info.meterNo = info.meterNo || first.meterNo || '';
    info.name = info.name || first.customerName || '';
    info.tariff = info.tariff || first.tariff || '';
  }

  return { info, history };
}

/** Parse the "মাসিক ব্যবহার" (monthly usage) table. */
export function parseNescoMonthly(html) {
  const source = String(html || '');
  const rows = [];
  const tables = [...source.matchAll(/<table[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const candidates = tables.length ? tables : [source];

  for (const table of candidates) {
    const headerMatch = table.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    let unitIndex = -1;
    let takaIndex = -1;
    if (headerMatch) {
      const headers = [...headerMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) =>
        stripTags(match[1]),
      );
      headers.forEach((header, index) => {
        if (/কি\.ও\.আ|kwh|unit/i.test(header)) unitIndex = index;
        if (/টাকা|taka|amount|bill/i.test(header)) takaIndex = index;
      });
    }

    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let row;
    while ((row = rowRe.exec(table))) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripTags(match[1]));
      if (cells.length < 4) continue;

      let month = null;
      let year = null;
      for (const cell of cells) {
        if (!month) month = parseMonthCell(cell);
        if (!year && /^(19|20)\d{2}$/.test(cell.trim())) year = cell.trim();
      }
      if (!month || !year) continue;

      const numbers = cells.map((cell) => toNumber(cell)).filter((value) => value !== null);
      if (!numbers.length) continue;

      const unit = unitIndex >= 0 ? toNumber(cells[unitIndex]) : numbers[numbers.length - 1];
      const taka = takaIndex >= 0 ? toNumber(cells[takaIndex]) : numbers.length >= 2 ? numbers[numbers.length - 2] : null;
      rows.push({ month: `${year}-${month}`, unit: unit ?? null, taka: taka ?? null, demand: null });
    }
    if (rows.length) break;
  }

  // De-duplicate months, keeping the first parsed row.
  const seen = new Set();
  return rows
    .filter((row) => {
      if (seen.has(row.month)) return false;
      seen.add(row.month);
      return true;
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}T00:00:00+06:00`;
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (named) {
    const month = MONTH_MAP[named[2].toLowerCase()];
    if (month) return `${named[3]}-${String(month).padStart(2, '0')}-${named[1].padStart(2, '0')}T00:00:00+06:00`;
  }
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00+06:00`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text || null : parsed.toISOString();
}

async function startSession() {
  const { response, text } = await requestText(PANEL_URL, {
    timeoutMs: 15_000,
    headers: { Referer: `${PORTAL_ORIGIN}/` },
  });
  const token = extractCsrfToken(text);
  if (!token) {
    throw upstreamError('NESCO portal did not return a CSRF token. The portal layout may have changed.', {
      upstreamStatus: response.status,
    });
  }
  const cookie = cookieHeaderFrom(setCookieList(response.headers));
  return { token, cookie };
}

async function submitPanel(session, customerNo, submitLabel) {
  const body = new URLSearchParams({
    _token: session.token,
    cust_no: customerNo,
    submit: submitLabel,
  }).toString();

  const response = await request(PANEL_URL, {
    method: 'POST',
    timeoutMs: 20_000,
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: PORTAL_ORIGIN,
      Referer: PANEL_URL,
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw upstreamError(`NESCO portal responded with HTTP ${response.status}.`, {
      upstreamStatus: response.status,
    });
  }
  return text;
}

const NOT_FOUND_PATTERNS = [/কোনো\s*তথ্য\s*পাওয়া\s*যায়নি/, /no\s+(?:data|customer)\s+found/i, /invalid\s+customer/i];

export async function fetchNesco(customerNo, { refresh = false } = {}) {
  const customer = validateCustomerNo(customerNo);
  const session = await startSession();

  const historyHtml = await submitPanel(session, customer, SUBMIT_HISTORY);
  const { info, history } = parseNescoPanel(historyHtml);

  let monthly = [];
  try {
    const monthlyHtml = await submitPanel(session, customer, SUBMIT_MONTHLY);
    monthly = parseNescoMonthly(monthlyHtml);
  } catch {
    // Monthly usage is a bonus; balance and recharges are what matter.
  }

  const hasData = Boolean(info.consumerNo || info.meterNo || info.name || history.length);
  if (!hasData) {
    const flattened = textOf(historyHtml);
    if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(flattened))) {
      throw accountNotFound('NESCO');
    }
    throw upstreamError('NESCO returned no customer data. The portal may have changed or blocked this request.');
  }

  const recharges = history
    .map((row) => ({
      date: normalizeDate(row.rechargeDate),
      amount: row.rechargeAmount,
      energyAmount: row.electricityAmount,
      vat: row.vat,
      method: row.method || null,
      tokenNo: row.token || null,
      status: row.rechargeStatus || null,
    }))
    .filter((row) => row.date || row.amount !== null)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const currentMonth = monthly.find((row) => row.month === new Date().toISOString().slice(0, 7));

  return {
    provider: 'nesco',
    accountNo: customer,
    source: 'portal',
    demo: false,
    balance: toNumber(info.balance),
    meterNo: info.meterNo || null,
    readingTime: normalizeDate(info.readingDate) || null,
    customer: {
      name: info.name || null,
      address: info.address || null,
      mobile: info.mobile || null,
      tariff: info.tariff || null,
      feeder: info.feeder || null,
      division: info.office || null,
      meterType: info.meterType || null,
      installationDate: normalizeDate(info.installDate),
      consumerNo: info.consumerNo || customer,
      meterStatus: info.meterStatus || null,
      sanctionedLoad: info.sanctionedLoad || null,
      minimumRecharge: toNumber(info.minimumRecharge),
    },
    currentMonth: currentMonth || null,
    monthly,
    recharges,
    fetchedAt: new Date().toISOString(),
    meta: { refresh, scraped: true, historyDays: config.historyDays },
  };
}
