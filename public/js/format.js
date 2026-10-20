/** Locale-aware formatting helpers. All money is BDT. */

/**
 * `bn-BD-u-nu-beng` asks ICU for Bengali numerals (০১২৩…) explicitly, which is
 * what people actually read on a Bangladeshi electricity bill. `timeZone` is
 * pinned to Asia/Dhaka in every formatter so a meter reading never shifts by a
 * day because the phone is travelling.
 */
const LOCALES = { en: 'en-BD', bn: 'bn-BD-u-nu-beng' };

export function localeFor(lang) {
  return LOCALES[lang] || LOCALES.en;
}

function toNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatNumber(value, lang = 'en', options = {}) {
  const number = toNumber(value);
  if (number === null) return '--';
  return new Intl.NumberFormat(localeFor(lang), {
    maximumFractionDigits: 2,
    ...options,
  }).format(number);
}

export function formatMoney(value, lang = 'en', { decimals, compact = false } = {}) {
  const number = toNumber(value);
  if (number === null) return '--';
  if (compact && Math.abs(number) >= 100000) {
    const formatted = new Intl.NumberFormat(localeFor(lang), {
      maximumFractionDigits: 1,
    }).format(number / 100000);
    return `\u09F3${formatted}L`;
  }
  const formatted = new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: decimals === undefined ? (Number.isInteger(number) ? 0 : 2) : decimals,
    maximumFractionDigits: decimals === undefined ? 2 : decimals,
  }).format(number);
  return `\u09F3${formatted}`;
}

export function formatUnit(value, lang = 'en') {
  const number = toNumber(value);
  if (number === null) return '--';
  return `${new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 1 }).format(number)} kWh`;
}

export function formatDate(value, lang = 'en', options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const { withTime = false, short = false } = options;
  return new Intl.DateTimeFormat(localeFor(lang), {
    day: 'numeric',
    month: short ? 'short' : 'long',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'Asia/Dhaka',
  }).format(date);
}

export function formatDayMonth(value, lang = 'en') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat(localeFor(lang), {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Dhaka',
  }).format(date);
}

export function formatMonth(monthKey, lang = 'en', { short = true } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return String(monthKey || '--');
  const date = new Date(`${monthKey}-01T12:00:00+06:00`);
  return new Intl.DateTimeFormat(localeFor(lang), {
    month: short ? 'short' : 'long',
    year: '2-digit',
    timeZone: 'Asia/Dhaka',
  }).format(date);
}

export function formatTimeAgo(value, lang = 'en', now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' });
  if (abs < 60) return formatter.format(Math.round(diffSeconds), 'second');
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return formatter.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 604800) return formatter.format(Math.round(diffSeconds / 86400), 'day');
  return formatDate(date, lang, { short: true });
}

export function formatDuration(days, lang = 'en') {
  if (days === null || days === undefined || Number.isNaN(days)) return '--';
  if (days < 0.5) return lang === 'bn' ? 'এক দিনেরও কম' : 'under a day';
  if (days < 1) return lang === 'bn' ? 'প্রায় ১ দিন' : 'about 1 day';
  const rounded = Math.round(days);
  return lang === 'bn' ? `${rounded} দিন` : `${rounded} day${rounded === 1 ? '' : 's'}`;
}

export function dayKey(date) {
  const value = date instanceof Date ? date : new Date(date);
  const local = new Date(value.getTime() + 6 * 3600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(
    local.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function monthKey(date) {
  const value = date instanceof Date ? date : new Date(date);
  const local = new Date(value.getTime() + 6 * 3600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function pluralize(count, singular, plural, lang = 'en') {
  if (lang === 'bn') return `${formatNumber(count, lang)} ${singular}`;
  return `${formatNumber(count, lang)} ${count === 1 ? singular : plural || `${singular}s`}`;
}
