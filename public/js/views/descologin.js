import { h, icon, card, toast } from '../ui.js';
import { descoLogin } from '../api.js';
import { addMeter } from '../state.js';

export function descoLoginForm(ctx) {
  const { t } = ctx;
  const user = h('input', { class: 'input', id: 'dlUser', autocomplete: 'username', inputmode: 'tel', maxlength: '64', required: true });
  const pass = h('input', { class: 'input', id: 'dlPass', type: 'password', autocomplete: 'current-password', maxlength: '128', required: true });
  const msg = h('p', { class: 'small', id: 'dlMsg', role: 'alert', style: { color: 'var(--danger, #e5484d)', minHeight: '1.2em' } });
  const submit = h('button', { class: 'btn primary', type: 'submit', id: 'dlSubmit' }, icon('shield', { size: 16 }), t('dlogin.submit'));

  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (event) => {
        event.preventDefault();
        msg.textContent = '';
        submit.disabled = true;
        submit.lastChild.textContent = t('dlogin.busy');
        try {
          const accounts = await descoLogin(user.value.trim(), pass.value);
          pass.value = '';
          let added = 0;
          for (const a of accounts) {
            const no = String(a.accountNo || '').replace(/\D/g, '');
            if (no.length >= 5) {
              try {
                addMeter({ provider: 'desco', accountNo: no, label: '' });
                added += 1;
              } catch {
                /* skip invalid */
              }
            }
          }
          toast(t('dlogin.success', { count: added }));
          ctx.navigate('dashboard');
          ctx.refresh(true);
        } catch (error) {
          msg.textContent = error?.code === 'DESCO_LOGIN_FAILED' || error?.status === 401 ? t('dlogin.failed') : error?.message || t('dlogin.failed');
          submit.disabled = false;
          submit.lastChild.textContent = t('dlogin.submit');
        }
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'label' }, t('dlogin.username')), user),
    h('label', { class: 'field' }, h('span', { class: 'label' }, t('dlogin.password')), pass),
    msg,
    submit,
    h('p', { class: 'small muted' }, t('dlogin.privacy')),
  );

  return form;
}

export function renderDescoLogin(ctx) {
  const { t } = ctx;
  return h(
    'div',
    { class: 'stack', style: { maxWidth: '460px', margin: '24px auto' } },
    card({ title: t('dlogin.heading'), subtitle: t('dlogin.intro'), body: descoLoginForm(ctx) }),
  );
}
