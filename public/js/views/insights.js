import { h, icon, card, stat } from '../ui.js';
import { formatMoney, formatNumber, formatDate, formatDuration } from '../format.js';
import { donut } from '../charts.js';
import {
  forecastBalance,
  monthToDate,
  rechargePattern,
  estimateDailyCost,
  riskLevel,
} from '../lib/forecast.js';

const simulator = { usageFactor: 100, extra: 1000 };

function confidenceLabel(ctx, forecast) {
  const key = forecast.confidence || 'none';
  return ctx.t(`insights.confidence.${key}`);
}

function forecastCard(ctx, account, forecast) {
  const { t, lang } = ctx;
  const days = forecast.daysLeft;
  const percent = days === null ? 0 : Math.min(1, days / 30);
  const risk = riskLevel(forecast, ctx.meter?.threshold ?? ctx.state.settings.threshold);
  const tone = risk === 'critical' || risk === 'high' ? 'danger' : risk === 'medium' ? 'warn' : 'accent';

  return card({
    title: t('insights.forecastTitle'),
    subtitle: t('insights.forecastSub'),
    badge: h('span', { class: `badge ${forecast.confidence === 'high' ? 'ok' : forecast.confidence === 'low' ? 'warn' : 'accent'}` }, confidenceLabel(ctx, forecast)),
    body: h(
      'div',
      { class: 'forecast-grid' },
      h(
        'div',
        { class: 'forecast-gauge' },
        donut({
          percent,
          size: 168,
          stroke: 13,
          label: days === null ? '--' : String(Math.max(0, Math.round(days))),
          sublabel: t('common.days'),
          tone,
        }),
        h('p', { class: 'small muted', style: { textAlign: 'center', marginTop: '6px' } }, t('insights.gaugeLabel')),
      ),
      h(
        'div',
        { class: 'stack', style: { gap: '10px' } },
        h(
          'div',
          { class: 'kv' },
          h('div', { class: 'kv-item' }, h('dt', {}, t('insights.burnRate')), h('dd', {}, formatMoney(forecast.perDay, lang))),
          h('div', { class: 'kv-item' }, h('dt', {}, t('insights.monthlyRate')), h('dd', {}, formatMoney(forecast.monthly, lang))),
          h('div', { class: 'kv-item' }, h('dt', {}, t('insights.emptyOn')), h('dd', {}, forecast.emptyDate ? formatDate(forecast.emptyDate, lang, { short: true }) : '--')),
          h('div', { class: 'kv-item' }, h('dt', {}, t('insights.confidence')), h('dd', {}, confidenceLabel(ctx, forecast))),
        ),
        h(
          'div',
          { class: 'alert info', style: { padding: '11px 13px' } },
          icon('cpu', { size: 16 }),
          h(
            'div',
            {},
            h('strong', {}, t('insights.calcTitle')),
            h(
              'span',
              { class: 'small' },
              `${formatMoney(forecast.balance, lang)} ÷ ${formatMoney(forecast.perDay, lang)}/${t('common.day')} = ${days === null ? '--' : formatDuration(days, lang)}`,
            ),
          ),
        ),
      ),
    ),
    footer: h(
      'div',
      { class: 'row', style: { justifyContent: 'space-between' } },
      h('span', {}, `${t('insights.model')}: ${forecast.method || '--'}`),
      h('span', { class: 'faint' }, t('insights.methodNote')),
    ),
  });
}

