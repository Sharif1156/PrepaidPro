import { h, icon, toast } from '../ui.js';
import { addMeter } from '../state.js';
import { descoLoginForm } from './descologin.js';

let provider = 'desco';

/** First screen: provider tabs and a sign-in, like the utility's own app. */
export function renderOnboarding(ctx) {
  const { t } = ctx;
  const demoMode = Boolean(ctx.serverConfig?.demoMode);
  const body = h('div', { class: 'welcome-body' });

  const tab = (id, label) =>
    h(
      'button',
      {
        type: 'button',
        class: `welcome-tab${provider === id ? ' on' : ''}`,
        'aria-pressed': String(provider === id),
        onclick: () => {
          provider = id;
          ctx.renderView();
        },
      },
      icon('zap', { size: 16 }),
      label,
    );

  const accountNo = h('input', {
    class: 'input',
    inputmode: 'numeric',
    placeholder: t('welcome.example'),
    maxlength: '20',
    'aria-label': t('welcome.accountLabel'),
  });
  const err = h('p', { class: 'small', role: 'alert', style: { color: 'var(--danger)', minHeight: '1.2em' } });

  const nescoForm = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        try {
          addMeter({ provider: 'nesco', accountNo: accountNo.value, label: '' });
          ctx.navigate('dashboard');
          ctx.loadActive();
        } catch {
          err.textContent = t('welcome.invalid');
        }
      },
    },
    h('h2', { class: 'welcome-h' }, t('welcome.nescoTitle')),
    h('p', { class: 'muted' }, t('welcome.nescoDesc')),
    accountNo,
    err,
    h('button', { class: 'btn primary block', type: 'submit' }, t('onboarding.continue'), icon('arrowRight', { size: 16 })),
  );

  if (demoMode || provider === 'nesco') {
    body.append(nescoForm);
  } else {
    body.append(
      h('h2', { class: 'welcome-h' }, t('welcome.descoTitle')),
      h('p', { class: 'muted' }, t('welcome.descoDesc')),
      descoLoginForm(ctx),
    );
  }

  return h(
    'section',
    { class: 'welcome' },
    h(
      'div',
      { class: 'welcome-hero' },
      h('span', { class: 'welcome-logo' }, icon('zap', { size: 26 })),
      h('div', {}, h('strong', {}, 'PrepaidPro'), h('span', {}, t('welcome.tag'))),
      h('h1', {}, t('welcome.headline')),
      h('p', {}, t('welcome.sub')),
    ),
    h(
      'div',
      { class: 'welcome-card' },
      demoMode ? null : h('div', { class: 'welcome-label' }, t('welcome.select')),
      demoMode ? null : h('div', { class: 'welcome-tabs' }, tab('desco', 'DESCO'), tab('nesco', 'NESCO')),
      body,
      h('button', { class: 'btn ghost block', type: 'button', onclick: () => ctx.startDemo() }, icon('sparkles', { size: 16 }), t('onboarding.demo')),
      h(
        'div',
        { class: 'welcome-trust' },
        h('span', {}, icon('shield', { size: 14 }), t('welcome.secure')),
        h('span', {}, icon('check', { size: 14 }), t('welcome.official')),
        h('span', {}, icon('zap', { size: 14 }), t('welcome.realtime')),
      ),
    ),
  );
}
