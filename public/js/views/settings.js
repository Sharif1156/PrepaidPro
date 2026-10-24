import { h, icon, card, openModal, closeModal, toast, download } from '../ui.js';
import { updateSettings, clearAll, exportAll, importAll } from '../state.js';
import { formatMoney, formatDate } from '../format.js';
import { languages } from '../i18n.js';

function settingRow({ label, desc, control }) {
  return h(
    'div',
    { class: 'setting-row' },
    h('div', {}, h('p', { class: 'label' }, label), desc ? h('p', { class: 'desc' }, desc) : null),
    h('div', { class: 'control' }, control),
  );
}

function segmented(options, current, onSelect) {
  return h(
    'div',
    { class: 'segmented', role: 'group' },
    ...options.map((option) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': current === option.id ? 'true' : 'false',
          onclick: () => onSelect(option.id),
        },
        option.label,
      ),
    ),
  );
}

export function renderSettings(ctx) {
  const { t, lang, state } = ctx;
  const settings = state.settings;
  const demoMode = Boolean(ctx.serverConfig?.demoMode);
  const version = ctx.serverConfig?.version || '1.0.0';

  const languageCard = card({
    title: t('settings.appearance'),
    subtitle: t('settings.themeDesc'),
    body: h(
      'div',
      { class: 'stack', style: { gap: '0' } },
      settingRow({
        label: t('settings.language'),
        desc: t('settings.languageDesc'),
        control: segmented(
          languages.map((language) => ({ id: language.id, label: language.native })),
          settings.lang,
          (id) => {
            ctx.setLanguage(id);
            toast(t('common.save'), '');
          },
        ),
      }),
      settingRow({
        label: t('settings.theme'),
        desc: t('settings.themeDesc'),
        control: segmented(
          [
            { id: 'dark', label: t('settings.dark') },
            { id: 'light', label: t('settings.light') },
            { id: 'classic', label: t('settings.classic') },
          ],
          settings.theme,
          (id) => ctx.setTheme(id),
        ),
      }),
    ),
  });

  const thresholdInput = h('input', {
    class: 'input',
    type: 'number',
    min: '0',
    step: '50',
    value: String(settings.threshold),
    style: { width: '130px' },
    'aria-label': t('settings.threshold'),
  });

  const notificationsSwitch = h('input', {
    type: 'checkbox',
    checked: settings.notifications,
    onchange: async (event) => {
      if (event.target.checked) {
        const granted = await ctx.requestNotifications();
        if (!granted) {
          event.target.checked = false;
          return;
        }
        updateSettings({ notifications: true });
        ctx.renderView(); // show the "send test" button
      } else {
        updateSettings({ notifications: false });
        toast(t('settings.notificationsOff'));
      }
    },
  });

  const soundSwitch = h('input', {
    type: 'checkbox',
    checked: settings.alarmSound !== false,
    onchange: (event) => {
      updateSettings({ alarmSound: event.target.checked });
      if (event.target.checked) ctx.testAlarm();
    },
  });

  const alarmEntries = state.meters
    .filter((meter) => !meter.demo && settings.alarms?.[meter.id])
    .map((meter) => ({ meter, entry: settings.alarms[meter.id] }));

  const activeAlarms = alarmEntries.length
    ? h(
        'div',
        { class: 'stack', style: { gap: '8px', padding: '12px 0 2px' } },
        h('p', { class: 'label' }, t('settings.alarmActive')),
        ...alarmEntries.map(({ meter, entry }) => {
          const minutes = Math.max(0, Math.ceil((entry.nextAt - Date.now()) / 60000));
          return h(
            'div',
            { class: 'row', style: { justifyContent: 'space-between', gap: '12px' } },
            h(
              'div',
              {},
              h('p', { class: 'list-title' }, meter.label || `${meter.provider.toUpperCase()} ${meter.accountNo}`),
              h(
                'p',
                { class: 'list-sub' },
                entry.muted
                  ? t('settings.alarmMuted')
                  : t('settings.alarmNext', { min: minutes, count: entry.count }),
              ),
            ),
            entry.muted
              ? null
              : h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.stopAlarm(meter.id) }, t('settings.alarmStop')),
          );
        }),
      )
    : null;

  const alertsCard = card({
    title: t('settings.alerts'),
    subtitle: t('settings.savePrefs'),
    body: h(
      'div',
      { class: 'stack', style: { gap: '0' } },
      settingRow({
        label: t('settings.threshold'),
        desc: t('settings.thresholdDesc'),
        control: h(
          'div',
          { class: 'input-group' },
          thresholdInput,
          h(
            'button',
            {
              class: 'btn sm primary',
              type: 'button',
              onclick: () => {
                const value = Number(thresholdInput.value);
                if (!Number.isFinite(value) || value < 0) return;
                updateSettings({ threshold: value });
                ctx.renderChrome();
                ctx.renderView();
                toast(t('common.save'), t('settings.notifThreshold', { amount: formatMoney(value, lang) }));
              },
            },
            t('common.save'),
          ),
        ),
      }),
      settingRow({
        label: t('settings.notifications'),
        desc: t('settings.notificationsDesc'),
        control: h(
          'div',
          { class: 'row', style: { gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
          settings.notifications
            ? h(
                'button',
                { class: 'btn sm', type: 'button', onclick: () => ctx.sendTestNotification() },
                t('settings.notificationTest'),
              )
            : null,
          h('label', { class: 'switch' }, notificationsSwitch, h('span', { class: 'track' })),
        ),
      }),
      settingRow({
        label: t('settings.alarmSound'),
        desc: t('settings.alarmSoundDesc'),
        control: h(
          'div',
          { class: 'row', style: { gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
          h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.testAlarm() }, t('settings.alarmTest')),
          h('label', { class: 'switch' }, soundSwitch, h('span', { class: 'track' })),
        ),
      }),
      activeAlarms,
    ),
    footer: h(
      'div',
      { class: 'row', style: { justifyContent: 'space-between' } },
      h('span', {}, t('settings.notifThreshold', { amount: formatMoney(settings.threshold, lang) })),
      settings.lastNotifiedAt
        ? h('span', { class: 'faint' }, `${t('common.updated')} ${formatDate(settings.lastNotifiedAt, lang, { short: true, withTime: true })}`)
        : null,
    ),
  });

  const metersList = state.meters.length
    ? h(
        'div',
        { class: 'list' },
        ...state.meters.map((meter) =>
          h(
            'div',
            { class: 'list-row' },
            h('span', { class: 'list-icon' }, icon('meter', { size: 16 })),
            h(
              'div',
              { class: 'list-main' },
              h('p', { class: 'list-title' }, meter.label || `${meter.provider.toUpperCase()} ${meter.accountNo}`),
              h(
                'p',
                { class: 'list-sub' },
                `${meter.provider.toUpperCase()} · ${meter.accountNo}`,
                meter.demo ? h('span', { class: 'badge demo' }, t('common.demo')) : null,
              ),
            ),
            h(
              'button',
              {
                class: 'btn sm ghost',
                type: 'button',
                'aria-label': t('meters.remove'),
                // Same confirm + cleanup path as the Meters page, so the
                // dashboard never keeps showing a meter that was removed.
                onclick: () => ctx.confirmRemoveMeter(meter),
              },
              icon('trash', { size: 14 }),
            ),
          ),
        ),
      )
    : h('p', { class: 'muted small' }, t('meters.empty.body'));

  const importInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = ''; // allow picking the same file again
      if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('INVALID_BACKUP');
        const result = importAll(await file.text());
        const settingsNow = ctx.state.settings;
        ctx.setTheme(settingsNow.theme);
        ctx.setLanguage(settingsNow.lang);
        toast(
          t('settings.importDone'),
          t('settings.importSummary', { added: result.added, skipped: result.skipped }),
        );
        // A first meter may have arrived: fetch its balance.
        if (ctx.meter && !ctx.account) ctx.loadActive();
        ctx.renderChrome();
        ctx.renderView();
      } catch {
        toast(t('settings.importFailed'), t('settings.importFailedHelp'), { type: 'error', timeout: 7000 });
      }
    },
  });

  const dataCard = card({
    title: t('settings.data'),
    subtitle: t('settings.privacyDesc'),
    badge: h('span', { class: 'badge' }, icon('shield', { size: 11 }), 'Local only'),
    body: h(
      'div',
      { class: 'stack', style: { gap: '16px' } },
      h('div', {}, h('p', { class: 'setting-row', style: { padding: '0 0 10px', border: '0' } }, h('span', { class: 'label' }, t('settings.meters')), h('span', { class: 'badge' }, t('meters.count', { count: state.meters.length })))),
      metersList,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              download(`prepaidpro-backup-${new Date().toISOString().slice(0, 10)}.json`, exportAll());
              toast(t('common.export'), 'prepaidpro-backup.json');
            },
          },
          icon('download', { size: 16 }),
          t('settings.export'),
        ),
        importInput,
        h(
          'button',
          { class: 'btn', type: 'button', onclick: () => importInput.click() },
          icon('download', { size: 16, className: 'flip-v' }),
          t('settings.import'),
        ),
        h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            onclick: () => {
              openModal({
                title: t('settings.deleteAll'),
                subtitle: t('settings.deleteAllDesc'),
                body: h('div', { class: 'alert danger' }, icon('alert', { size: 18 }), h('div', {}, t('settings.deleteConfirm'))),
                footer: [
                  h('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, t('common.cancel')),
                  h(
                    'button',
                    {
                      class: 'btn danger',
                      type: 'button',
                      onclick: () => {
                        clearAll();
                        closeModal();
                        ctx.navigate('dashboard');
                        ctx.renderChrome();
                        ctx.renderView();
                        toast(t('settings.cleared'));
                      },
                    },
                    t('settings.deleteAll'),
                  ),
                ],
              });
            },
          },
          icon('trash', { size: 16 }),
          t('settings.deleteAll'),
        ),
      ),
    ),
    footer: t('settings.exportDesc'),
  });

  const aboutCard = card({
    title: t('settings.about'),
    subtitle: t('settings.aboutBody'),
    body: h(
      'div',
      { class: 'stack', style: { gap: '14px' } },
      h(
        'div',
        { class: 'kv' },
        h('div', { class: 'kv-item' }, h('dt', {}, t('settings.version')), h('dd', {}, version)),
        h(
          'div',
          { class: 'kv-item' },
          h('dt', {}, t('settings.api')),
          h('dd', {}, demoMode ? t('settings.demoActive') : t('settings.liveActive')),
        ),
        h(
          'div',
          { class: 'kv-item' },
          h('dt', {}, t('settings.openSource')),
          h(
            'dd',
            {},
            h(
              'a',
              { class: 'ghost-link', style: { padding: 0 }, href: 'https://github.com/Sharif1156/PrepaidPro', target: '_blank', rel: 'noreferrer noopener' },
              'github.com/Sharif1156/PrepaidPro',
              icon('external', { size: 12 }),
            ),
          ),
        ),
        h(
          'div',
          { class: 'kv-item' },
          h('dt', {}, t('settings.privacy')),
          h('dd', {}, h('span', { class: 'small muted' }, t('settings.privacyDesc'))),
        ),
      ),
      h(
        'div',
        { class: 'alert warn' },
        icon('alert', { size: 18 }),
        h('div', {}, h('strong', {}, t('settings.disclaimer')), t('settings.disclaimerBody')),
      ),
      h('p', { class: 'small faint' }, t('footer.disclaimer')),
    ),
    footer: h(
      'div',
      { class: 'row', style: { justifyContent: 'space-between' } },
      h('span', {}, `© ${new Date().getFullYear()} PrepaidPro · MIT`),
      h('span', { class: 'faint' }, 'Made for DESCO & NESCO customers'),
    ),
  });

  return h(
    'div',
    { class: 'stack' },
    demoMode
      ? h(
          'div',
          { class: 'alert info' },
          icon('sparkles', { size: 18 }),
          h(
            'div',
            {},
            h('strong', {}, t('settings.demoActive')),
            t('settings.apiDesc', { mode: t('settings.apiDemo') }),
          ),
        )
      : null,
    h('div', { class: 'grid cols-2', style: { alignItems: 'start' } }, languageCard, alertsCard),
    dataCard,
    aboutCard,
  );
}
