import { h, icon, brandBolt } from '../ui.js';

export function renderOnboarding(ctx) {
  const { t } = ctx;

  const feature = (text) =>
    h('li', {}, icon('check', { size: 17 }), h('span', {}, text));

  const art = h(
    'div',
    { class: 'onboard-art', 'aria-hidden': 'true' },
    h('span', { class: 'ring r1' }),
    h('span', { class: 'ring r2' }),
    h('span', { class: 'ring r3' }),
    brandBolt(200),
    h(
      'span',
      { class: 'float-chip a' },
      h('span', {
        style: {
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: 'var(--accent)',
          boxShadow: '0 0 10px var(--accent)',
        },
      }),
      '৳1,240.50',
    ),
    h('span', { class: 'float-chip b' }, icon('clock', { size: 13 }), '12 days left'),
  );

  const copy = h(
    'div',
    { class: 'onboard-copy' },
    h('span', { class: 'badge accent', style: { marginBottom: '14px' } }, icon('shield', { size: 12 }), t('onboarding.badge')),
    h(
      'h2',
      {},
      t('onboarding.title'),
      ' ',
      h('em', {}, t('onboarding.titleAccent')),
    ),
    h('p', { class: 'lead' }, t('onboarding.lead')),
    h(
      'ul',
      { class: 'onboard-features' },
      feature(t('onboarding.f1')),
      feature(t('onboarding.f2')),
      feature(t('onboarding.f3')),
      feature(t('onboarding.f4')),
    ),
    h(
      'div',
      { class: 'onboard-actions' },
      h(
        'button',
        { class: 'btn primary', type: 'button', onclick: () => ctx.openAddMeter() },
        icon('plus', { size: 17 }),
        t('onboarding.add'),
      ),
      h(
        'button',
        { class: 'btn ghost', type: 'button', onclick: () => ctx.startDemo() },
        icon('sparkles', { size: 17 }),
        t('onboarding.demo'),
      ),
    ),
    h('p', { class: 'onboard-note' }, t('onboarding.note')),
  );

  return h('section', { class: 'onboard' }, art, copy);
}