function trendCard(ctx, account) {
  const { t, lang } = ctx;
  const monthly = account.monthly || [];
  const mtd = monthToDate(account);
  if (monthly.length < 3) {
    return card({
      title: t('insights.trendSub'),
      body: h('p', { class: 'muted small' }, t('insights.confidence.none')),
    });
  }
  const complete = monthly.slice(-4, -1);
  const average = complete.reduce((sum, row) => sum + (row.taka || 0), 0) / Math.max(complete.length, 1);
  const projected = mtd.projected || monthly[monthly.length - 1]?.taka || 0;
  const change = average ? ((projected - average) / average) * 100 : 0;
  const direction = Math.abs(change) < 6 ? 'stable' : change > 0 ? 'rising' : 'falling';
  const iconName = direction === 'rising' ? 'trendUp' : direction === 'falling' ? 'trendDown' : 'gauge';
  const tone = direction === 'rising' ? 'danger' : direction === 'falling' ? 'ok' : 'info';

  return h(
    'div',
    { class: 'grid cols-3' },
    stat({
      label: t('insights.trendSub'),
      value: t(`insights.${direction}`),
      iconName,
      tone,
      foot: h(
        'span',
        {},
        direction === 'stable'
          ? t('insights.trendFlat')
          : t(direction === 'rising' ? 'insights.trendUp' : 'insights.trendDown', {
              percent: `${formatNumber(Math.abs(change), lang, { maximumFractionDigits: 1 })}%`,
            }),
      ),
    }),
    stat({
      label: t('insights.rechargePattern'),
      value: formatMoney(rechargePattern(account.recharges).medianAmount, lang),
      iconName: 'receipt',
      tone: 'violet',
      foot: h(
        'span',
        {},
        `${t('insights.avgGap')} ${formatDuration(rechargePattern(account.recharges).medianGapDays, lang)}`,
      ),
    }),
    stat({
      label: t('insights.nextRecharge'),
      value: rechargePattern(account.recharges).nextExpected
        ? formatDate(rechargePattern(account.recharges).nextExpected, lang, { short: true })
        : '--',
      iconName: 'calendar',
      tone: 'info',
      foot: h('span', {}, `${t('insights.totalSpent')}: ${formatMoney(rechargePattern(account.recharges).totalSpent, lang)}`),
    }),
  );
}

function simulatorCard(ctx, account, forecast) {
  const { t, lang } = ctx;
  const basePerDay = forecast.perDay || 1;
  const balance = typeof account.balance === 'number' ? account.balance : 0;

  const output = h('div', { class: 'sim-output' });
  const usageLabel = h('strong', {});
  const extraLabel = h('strong', {});

  const usageRange = h('input', {
    class: 'range',
    type: 'range',
    min: '50',
    max: '200',
    step: '5',
    value: String(simulator.usageFactor),
    'aria-label': t('insights.simUsage'),
  });
  const extraRange = h('input', {
    class: 'range',
    type: 'range',
    min: '0',
    max: '5000',
    step: '100',
    value: String(simulator.extra),
    'aria-label': t('insights.simRecharge'),
  });

  const update = () => {
    simulator.usageFactor = Number(usageRange.value);
    simulator.extra = Number(extraRange.value);
    const perDay = basePerDay * (simulator.usageFactor / 100);
    const days = perDay > 0 ? (balance + simulator.extra) / perDay : null;
    const date = days === null ? null : new Date(Date.now() + days * 86_400_000);
    usageLabel.textContent = `${formatMoney(perDay, lang)}/${t('common.day')}`;
    extraLabel.textContent = formatMoney(simulator.extra, lang);
    usageRange.style.setProperty('--pct', `${((simulator.usageFactor - 50) / 150) * 100}%`);
    extraRange.style.setProperty('--pct', `${(simulator.extra / 5000) * 100}%`);
    output.innerHTML = '';
    output.append(
      h('span', { class: 'sim-days' }, days === null ? '--' : Math.round(days)),
      h('span', { class: 'small muted' }, t('insights.simDaysAfter')),
      date
        ? h('span', { class: 'small faint' }, `${t('insights.emptyOn')}: ${formatDate(date, lang, { short: true })}`)
        : null,
    );
    output.classList.toggle('is-danger', days !== null && days < 3);
  };

  usageRange.addEventListener('input', update);
  extraRange.addEventListener('input', update);

  const body = h(
    'div',
    { class: 'sim-grid' },
    h(
      'div',
      { class: 'stack', style: { gap: '18px' } },
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'field-label' }, t('insights.simUsage')), usageLabel),
        usageRange,
        h('span', { class: 'hint' }, `${formatMoney(basePerDay, lang)} → ${formatMoney(basePerDay * 2, lang)}`),
      ),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'field-label' }, t('insights.simRecharge')), extraLabel),
        extraRange,
        h('span', { class: 'hint' }, '0 → ৳5,000'),
      ),
    ),
    output,
  );

  setTimeout(update, 0);

  return card({
    title: t('insights.simTitle'),
    subtitle: t('insights.simSub'),
    body,
    footer: t('insights.simNote'),
  });
}

