import { h, icon, card, stat } from '../ui.js';
import { formatMoney, formatNumber, formatMonth, formatDate, formatDuration } from '../format.js';
import { barChart, areaChart, chartDims } from '../charts.js';
import { monthToDate, estimateDailyCost, rechargePattern, dailySeries } from '../lib/forecast.js';

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

  const daily = dailySeries(account, { days: 60 }).map((point) => ({
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
        title: t('usage.daily'),
        subtitle: t('usage.dailySub'),
        body: daily.length
          ? areaChart({
              data: daily,
              ...chartDims(760, 240),
              unit: t('usage.taka'),
              formatValue: (value) => formatMoney(value, lang),
            })
          : h('div', { class: 'chart-empty' }, t('usage.noData')),
        footer: t('usage.estimateNote'),
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
