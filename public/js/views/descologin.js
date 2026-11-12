import { h, icon, card, toast } from '../ui.js';
import { descoLogin, descoRegister } from '../api.js';
import { addMeter, rememberedProfile } from '../state.js';

const BD_PHONE = /^(\+?88)?01[3-9]\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function addAccounts(accounts) {
  let added = 0;
  for (const a of accounts) {
    const no = String(a.accountNo || '').replace(/\D/g, '');
    if (no.length < 5) continue;
    try {
      const saved = rememberedProfile(no);
      addMeter({ provider: 'desco', accountNo: no, label: saved.label || '', threshold: saved.threshold ?? null });
      added += 1;
    } catch {
      /* skip invalid or duplicate */
    }
  }
  return added;
}

/**
 * Everything happens inside the app: sign in, create a DESCO account
 * (mobile → code → password), and link a meter by its account number.
 */
export function descoLoginForm(ctx) {
  const { t } = ctx;
  const root = h('div', { class: 'dl-flow' });
  let phoneForSignup = '';

  const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), input);
  const msgEl = () => h('p', { class: 'small dl-msg', role: 'alert' });
  const show = (...nodes) => root.replaceChildren(...nodes);

  /** Wrap an async submit with busy state and an error line. */
  const handle = (button, msg, label, work) => async (event) => {
    event.preventDefault();
    msg.textContent = '';
    button.disabled = true;
    const old = button.lastChild.textContent;
    button.lastChild.textContent = label;
    try {
      await work();
    } catch (error) {
      msg.textContent = error?.code === 'DESCO_LOGIN_FAILED' || error?.status === 401 ? t('dlogin.failed') : error?.message || t('dlogin.failed');
      button.disabled = false;
      button.lastChild.textContent = old;
    }
  };

  const finish = (accounts) => {
    const added = addAccounts(accounts);
    if (!added) return linkStep();
    toast(t('dlogin.success', { count: added }));
    ctx.navigate('dashboard');
    ctx.refresh(true);
  };

  function loginStep(prefill = '') {
    const user = h('input', { class: 'input', id: 'dlUser', autocomplete: 'username', maxlength: '64', required: true, placeholder: t('dlogin.placeholder'), autocapitalize: 'none', value: prefill });
    const pass = h('input', { class: 'input', id: 'dlPass', type: 'password', autocomplete: 'current-password', maxlength: '128', required: true });
    const msg = msgEl();
    msg.id = 'dlMsg';
    const submit = h('button', { class: 'btn primary', type: 'submit', id: 'dlSubmit' }, icon('shield', { size: 16 }), t('dlogin.submit'));
    show(
      h(
        'form',
        {
          class: 'stack',
          onsubmit: handle(submit, msg, t('dlogin.busy'), async () => {
            const accounts = await descoLogin(user.value.trim(), pass.value);
            pass.value = '';
            finish(accounts);
          }),
        },
        field(t('dlogin.username'), user),
        field(t('dlogin.password'), pass),
        msg,
        submit,
        h(
          'div',
          { class: 'dl-links small' },
          h('button', { type: 'button', class: 'linklike', onclick: forgotStep }, t('dlogin.forgot')),
          h('span', {}, t('dlogin.new'), ' ', h('button', { type: 'button', class: 'linklike strong', id: 'dlCreate', onclick: () => signupPhone() }, t('dlogin.create'))),
        ),
        h('p', { class: 'small muted' }, t('dlogin.privacy')),
      ),
    );
  }

  function forgotStep() {
    show(
      h(
        'div',
        { class: 'stack' },
        h('h3', { class: 'dl-sub' }, t('dlogin.forgot')),
        h('p', { class: 'muted' }, t('dlogin.forgotHelp')),
        h('button', { class: 'btn primary', type: 'button', onclick: () => signupPhone() }, t('dlogin.create')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => loginStep() }, t('dlogin.back')),
      ),
    );
  }

  function signupPhone() {
    const phone = h('input', { class: 'input', id: 'suPhone', inputmode: 'numeric', autocomplete: 'tel', maxlength: '254', required: true, placeholder: t('dlogin.placeholder'), autocapitalize: 'none', value: phoneForSignup });
    const msg = msgEl();
    const submit = h('button', { class: 'btn primary', type: 'submit' }, icon('arrowRight', { size: 16 }), t('dlogin.sendCode'));
    show(
      h(
        'form',
        {
          class: 'stack',
          onsubmit: handle(submit, msg, t('dlogin.busy'), async () => {
            const value = phone.value.trim();
            if (!BD_PHONE.test(value) && !EMAIL.test(value)) throw new Error(t('dlogin.badPhone'));
            await descoRegister('start', { username: value });
            phoneForSignup = value;
            signupCode();
          }),
        },
        h('h3', { class: 'dl-sub' }, t('dlogin.create')),
        h('p', { class: 'muted' }, t('dlogin.signupIntro')),
        field(t('dlogin.username'), phone),
        msg,
        submit,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => loginStep(phoneForSignup) }, t('dlogin.back')),
      ),
    );
  }

  function signupCode() {
    const code = h('input', { class: 'input', id: 'suCode', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8', required: true });
    const msg = msgEl();
    const submit = h('button', { class: 'btn primary', type: 'submit' }, icon('check', { size: 16 }), t('dlogin.verify'));
    show(
      h(
        'form',
        {
          class: 'stack',
          onsubmit: handle(submit, msg, t('dlogin.busy'), async () => {
            await descoRegister('verify', { username: phoneForSignup, code: code.value.trim() });
            signupPassword();
          }),
        },
        h('h3', { class: 'dl-sub' }, t('dlogin.codeTitle')),
        h('p', { class: 'muted' }, t('dlogin.codeSent', { phone: phoneForSignup })),
        field(t('dlogin.code'), code),
        msg,
        submit,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => signupPhone() }, t('dlogin.back')),
      ),
    );
  }

  function signupPassword() {
    const pass = h('input', { class: 'input', id: 'suPass', type: 'password', autocomplete: 'new-password', maxlength: '128', required: true, minlength: '8' });
    const again = h('input', { class: 'input', id: 'suPass2', type: 'password', autocomplete: 'new-password', maxlength: '128', required: true });
    const msg = msgEl();
    const submit = h('button', { class: 'btn primary', type: 'submit' }, icon('shield', { size: 16 }), t('dlogin.setPassword'));
    show(
      h(
        'form',
        {
          class: 'stack',
          onsubmit: handle(submit, msg, t('dlogin.busy'), async () => {
            if (pass.value.length < 8) throw new Error(t('dlogin.passShort'));
            if (pass.value !== again.value) throw new Error(t('dlogin.passMismatch'));
            await descoRegister('set-password', { username: phoneForSignup, password: pass.value });
            const accounts = await descoLogin(phoneForSignup, pass.value);
            finish(accounts);
          }),
        },
        h('h3', { class: 'dl-sub' }, t('dlogin.passTitle')),
        field(t('dlogin.password'), pass),
        field(t('dlogin.passAgain'), again),
        msg,
        submit,
      ),
    );
  }

  /** A fresh DESCO account has no meters yet: link one by its account number. */
  function linkStep() {
    const no = h('input', { class: 'input', id: 'lkNo', inputmode: 'numeric', maxlength: '20', required: true, placeholder: t('welcome.example') });
    const msg = msgEl();
    const submit = h('button', { class: 'btn primary', type: 'submit' }, icon('arrowRight', { size: 16 }), t('onboarding.continue'));
    show(
      h(
        'form',
        {
          class: 'stack',
          onsubmit: handle(submit, msg, t('dlogin.busy'), async () => {
            try {
              addMeter({ provider: 'desco', accountNo: no.value, label: '' });
            } catch {
              throw new Error(t('welcome.invalid'));
            }
            ctx.navigate('dashboard');
            ctx.refresh(true);
          }),
        },
        h('h3', { class: 'dl-sub' }, t('dlogin.linkTitle')),
        h('p', { class: 'muted' }, t('dlogin.linkDesc')),
        field(t('welcome.accountLabel'), no),
        msg,
        submit,
      ),
    );
  }

  loginStep();
  return root;
}

export function renderDescoLogin(ctx) {
  const { t } = ctx;
  return h(
    'div',
    { class: 'stack', style: { maxWidth: '460px', margin: '24px auto' } },
    card({ title: t('dlogin.heading'), subtitle: t('dlogin.intro'), body: descoLoginForm(ctx) }),
  );
}