function recommendations(ctx, account, forecast) {
  const { t, lang } = ctx;
  const threshold = ctx.meter?.threshold ?? ctx.state.settings.threshold;
  const perDay = forecast.perDay || 0;
  const balance = account.balance || 0;
  const target = Math.max(500, Math.ceil((perDay * 14 - balance + threshold) / 100) * 100);
  const daysCovered = perDay > 0 ? Math.round((balance + target) / perDay) : null;

  const items = [
    {
      icon: 'zap',
      tone: 'danger',
      title: t('insights.rec1Title', { amount: formatMoney(target, lang) }),
      body: t('insights.rec1Body', {
        days: daysCovered ?? '--',
        threshold: formatMoney(threshold, lang),
      }),
      action: {
        label: `${ctx.meter?.provider.toUpperCase()} portal`,
        href: ctx.meter?.provider === 'nesco' ? 'https://customer.nesco.gov.bd' : 'https://prepaid.desco.org.bd/customer',
      },
    },
    { icon: 'gauge', tone: 'info', title: t('insights.rec2Title'), body: t('insights.rec2Body') },
    { icon: 'calendar', tone: 'violet', title: t('insights.rec3Title'), body: t('insights.rec3Body') },
  ];

  return card({
    title: t('insights.recommend'),
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
                  'a',
                  {
                    class: 'btn sm ghost',
                    style: { marginTop: '8px' },
                    href: item.action.href,
                    target: '_blank',
                    rel: 'noreferrer noopener',
                  },
                  item.action.label,
                  icon('external', { size: 13 }),
                )
              : null,
          ),
        ),
      ),
    ),
  });
}

function rechargeTimeline(ctx, account) {
  const { t, lang } = ctx;
  const rows = (account.recharges || []).slice(0, 8);
  if (!rows.length) {
    return card({ title: t('insights.rechargePattern'), body: h('p', { class: 'muted small' }, t('dashboard.noRecharges')) });
  }
  const max = Math.max(...rows.map((row) => row.amount || 0), 1);
  return card({
    title: t('insights.rechargePattern'),
    subtitle: t('usage.patternSub'),
    body: h(
      'div',
      { class: 'timeline' },
      ...rows.map((row) =>
        h(
          'div',
          { class: 'timeline-row' },
          h('span', { class: 'timeline-dot' }),
          h(
            'div',
            { class: 'timeline-main' },
            h('p', { class: 'timeline-title' }, formatDate(row.date, lang, { short: true })),
            h('p', { class: 'small faint' }, row.method || t('dashboard.rechargeNow')),
          ),
          h(
            'div',
            { class: 'timeline-amount' },
            h('span', {}, formatMoney(row.amount, lang)),
            h('span', { class: 'timeline-bar', style: { width: `${((row.amount || 0) / max) * 90}px` } }),
          ),
        ),
      ),
    ),
    footer: `${t('insights.totalSpent')}: ${formatMoney(rechargePattern(account.recharges).totalSpent, lang)}`,
  });
}

export function renderInsights(ctx) {
  const { t, account } = ctx;
  if (!account) {
    return card({
      title: t('insights.title'),
      body: h('p', { class: 'muted' }, t('dashboard.notice.unknown')),
    });
  }
  const threshold = ctx.meter?.threshold ?? ctx.state.settings.threshold;
  const forecast = forecastBalance(account, { threshold });
  const estimate = estimateDailyCost(account);

  return h(
    'div',
    { class: 'stack' },
    trendCard(ctx, account),
    h('div', { class: 'grid cols-2' }, forecastCard(ctx, account, forecast), simulatorCard(ctx, account, forecast)),
    h('div', { class: 'grid cols-2' }, recommendations(ctx, account, forecast), rechargeTimeline(ctx, account)),
    h(
      'p',
      { class: 'small faint', style: { textAlign: 'center', marginTop: '2px' } },
      `${t('insights.methodNote')} ${estimate.method ? `· ${estimate.method}` : ''}`,
    ),
  );
}
