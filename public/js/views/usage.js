import { h, icon, card, stat, toast } from '../ui.js';
import { formatMoney, formatNumber, formatMonth, formatDate, formatDuration } from '../format.js';
import { barChart, areaChart, chartDims } from '../charts.js';
import { openRechargeDetail } from './rechargeDetail.js';
import { downloadCsv } from '../export.js';
import { monthToDate, estimateDailyCost, rechargePattern, dailySeries } from '../lib/forecast.js';

function copyToken(ctx, tokenNo) {
  const done = () => toast(ctx.t('tokens.copied'), tokenNo);
  try {
    navigator.clipboard.writeText(tokenNo).then(done, () => toast(tokenNo, ctx.t('tokens.copyManually')));
  } catch {
    toast(tokenNo, ctx.t('tokens.copyManually'));
  }
}

function tokensCard(ctx, account) {
  const { t, lang } = ctx;
  const rows = (account.tokens?.length
    ? account.tokens
    : (account.recharges || []).filter((row) => row.tokenNo)
  ).slice(0, 10);
  if (!rows.length) return null;
  return card({
    title: t('tokens.title'),
    subtitle: t('tokens.sub'),
    body: h(
      'div',
      { class: 'list' },
      ...rows.map((row) =>
        h(
          'div',
          { class: 'list-row' },
          h('span', { class: 'list-icon' }, icon('zap', { size: 16 })),
          h(
            'div',
            { class: 'list-main' },
            h('p', { class: 'list-title', style: { fontFamily: 'var(--mono, monospace)', wordBreak: 'break-all' } }, row.tokenNo),
            h('p', { class: 'list-sub' }, row.date ? formatDate(row.date, lang, { short: true, withTime: true }) : '--'),
          ),
          h(
            'div',
            { class: 'list-amount' },
            row.amount !== null && row.amount !== undefined ? formatMoney(row.amount, lang) : '',
            row.unit ? h('small', {}, `${formatNumber(row.unit, lang)} kWh`) : null,
          ),
          h(
            'button',
            { class: 'btn sm ghost', type: 'button', 'aria-label': t('tokens.copy'), onclick: () => copyToken(ctx, row.tokenNo) },
            icon('copy', { size: 14 }),
          ),
        ),
      ),
    ),
  });
}

let range = 12;
let metric = 'taka';

function monthlyTable(ctx, rows, limit = 6) {
  const { t, lang } = ctx;
  const recent = rows.slice().reverse().slice(0, limit);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'data-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, t('common.month')),
          h('th', { scope: 'col', class: 'num' }, t('usage.unit')),
          h('th', { scope: 'col', class: 'num' }, t('usage.taka')),
          h('th', { scope: 'col', class: 'num' }, `${t('usage.rate')} (৳/kWh)`),
        ),
      ),
      h(
        'tbody',
        {},
        ...recent.map((row) =>
          h(
            'tr',
            {},
            h('td', {}, formatMonth(row.month, lang, { short: false })),
            h('td', { class: 'num' }, row.unit === null ? '--' : formatNumber(row.unit, lang)),
            h('td', { class: 'num' }, formatMoney(row.taka, lang)),
            h(
              'td',
              { class: 'num faint' },
              row.unit && row.taka ? `${formatNumber(row.taka / row.unit, lang, { maximumFractionDigits: 2 })}/kWh` : '--',
            ),
          ),
        ),
      ),
    ),
  );
}

