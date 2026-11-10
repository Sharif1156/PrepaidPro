import { h, openModal, toast } from '../ui.js';
import { formatMoney, formatNumber, formatDate } from '../format.js';

const prettyKey = (key) =>
  String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

/** A recharge in full: the main figures first, then every other field the portal returned. */
export function openRechargeDetail(ctx, row) {
  const { t, lang } = ctx;
  const main = [
    [t('detail.date'), row.date ? formatDate(row.date, lang, { withTime: true }) : '--'],
    [t('detail.total'), formatMoney(row.amount, lang)],
    row.energyAmount !== null && row.energyAmount !== undefined ? [t('detail.energy'), formatMoney(row.energyAmount, lang)] : null,
    row.vat !== null && row.vat !== undefined ? [t('detail.vat'), formatMoney(row.vat, lang)] : null,
    row.method ? [t('detail.method'), row.method] : null,
    row.tokenNo ? [t('detail.token'), row.tokenNo] : null,
  ].filter(Boolean);

  const shown = new Set(main.map(([label]) => label.toLowerCase()));
  const extra = (row.details || [])
    .filter(([key]) => !shown.has(prettyKey(key).toLowerCase()))
    .map(([key, value]) => [prettyKey(key), typeof value === 'number' ? formatNumber(value, lang, { maximumFractionDigits: 2 }) : String(value)]);

  const list = (items) =>
    h(
      'dl',
      { class: 'kv' },
      ...items.map(([label, value]) => h('div', { class: 'kv-item' }, h('dt', {}, label), h('dd', {}, value))),
    );

  const copy = row.tokenNo
    ? h(
        'button',
        {
          class: 'btn sm',
          type: 'button',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(row.tokenNo);
              toast(t('tokens.copied'));
            } catch {
              /* clipboard blocked */
            }
          },
        },
        t('detail.copyToken'),
      )
    : null;

  openModal({
    title: t('detail.title'),
    subtitle: row.date ? formatDate(row.date, lang, { short: true }) : undefined,
    body: h('div', { class: 'stack' }, list(main), extra.length ? h('h3', { class: 'small muted' }, t('detail.more')) : null, extra.length ? list(extra) : null, copy),
  });
}
