import { h, icon, openModal, closeModal, toast, stat } from '../ui.js';
import { addMeter, updateMeter } from '../state.js';
import { formatMoney, formatDuration, formatTimeAgo, formatNumber } from '../format.js';
import { forecastBalance } from '../lib/forecast.js';
import { sparkline } from '../charts.js';

const DEMO_ACCOUNTS = { desco: '104237569', nesco: '2456109837' };

let summariesRequested = '';

export function openAddMeterModal(ctx, { demo = false } = {}) {
  const { t } = ctx;
  let provider = 'desco';

  const accountInput = h('input', {
    class: 'input mono',
    id: 'accountInput',
    inputmode: 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '16',
    placeholder: '104237569',
    'aria-describedby': 'accountHint',
  });
  const labelInput = h('input', {
    class: 'input',
    id: 'labelInput',
    maxlength: '48',
    placeholder: t('meters.labelHint'),
  });
  const thresholdInput = h('input', {
    class: 'input',
    id: 'thresholdInput',
    type: 'number',
    min: '0',
    step: '50',
    value: String(ctx.state.settings.threshold),
  });
  const errorLine = h('p', { class: 'small', style: { color: 'var(--danger)', minHeight: '18px' } });

  const providerButton = (id) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': provider === id ? 'true' : 'false',
        onclick: () => {
          provider = id;
          [...providerGroup.querySelectorAll('button')].forEach((button) => {
            button.setAttribute('aria-pressed', button.dataset.provider === id ? 'true' : 'false');
          });
          accountInput.placeholder = DEMO_ACCOUNTS[id];
        },
        dataset: { provider: id },
      },
      id === 'desco' ? t('provider.desco') : t('provider.nesco'),
    );

  const providerGroup = h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': t('meters.provider') },
    providerButton('desco'),
    providerButton('nesco'),
  );

  accountInput.addEventListener('input', () => {
    accountInput.value = accountInput.value.replace(/\D/g, '').slice(0, 16);
  });

  const submit = () => {
    const accountNo = accountInput.value.replace(/\D/g, '');
    if (accountNo.length < 5) {
      errorLine.textContent = t('meters.invalid');
      accountInput.focus();
      return;
    }
    const exists = ctx.state.meters.find(
      (meter) => meter.provider === provider && meter.accountNo === accountNo && !meter.demo,
    );
    if (exists) {
      ctx.setActiveMeter(exists.id);
      closeModal();
      ctx.go('dashboard');
      ctx.loadActive();
      toast(t('meters.exists'), '', { type: 'warn' });
      return;
    }
    const meter = addMeter({
      provider,
      accountNo,
      label: labelInput.value.trim(),
      threshold: Number(thresholdInput.value) || ctx.state.settings.threshold,
    });
    closeModal();
    ctx.go('dashboard');
    ctx.loadActive().then(() => {
      toast(t('meters.addSuccess', { name: meter.label || `${provider.toUpperCase()} ${accountNo}` }), '');
    });
  };

  const body = h(
    'div',
    { class: 'stack', style: { gap: '15px' } },
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, t('meters.provider')),
      providerGroup,
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'accountInput' }, t('meters.account')),
      accountInput,
      h('span', { class: 'hint', id: 'accountHint' }, t('meters.accountHint')),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'labelInput' }, `${t('meters.label')} (${t('common.optional')})`),
      labelInput,
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'thresholdInput' }, t('meters.thresholdLabel')),
      thresholdInput,
      h('span', { class: 'hint' }, t('settings.thresholdDesc')),
    ),
    errorLine,
    h(
      'div',
      { class: 'alert info' },
      icon('shield', { size: 18 }),
      h('div', {}, h('strong', {}, t('privacy.title') || 'Privacy first'), t('meters.addSub')),
    ),
  );

  const footer = [
    h(
      'button',
      {
        class: 'btn ghost',
        type: 'button',
        style: { marginRight: 'auto' },
        onclick: () => {
          accountInput.value = DEMO_ACCOUNTS[provider];
          labelInput.value = t('common.demo');
        },
      },
      icon('sparkles', { size: 15 }),
      t('meters.tryDemo'),
    ),
    h('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, t('common.cancel')),
    h('button', { class: 'btn primary', type: 'button', onclick: submit }, icon('plus', { size: 16 }), t('common.add')),
  ];

  openModal({
    title: t('meters.addTitle'),
    subtitle: t('meters.addSub'),
    body,
    footer,
  });

  accountInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  if (demo) accountInput.value = DEMO_ACCOUNTS.desco;
  setTimeout(() => accountInput.focus(), 60);
}