function yearCompareCard(ctx, account) {
  const { t, lang } = ctx;
  const prevByMonth = new Map((account.monthlyPrev || []).map((row) => [row.month, row]));
  const pairs = (account.monthly || [])
    .slice(-12)
    .map((row) => {
      const [year, month] = row.month.split('-');
      return { month: row.month, now: row, before: prevByMonth.get(`${Number(year) - 1}-${month}`) || null };
    })
    .filter((pair) => pair.before);
  if (!pairs.length) return null;

  // Compare like with like: leave out the current, unfinished month from the totals.
  const done = pairs.filter((pair) => pair.month !== pairs[pairs.length - 1].month || pairs.length === 1);
  const sum = (rows, key) => rows.reduce((total, row) => total + (row?.[key] || 0), 0);
  const nowTaka = sum(done.map((p) => p.now), 'taka');
  const beforeTaka = sum(done.map((p) => p.before), 'taka');
  const change = beforeTaka ? ((nowTaka - beforeTaka) / beforeTaka) * 100 : null;
  const max = Math.max(...pairs.flatMap((p) => [p.now.taka || 0, p.before.taka || 0]), 1);

  const bar = (value, cls) =>
    h('span', { class: `yoy-bar ${cls}`, style: { height: `${Math.max(4, ((value || 0) / max) * 100)}%` }, title: formatMoney(value, lang) });

  return card({
    title: t('yoy.title'),
    subtitle: t('yoy.sub'),
    body: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'row', style: { gap: '18px', flexWrap: 'wrap' } },
        h('div', {}, h('p', { class: 'small muted' }, t('yoy.thisYear')), h('strong', {}, formatMoney(nowTaka, lang))),
        h('div', {}, h('p', { class: 'small muted' }, t('yoy.lastYear')), h('strong', {}, formatMoney(beforeTaka, lang))),
        change === null
          ? null
          : h(
              'div',
              {},
              h('p', { class: 'small muted' }, t('yoy.change')),
              h('strong', { style: { color: change > 0 ? 'var(--danger)' : 'var(--accent)' } }, `${change > 0 ? '+' : ''}${formatNumber(change, lang, { maximumFractionDigits: 1 })}%`),
            ),
      ),
      h(
        'div',
        { class: 'yoy-chart', role: 'img', 'aria-label': t('yoy.title') },
        ...pairs.map((pair) =>
          h(
            'div',
            { class: 'yoy-col' },
            h('div', { class: 'yoy-bars' }, bar(pair.before.taka, 'before'), bar(pair.now.taka, 'now')),
            h('small', {}, formatMonth(pair.month, lang).split(' ')[0]),
          ),
        ),
      ),
      h('p', { class: 'small muted' }, h('span', { class: 'yoy-key before' }), t('yoy.lastYear'), ' ', h('span', { class: 'yoy-key now' }), t('yoy.thisYear')),
    ),
    footer: t('yoy.note'),
  });
}

