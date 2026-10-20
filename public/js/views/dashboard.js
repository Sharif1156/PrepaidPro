import { h, icon, card, stat, skeletonCard } from '../ui.js';
import {
  formatMoney,
  formatNumber,
  formatDate,
  formatDayMonth,
  formatMonth,
  formatDuration,
  formatTimeAgo,
} from '../format.js';
import { barChart, chartDims } from '../charts.js';
import { forecastBalance, monthToDate, rechargePattern, riskLevel } from '../lib/forecast.js';

const PORTALS = {
  desco: 'https://prepaid.desco.org.bd/customer',
  nesco: 'https://customer.nesco.gov.bd',
};

function statusBanners(ctx, account) {
  const { t, error, fromSnapshot } = ctx;
  const banners = [];

  if (account?.demo) {
    banners.push(
      h(
        'div',
        { class: 'demo-banner' },
        icon('sparkles', { size: 15 }),
        h('span', { class: 'badge demo' }, t('status.demo')),
        h('span', {}, t('dashboard.demoNote')),
      ),
    );
  }

  if (error && account) {
    banners.push(
      h(
        'div',
        { class: 'alert warn', style: { marginBottom: '16px' } },
        icon('alert', { size: 18 }),
        h(
          'div',
          {},
          h('strong', {}, fromSnapshot ? t('status.lastKnown') : t('status.cached')),
          t(`errors.${errorCodeKey(error)}.body`),
        ),
      ),
    );
  }

  if (!navigator.onLine) {
    banners.push(
      h(
        'div',
        { class: 'alert warn', style: { marginBottom: '16px' } },
        icon('alert', { size: 18 }),
        h('div', {}, h('strong', {}, t('errors.offline.title')), t('errors.offline.body')),
      ),
    );
  }
  return banners;
}

function errorCodeKey(error) {
  if (!error) return 'generic';
  if (error.code === 'OFFLINE' || error.code === 'NETWORK') return 'network';
  if (error.code === 'ACCOUNT_NOT_FOUND') return 'notfound';
  if (error.code === 'RATE_LIMITED') return 'rate';
  return 'network';
}

function fullErrorCard(ctx) {
  const { t, error } = ctx;
  const key = errorCodeKey(error);
  return h(
    'section',
    { class: 'card', style: { maxWidth: '640px', margin: '36px auto' } },
    h(
      'div',
      { class: 'card-body', style: { padding: '30px' } },
      h(
        'div',
        { class: 'empty' },
        h('span', { class: 'empty-art' }, icon('alert', { size: 32 })),
        h('h3', {}, t(`errors.${key}.title`)),
        h('p', {}, t(`errors.${key}.body`)),
        h(
          'div',
          { class: 'row', style: { justifyContent: 'center', marginTop: '6px' } },
          h(
            'button',
            { class: 'btn primary', type: 'button', onclick: () => ctx.refresh(true) },
            icon('refresh', { size: 16 }),
            t('errors.retry'),
          ),
          h(
            'button',
            { class: 'btn ghost', type: 'button', onclick: () => ctx.openAddMeter() },
            icon('plus', { size: 16 }),
            t('meters.add'),
          ),
        ),
        error?.message
          ? h(
              'details',
              { class: 'small muted', style: { marginTop: '10px' } },
              h('summary', { style: { cursor: 'pointer' } }, t('errors.details')),
              h('code', { class: 'mono', style: { display: 'block', marginTop: '6px', fontSize: '11.5px' } }, `${error.code}: ${error.message}`),
            )
          : null,
      ),
    ),
  );
}