function meterCard(ctx, meter) {
  const { t, lang } = ctx;
  const summary = ctx.summaries[meter.id];
  const account = summary?.account || (ctx.meter?.id === meter.id ? ctx.account : null);
  const threshold = meter.threshold ?? ctx.state.settings.threshold;
  const forecast = account ? forecastBalance(account, { threshold }) : null;
  const isActive = ctx.state.activeMeterId === meter.id;

  const balance = account?.balance;
  const series = (account?.monthly || []).map((row) => row.taka || 0).slice(-8);

  return h(
    'article',
    { class: `meter-card ${isActive ? 'active' : ''}` },
    h(
      'div',
      { class: 'meter-top' },
      h(
        'div',
        { style: { minWidth: 0 } },
        h(
          'p',
          { class: 'meter-name' },
          meter.label || `${meter.provider.toUpperCase()} ${t('nav.meters')}`,
          meter.demo ? h('span', { class: 'badge demo', style: { marginLeft: '8px' } }, t('common.demo')) : null,
        ),
        h('p', { class: 'meter-no' }, `${meter.provider.toUpperCase()} · ${meter.accountNo}`),
      ),
      isActive ? h('span', { class: 'badge accent' }, t('meters.active')) : null,
    ),

    h(
      'div',
      { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-end' } },
      h(
        'div',
        {},
        h(
          'p',
          { class: 'meter-balance' },
          balance === null || balance === undefined ? '--' : formatMoney(balance, lang),
          h('small', {}, t('meters.balance')),
        ),
        h(
          'p',
          { class: 'small muted' },
          forecast?.daysLeft
            ? `${formatDuration(forecast.daysLeft, lang)} ${t('meters.days').toLowerCase()}`
            : t('common.unknown'),
        ),
      ),
      series.length > 1 ? sparkline(series, { width: 92, height: 34 }) : null,
    ),

    h(
      'p',
      { class: 'small faint' },
      `${t('meters.lastReading')}: ${account?.readingTime ? formatTimeAgo(account.readingTime, lang) : t('common.unknown')}`,
    ),

    h(
      'div',
      { class: 'meter-bottom' },
      h(
        'div',
        { class: 'meter-actions' },
        isActive
          ? h(
              'button',
              { class: 'btn sm ghost', type: 'button', onclick: () => ctx.go('dashboard') },
              icon('grid', { size: 14 }),
              t('nav.dashboard'),
            )
          : h(
              'button',
              {
                class: 'btn sm',
                type: 'button',
                onclick: () => {
                  ctx.setActiveMeter(meter.id);
                  ctx.go('dashboard');
                  ctx.loadActive();
                },
              },
              t('meters.setActive'),
            ),
        h(
          'button',
          {
            class: 'btn sm ghost',
            type: 'button',
            'aria-label': t('meters.remove'),
            onclick: () => ctx.confirmRemoveMeter(meter),
          },
          icon('trash', { size: 14 }),
        ),
      ),
      h(
        'button',
        {
          class: 'btn sm ghost',
          type: 'button',
          onclick: () =>
            openThresholdModal(ctx, meter),
        },
        icon('sliders', { size: 14 }),
        formatMoney(threshold, lang),
      ),
    ),
  );
}

function openThresholdModal(ctx, meter) {
  const { t } = ctx;
  const input = h('input', {
    class: 'input',
    type: 'number',
    min: '0',
    step: '50',
    value: String(meter.threshold ?? ctx.state.settings.threshold),
  });
  openModal({
    title: t('meters.thresholdLabel'),
    subtitle: meter.label || `${meter.provider.toUpperCase()} ${meter.accountNo}`,
    body: h(
      'div',
      { class: 'field' },
      h('label', { for: 'threshold' }, t('settings.threshold')),
      input,
      h('span', { class: 'hint' }, t('settings.thresholdDesc')),
    ),
    footer: [
      h('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, t('common.cancel')),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: () => {
            const value = Number(input.value);
            updateMeter(meter.id, { threshold: Number.isFinite(value) ? value : null });
            closeModal();
            ctx.renderView();
            ctx.renderChrome();
            toast(t('common.save'), t('settings.notifThreshold', { amount: formatMoney(value, ctx.lang) }));
          },
        },
        t('common.save'),
      ),
    ],
  });
}