function historyCard(ctx, account) {
  const { t, lang } = ctx;
  const rows = account.recharges || [];
  const stamp = new Date().toISOString().slice(0, 10);
  const key = `${account.provider}-${account.accountNo}`;
  const downloads = [
    rows.length
      ? [t('export.recharges'), () =>
          downloadCsv(`prepaidpro-${key}-recharges-${stamp}.csv`, rows, [
            { label: 'Date', value: (r) => r.date },
            { label: 'Amount (BDT)', value: (r) => r.amount },
            { label: 'Energy amount (BDT)', value: (r) => r.energyAmount },
            { label: 'VAT (BDT)', value: (r) => r.vat },
            { label: 'Method', value: (r) => r.method },
            { label: 'Token', value: (r) => r.tokenNo },
          ])]
      : null,
    (account.monthly || []).length
      ? [t('export.monthly'), () => {
          const prev = new Map((account.monthlyPrev || []).map((r) => [r.month, r]));
          downloadCsv(`prepaidpro-${key}-monthly-${stamp}.csv`, account.monthly, [
            { label: 'Month', value: (r) => r.month },
            { label: 'Units (kWh)', value: (r) => r.unit },
            { label: 'Cost (BDT)', value: (r) => r.taka },
            { label: 'Same month last year (BDT)', value: (r) => prev.get(`${Number(r.month.slice(0, 4)) - 1}${r.month.slice(4)}`)?.taka },
          ]);
        }]
      : null,
    (account.daily || []).length
      ? [t('export.daily'), () =>
          downloadCsv(`prepaidpro-${key}-daily-${stamp}.csv`, account.daily, [
            { label: 'Date', value: (r) => r.date },
            { label: 'Units (kWh)', value: (r) => r.unit },
            { label: 'Cost (BDT)', value: (r) => r.taka },
          ])]
      : null,
  ].filter(Boolean);

  return card({
    title: t('history.title'),
    subtitle: t('history.sub'),
    body: h(
      'div',
      { class: 'stack' },
      rows.length
        ? h(
            'div',
            { class: 'list' },
            ...rows.slice(0, 30).map((row) =>
              h(
                'button',
                { class: 'list-row clickable', type: 'button', onclick: () => openRechargeDetail(ctx, row) },
                h('span', { class: 'list-icon' }, icon('zap', { size: 16 })),
                h(
                  'div',
                  { class: 'list-main' },
                  h('p', { class: 'list-title' }, row.method || t('dashboard.rechargeNow')),
                  h('p', { class: 'list-sub' }, row.date ? formatDate(row.date, lang, { short: true, withTime: true }) : '--'),
                ),
                h('div', { class: 'list-amount' }, formatMoney(row.amount, lang), row.energyAmount ? h('small', {}, formatMoney(row.energyAmount, lang)) : null),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, t('dashboard.noRecharges')),
      downloads.length
        ? h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, ...downloads.map(([label, run]) => h('button', { class: 'btn sm', type: 'button', onclick: run }, icon('download', { size: 14 }), label)))
        : null,
    ),
    footer: t('history.note'),
  });
}

export function renderUsage(ctx) {
  const { t, lang, account } = ctx;
  if (!account) return card({ title: t('usage.title'), body: h('p', { class: 'muted' }, t('usage.noDataBody')) });

  const allMonths = account.monthly || [];
  const months = allMonths.slice(-range);
  const mtd = monthToDate(account);
  const estimate = estimateDailyCost(account);
  const pattern = rechargePattern(account.recharges);
  const latest = allMonths[allMonths.length - 1];
  const effectiveRate = latest?.unit && latest?.taka ? latest.taka / latest.unit : null;

  const metricButton = (id, label) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': metric === id ? 'true' : 'false',
        onclick: () => {
          metric = id;
          ctx.renderView();
        },
      },
      label,
    );

  const rangeButton = (value) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': range === value ? 'true' : 'false',
        onclick: () => {
          range = value;
          ctx.renderView();
        },
      },
      t(value === 6 ? 'usage.range6' : 'usage.range12'),
    );

  const chartRows = months.map((row) => ({
    label: formatMonth(row.month, lang),
    value: metric === 'taka' ? row.taka || 0 : row.unit || 0,
    subtitle: `${formatMonth(row.month, lang, { short: false })} · ${
      metric === 'taka' ? `${formatNumber(row.unit, lang)} kWh` : formatMoney(row.taka, lang)
    }`,
  }));

  const realDaily = Array.isArray(account.daily) && account.daily.filter((row) => typeof row.taka === 'number').length >= 5;
  const dailyRows = realDaily ? account.daily.filter((row) => typeof row.taka === 'number') : dailySeries(account, { days: 60 });
  const daily = dailyRows.map((point) => ({
    label: formatDate(point.date, lang, { short: true }),
    fullLabel: formatDate(point.date, lang, { short: false }),
    value: point.taka,
  }));

  const best = allMonths.reduce((max, row) => (!max || row.taka > max.taka ? row : max), null);
  const cheapest = allMonths.reduce((min, row) => (!min || row.taka < min.taka ? row : min), null);

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'grid cols-3' },
      stat({
        label: t('usage.mtd'),
        value: formatMoney(mtd.spent, lang),
        iconName: 'calendar',
        tone: 'info',
        foot: h(
          'span',
          {},
          mtd.changePct === null
            ? t('usage.vsLast')
            : h(
                'span',
                { class: `delta ${mtd.changePct >= 0 ? 'up' : 'down'}` },
                mtd.changePct >= 0 ? '+' : '',
                `${formatNumber(mtd.changePct, lang, { maximumFractionDigits: 1 })}%`,
                ` ${t('usage.vsLast').toLowerCase()}`,
              ),
        ),
      }),
      stat({
        label: t('usage.projected'),
        value: formatMoney(mtd.projected, lang),
        iconName: 'trendUp',
        tone: 'violet',
        foot: h('span', {}, `${t('usage.yourUnits')}: ${formatNumber(mtd.unit, lang)}`),
      }),
      stat({
        label: t('usage.yourUnits') + ' · ' + t('usage.slabRate'),
        value: effectiveRate ? formatMoney(effectiveRate, lang, { decimals: 2 }) : '--',
        unit: '/kWh',
        iconName: 'gauge',
        tone: 'warn',
        foot: h('span', {}, `${t('insights.burnRate')}: ${formatMoney(estimate.perDay, lang)}`),
      }),
    ),

    card({
      title: t('usage.monthly'),
      subtitle: t('usage.monthlySub'),
      actions: h(
        'div',
        { class: 'row', style: { gap: '8px' } },
        h(
          'div',
          { class: 'segmented', role: 'group', 'aria-label': t('usage.taka') },
          metricButton('taka', t('usage.taka')),
          metricButton('unit', t('usage.unit')),
        ),
        h(
          'div',
          { class: 'segmented', role: 'group', 'aria-label': t('usage.monthly') },
          rangeButton(6),
          rangeButton(12),
        ),
      ),
      body: months.length
        ? barChart({
            data: chartRows,
            ...chartDims(760, 300),
            formatValue: (value) =>
              metric === 'taka' ? formatMoney(value, lang) : `${formatNumber(value, lang)} kWh`,
          })
        : h('div', { class: 'chart-empty' }, icon('chart', { size: 26 }), t('usage.noData')),
      footer: h(
        'div',
        { class: 'row', style: { justifyContent: 'space-between' } },
        h('span', {}, t('usage.estimateNote')),
        best
          ? h(
              'span',
              {},
              `${t('usage.busiest')}: ${formatMonth(best.month, lang)} · ${formatMoney(best.taka, lang)}`,
            )
          : null,
      ),
    }),

    h(
      'div',
      { class: 'grid cols-2' },
      card({
        title: realDaily ? t('usage.dailyRealTitle') : t('usage.daily'),
        subtitle: realDaily ? t('usage.dailyRealSub') : t('usage.dailySub'),
        body: daily.length
          ? areaChart({
              data: daily,
              ...chartDims(760, 240),
              unit: t('usage.taka'),
              formatValue: (value) => formatMoney(value, lang),
            })
          : h('div', { class: 'chart-empty' }, t('usage.noData')),
        footer: realDaily ? t('usage.dailyReal') : t('usage.estimateNote'),
      }),
      card({
        title: t('usage.pattern'),
        subtitle: t('usage.patternSub'),
        body: h(
          'div',
          { class: 'stack', style: { gap: '14px' } },
          h(
            'div',
            { class: 'kv' },
            h(
              'div',
              { class: 'kv-item' },
              h('dt', {}, t('insights.avgGap')),
              h('dd', {}, pattern.medianGapDays ? formatDuration(pattern.medianGapDays, lang) : '--'),
            ),
            h(
              'div',
              { class: 'kv-item' },
              h('dt', {}, t('insights.typicalAmount')),
              h('dd', {}, pattern.medianAmount ? formatMoney(pattern.medianAmount, lang) : '--'),
            ),
            h(
              'div',
              { class: 'kv-item' },
              h('dt', {}, t('insights.totalSpent')),
              h('dd', {}, formatMoney(pattern.totalSpent, lang)),
            ),
            h(
              'div',
              { class: 'kv-item' },
              h('dt', {}, t('insights.nextRecharge')),
              h('dd', {}, pattern.nextExpected ? formatDate(pattern.nextExpected, lang, { short: true }) : '--'),
            ),
          ),
          pattern.count > 1
            ? h(
                'div',
                { class: 'mini-bars' },
                ...(account.recharges || [])
                  .slice(0, 8)
                  .reverse()
                  .map((row) => {
                    const max = Math.max(...(account.recharges || []).slice(0, 8).map((r) => r.amount || 0), 1);
                    return h(
                      'span',
                      {
                        class: 'mini-bar',
                        style: { height: `${Math.max(10, ((row.amount || 0) / max) * 100)}%` },
                        title: `${formatDate(row.date, lang, { short: true })} · ${formatMoney(row.amount, lang)}`,
                      },
                    );
                  }),
              )
            : null,
        ),
        footer: cheapest
          ? `${t('usage.cheapest')}: ${formatMonth(cheapest.month, lang)} · ${formatMoney(cheapest.taka, lang)}`
          : null,
      }),
    ),

    yearCompareCard(ctx, account),

    historyCard(ctx, account),

    tokensCard(ctx, account),

    card({
      title: t('usage.monthly') + ' · ' + t('common.summary'),
      subtitle: `${formatNumber(allMonths.length, lang)} ${t('common.month')}`,
      body: allMonths.length
        ? h(
            'div',
            {},
            monthlyTable(ctx, allMonths, 6),
            allMonths.length > 6
              ? h(
                  'div',
                  { style: { marginTop: '12px' } },
                  h('details', {}, h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, `${t('common.viewAll')} (${allMonths.length})`), monthlyTable(ctx, allMonths, 99)),
                )
              : null,
          )
        : h('p', { class: 'muted' }, t('usage.noDataBody')),
      footer: t('usage.estimateNote'),
    }),
  );
}