function hero(ctx, account, meter, forecast) {
  const { t, lang } = ctx;
  const threshold = meter.threshold ?? ctx.state.settings.threshold;
  const risk = riskLevel(forecast, threshold);
  const days = forecast.daysLeft;
  const runwayPct = days === null ? 0 : Math.min(100, Math.max(2, (days / 30) * 100));
  const fillClass = risk === 'critical' || risk === 'high' ? 'danger' : risk === 'medium' ? 'warn' : '';

  const gaugeTone = risk === 'critical' || risk === 'high' ? 'danger' : risk === 'medium' ? 'warn' : 'accent';
  const gaugePercent = days === null ? 0 : Math.min(1, days / 30);

  return h(
    'section',
    { class: 'hero' },
    h(
      'div',
      { class: 'hero-top' },
      h(
        'div',
        {},
        h(
          'span',
          { class: 'hero-provider' },
          h('span', { class: 'dot' }),
          meter.demo ? `${meter.provider.toUpperCase()} · ${t('common.demo')}` : meter.provider.toUpperCase(),
        ),
        h(
          'div',
          { class: 'hero-meter', style: { marginTop: '6px' } },
          meter.label ? h('strong', { style: { color: 'var(--text)' } }, meter.label) : null,
          h('code', {}, account.accountNo || meter.accountNo),
          account.meterNo ? h('span', { class: 'faint' }, `· ${t('dashboard.meterNo')} ${account.meterNo}`) : null,
        ),
      ),
      h(
        'div',
        { class: 'row', style: { gap: '6px' } },
        account.demo ? h('span', { class: 'badge demo' }, t('dashboard.demoBadge')) : null,
        h('span', { class: `risk-chip ${risk}` }, icon(risk === 'low' ? 'shield' : 'alert', { size: 13 }), t(`dashboard.risk.${risk}`)),
      ),
    ),

    h(
      'div',
      { class: 'hero-grid' },
      h(
        'div',
        { class: 'hero-main' },
        h('p', { class: 'hero-label' }, t('dashboard.balance')),
        h(
          'div',
          { class: 'hero-amount' },
          h('span', { class: 'currency' }, '৳'),
          h('span', { class: 'value' }, account.balance === null || account.balance === undefined
            ? '--'
            : formatNumber(account.balance, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
        ),
        h(
          'div',
          { class: 'hero-meta' },
          h('span', { class: 'item' }, icon('clock', { size: 14 }), `${t('dashboard.readingAt')}: ${account.readingTime ? formatTimeAgo(account.readingTime, lang) : t('common.unknown')}`),
          h('span', { class: 'item' }, icon('wallet', { size: 14 }), t('dashboard.thresholdNote', { amount: formatMoney(threshold, lang) })),
        ),

        h(
          'div',
          { class: 'runway' },
          h(
            'div',
            { class: 'runway-head' },
            h('span', {}, t('dashboard.runway')),
            h(
              'strong',
              {},
              days === null ? '--' : formatDuration(days, lang),
              forecast.emptyDate ? h('span', { class: 'faint', style: { fontWeight: '400', fontSize: '12px' } }, ` · ${t('dashboard.runsOut')} ${formatDayMonth(forecast.emptyDate, lang)}`) : null,
            ),
          ),
          h(
            'div',
            { class: 'runway-track', role: 'progressbar', 'aria-valuenow': Math.round(runwayPct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
            h('div', { class: `runway-fill ${fillClass}`, style: { width: `${runwayPct}%` } }),
          ),
          h(
            'div',
            { class: 'runway-scale' },
            h('span', {}, '0'),
            h('span', {}, `15 ${t('common.days')}`),
            h('span', {}, `30 ${t('common.days')}`),
          ),
        ),
      ),
      h(
        'div',
        { class: 'hero-gauge' },
        h(
          'div',
          { class: 'gauge-ring' },
          h('span', { class: 'gauge-value' }, days === null ? '--' : Math.max(0, Math.round(days))),
          h('span', { class: 'gauge-label' }, t('dashboard.daysLeft')),
          h('span', {
            class: 'gauge-fill',
            style: {
              background: `conic-gradient(${
                gaugeTone === 'danger' ? '#fb7185' : gaugeTone === 'warn' ? '#fbbf24' : '#2dd4bf'
              } ${Math.round(gaugePercent * 360)}deg, rgba(255,255,255,.08) 0deg)`,
            },
          }),
        ),
      ),
    ),

    h(
      'div',
      { class: 'hero-foot' },
      h(
        'p',
        { class: 'hero-notice' },
        icon(risk === 'low' ? 'check' : 'alert', { size: 15 }),
        h('span', {}, t(`dashboard.notice.${risk}`)),
      ),
      h(
        'div',
        { class: 'hero-actions' },
        h(
          'a',
          {
            class: 'btn sm primary',
            href: PORTALS[meter.provider],
            target: '_blank',
            rel: 'noreferrer noopener',
          },
          icon('zap', { size: 14 }),
          t('dashboard.rechargeNow'),
          icon('arrowUpRight', { size: 13 }),
        ),
        h(
          'button',
          { class: 'btn sm', type: 'button', onclick: () => ctx.go('insights') },
          icon('sparkles', { size: 14 }),
          t('nav.insights'),
        ),
      ),
    ),
  );
}

function stats(ctx, account, forecast) {
  const { t, lang } = ctx;
  const mtd = monthToDate(account);
  const pattern = rechargePattern(account.recharges);
  const change = mtd.changePct;

  return h(
    'div',
    { class: 'grid cols-4' },
    stat({
      label: t('dashboard.mtd'),
      value: formatMoney(mtd.spent, lang),
      iconName: 'calendar',
      tone: 'info',
      foot: change === null
        ? h('span', {}, t('dashboard.compareLastMonth'))
        : h(
            'span',
            {},
            h('span', { class: `delta ${change >= 0 ? 'up' : 'down'}` }, change >= 0 ? '+' : '', `${formatNumber(change, lang, { maximumFractionDigits: 1 })}%`),
            t('dashboard.compareLastMonth'),
          ),
    }),
    stat({
      label: t('dashboard.projected'),
      value: formatMoney(mtd.projected, lang),
      iconName: 'trendUp',
      tone: 'violet',
      foot: h('span', {}, `${mtd.dayOfMonth}/${mtd.daysInMonth} ${t('common.days')}`),
    }),
    stat({
      label: t('dashboard.avgDaily'),
      value: formatMoney(forecast.perDay, lang),
      iconName: 'gauge',
      tone: 'warn',
      foot: h('span', {}, t('dashboard.estimated')),
    }),
    stat({
      label: t('dashboard.lastRecharge'),
      value: (account.recharges?.[0]?.amount ?? null) === null ? '--' : formatMoney(account.recharges[0].amount, lang),
      iconName: 'receipt',
      foot: h(
        'span',
        {},
        pattern.lastDate ? formatDate(pattern.lastDate, lang, { short: true }) : t('common.never'),
      ),
    }),
  );
}

function usageCard(ctx, account) {
  const { t, lang } = ctx;
  const rows = (account.monthly || []).slice(-6).map((row) => ({
    label: formatMonth(row.month, lang),
    value: row.taka || 0,
    subtitle: `${formatMonth(row.month, lang, { short: false })} · ${formatNumber(row.unit, lang)} kWh`,
  }));

  return card({
    title: t('dashboard.usage'),
    subtitle: t('dashboard.usageSub'),
    actions: h(
      'button',
      { class: 'btn sm ghost', type: 'button', onclick: () => ctx.go('usage') },
      t('common.viewAll'),
      icon('arrowRight', { size: 14 }),
    ),
    body: h(
      'div',
      { class: 'chart-wrap usage-chart' },
      barChart({
        data: rows,
        ...chartDims(760, 250),
        formatValue: (value) => formatMoney(value, lang),
      }),
    ),
    footer: `${t('dashboard.estimated')} · ${formatMoney((account.monthly || []).reduce((sum, row) => sum + (row.taka || 0), 0), lang)} ${t('common.total')}`,
  });
}

function nextSteps(ctx, account, forecast, meter) {
  const { t, lang } = ctx;
  const threshold = meter.threshold ?? ctx.state.settings.threshold;
  const risk = riskLevel(forecast, threshold);
  const pattern = rechargePattern(account.recharges);
  const targetAmount = Math.max(
    500,
    Math.round(((forecast.perDay || 0) * 14 - (account.balance || 0)) / 100) * 100,
  );

  const items = [];

  if (risk === 'critical' || risk === 'high' || risk === 'medium') {
    items.push({
      icon: 'zap',
      tone: 'danger',
      title: t('insights.rec1Title', { amount: formatMoney(targetAmount, lang) }),
      body: t('insights.rec1Body', {
        days: Math.round(14),
        threshold: formatMoney(threshold, lang),
      }),
    });
  } else {
    items.push({
      icon: 'shield',
      tone: 'ok',
      title: t(`dashboard.notice.${risk}`),
      body: `${t('dashboard.avgDaily')} ${formatMoney(forecast.perDay, lang)} · ${t('dashboard.daysLeft')} ${formatDuration(forecast.daysLeft, lang)}`,
    });
  }

  items.push({
    icon: 'bell',
    tone: 'info',
    title: t('settings.notifications'),
    body: t('settings.notificationsDesc'),
    action: {
      label: t('common.settings'),
      onClick: () => ctx.go('settings'),
    },
  });

  if (pattern.medianGapDays) {
    items.push({
      icon: 'receipt',
      tone: 'violet',
      title: t('insights.rechargePattern'),
      body: `${t('insights.avgGap')}: ${formatDuration(pattern.medianGapDays, lang)} · ${t('insights.typicalAmount')}: ${formatMoney(pattern.medianAmount, lang)}`,
    });
  }

  return card({
    title: t('dashboard.tipTitle'),
    subtitle: t('dashboard.tipSub'),
    body: h(
      'div',
      { class: 'reco-list' },
      ...items.map((item) =>
        h(
          'div',
          { class: 'reco-item' },
          h('span', { class: `reco-icon ${item.tone}` }, icon(item.icon, { size: 17 })),
          h(
            'div',
            { style: { minWidth: 0 } },
            h('p', { class: 'reco-title' }, item.title),
            h('p', { class: 'reco-body' }, item.body),
            item.action
              ? h(
                  'button',
                  { class: 'btn sm ghost', type: 'button', style: { marginTop: '8px' }, onclick: item.action.onClick },
                  item.action.label,
                  icon('arrowRight', { size: 13 }),
                )
              : null,
          ),
        ),
      ),
    ),
  });
}

function rechargeCard(ctx, account) {
  const { t, lang } = ctx;
  const rows = (account.recharges || []).slice(0, 5);

  const body = rows.length
    ? h(
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
              h('p', { class: 'list-title' }, row.method || t('dashboard.rechargeNow')),
              h('p', { class: 'list-sub' }, row.date ? formatDate(row.date, lang, { short: true, withTime: true }) : '--'),
            ),
            h(
              'div',
              { class: 'list-amount' },
              formatMoney(row.amount, lang),
              row.energyAmount ? h('small', {}, `${formatNumber(row.energyAmount, lang)} kWh`) : null,
            ),
          ),
        ),
      )
    : h('p', { class: 'muted small' }, t('dashboard.noRecharges'));

  return card({
    title: t('dashboard.recent'),
    subtitle: t('dashboard.recentSub'),
    body,
    footer: h(
      'div',
      { class: 'row', style: { justifyContent: 'space-between' } },
      h('span', {}, `${t('insights.totalSpent')}: ${formatMoney(rechargePattern(account.recharges).totalSpent, lang)}`),
      h(
        'button',
        { class: 'btn sm ghost', type: 'button', onclick: () => ctx.go('usage') },
        t('common.viewAll'),
        icon('arrowRight', { size: 13 }),
      ),
    ),
  });
}

function detailsCard(ctx, account) {
  const { t, lang } = ctx;
  const c = account.customer || {};
  const entries = [
    [t('dashboard.accountNo'), account.accountNo],
    [t('dashboard.meterNo'), account.meterNo || '--'],
    [t('meters.tariff'), c.tariff || '--'],
    [t('meters.lastReading'), account.readingTime ? formatDate(account.readingTime, lang, { withTime: true }) : '--'],
    [t('meters.division'), c.division || '--'],
    [t('dashboard.readingAt'), account.source ? account.source.toUpperCase() : '--'],
  ];
  return card({
    title: t('common.summary'),
    subtitle: c.name || meterName(ctx),
    body: h(
      'dl',
      { class: 'kv' },
      ...entries.map(([label, value]) =>
        h('div', { class: 'kv-item' }, h('dt', {}, label), h('dd', {}, value)),
      ),
    ),
    footer: account.demo ? t('dashboard.demoNote') : `${t('common.updated')} ${formatTimeAgo(account.fetchedAt, lang)}`,
  });
}

function meterName(ctx) {
  const meter = ctx.meter;
  return meter?.label || (meter ? `${meter.provider.toUpperCase()} ${meter.accountNo}` : '');
}

function dashboardSkeleton() {
  return h(
    'div',
    { class: 'dash' },
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'skeleton', style: { height: '260px', borderRadius: '28px' } }),
      h(
        'div',
        { class: 'grid cols-4' },
        ...[0, 1, 2, 3].map(() => h('div', { class: 'skeleton', style: { height: '104px' } })),
      ),
      skeletonCard(5),
    ),
    h('div', { class: 'stack' }, skeletonCard(4), skeletonCard(4)),
  );
}

export function renderDashboard(ctx) {
  const { account, meter, error } = ctx;
  if (!meter) return h('div');
  if (!account) return error ? fullErrorCard(ctx) : dashboardSkeleton();

  const threshold = meter.threshold ?? ctx.state.settings.threshold;
  const forecast = forecastBalance(account, { threshold });

  return h(
    'div',
    {},
    ...statusBanners(ctx, account),
    h(
      'div',
      { class: 'dash' },
      h(
        'div',
        { class: 'stack' },
        hero(ctx, account, meter, forecast),
        stats(ctx, account, forecast),
        usageCard(ctx, account),
      ),
      h(
        'div',
        { class: 'stack' },
        nextSteps(ctx, account, forecast, meter),
        rechargeCard(ctx, account),
        detailsCard(ctx, account),
      ),
    ),
  );
}