function emptyState(ctx) {
  const { t } = ctx;
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'empty' },
      h('span', { class: 'empty-art' }, icon('meter', { size: 32 })),
      h('h3', {}, t('meters.empty.title')),
      h('p', {}, t('meters.empty.body')),
      h(
        'button',
        { class: 'btn primary', type: 'button', style: { marginTop: '8px' }, onclick: () => openAddMeterModal(ctx) },
        icon('plus', { size: 16 }),
        t('meters.empty.cta'),
      ),
    ),
  );
}

export function renderMeters(ctx) {
  const { t, lang, state } = ctx;
  const meters = state.meters;
  if (!meters.length) return emptyState(ctx);

  const signature = meters.map((meter) => meter.id).join(',');
  if (summariesRequested !== signature) {
    summariesRequested = signature;
    setTimeout(() => ctx.loadAllSummaries(), 30);
  }

  const totalBalance = meters.reduce((sum, meter) => {
    const summary = ctx.summaries[meter.id]?.account;
    return sum + (typeof summary?.balance === 'number' ? summary.balance : 0);
  }, 0);

  const totalDays = meters.reduce((best, meter) => {
    const summary = ctx.summaries[meter.id]?.account;
    if (!summary) return best;
    const forecast = forecastBalance(summary, {
      threshold: meter.threshold ?? state.settings.threshold,
    });
    return forecast.daysLeft === null ? best : best === null ? forecast.daysLeft : Math.min(best, forecast.daysLeft);
  }, null);

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'grid cols-3' },
      stat({
        label: t('meters.totalBalance'),
        value: formatMoney(totalBalance, lang),
        iconName: 'wallet',
        foot: h('span', {}, t('meters.count', { count: formatNumber(meters.length, lang) })),
      }),
      stat({
        label: t('dashboard.daysLeft'),
        value: totalDays === null ? '--' : formatDuration(totalDays, lang),
        iconName: 'clock',
        tone: totalDays !== null && totalDays < 3 ? 'danger' : '',
        foot: h('span', {}, t('meters.liveNote')),
      }),
      h(
        'div',
        { class: 'stat', style: { justifyContent: 'center' } },
        h('div', { class: 'stat-head' }, h('span', {}, t('meters.add'))),
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            style: { width: '100%', marginTop: '6px' },
            onclick: () => openAddMeterModal(ctx),
          },
          icon('plus', { size: 16 }),
          t('meters.addTitle'),
        ),
        h(
          'button',
          {
            class: 'btn sm ghost',
            type: 'button',
            style: { width: '100%', marginTop: '4px' },
            onclick: () => {
              ctx.loadAllSummaries();
              toast(t('common.refresh'), t('meters.liveNote'));
            },
          },
          icon('refresh', { size: 14 }),
          t('meters.refreshAll'),
        ),
      ),
    ),
    h(
      'div',
      { class: 'grid cols-3' },
      ...meters.map((meter) => meterCard(ctx, meter)),
      h(
        'button',
        {
          class: 'meter-card',
          type: 'button',
          style: {
            borderStyle: 'dashed',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '196px',
            color: 'var(--muted)',
            background: 'transparent',
            cursor: 'pointer',
          },
          onclick: () => openAddMeterModal(ctx),
        },
        icon('plus', { size: 22 }),
        h('span', { class: 'small' }, t('meters.addTitle')),
      ),
    ),
  );
}

