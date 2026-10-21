import {
  state,
  subscribe,
  activeMeter,
  addMeter,
  updateSettings,
  saveSnapshot,
  getSnapshot,
  setActiveMeter,
  removeMeter,
} from './state.js';
import { fetchMeter, ApiError, fetchServerConfig } from './api.js';
import { t, setLang, applyStaticTranslations } from './i18n.js';
import { formatMoney, formatTimeAgo, formatDuration } from './format.js';
import { icon, h, mount, toast, openModal, closeModal } from './ui.js';
import { forecastBalance } from './lib/forecast.js';
import { renderDashboard } from './views/dashboard.js';
import { renderMeters } from './views/meters.js';
import { renderUsage } from './views/usage.js';
import { renderInsights } from './views/insights.js';
import { renderSettings } from './views/settings.js';
import { renderOnboarding } from './views/onboarding.js';

const ROUTES = ['dashboard', 'meters', 'usage', 'insights', 'settings'];

const NAV = [
  { id: 'dashboard', label: 'nav.dashboard', icon: 'grid' },
  { id: 'meters', label: 'nav.meters', icon: 'meter' },
  { id: 'usage', label: 'nav.usage', icon: 'chart' },
  { id: 'insights', label: 'nav.insights', icon: 'sparkles' },
  { id: 'settings', label: 'nav.settings', icon: 'gear' },
];

const runtime = {
  account: null,
  loading: false,
  error: null,
  fetchedAt: null,
  fromSnapshot: false,
  lastKey: null,
  meterSummaries: {},
  serverConfig: null,
};

let currentRoute = 'dashboard';
let viewRenderToken = 0;

/* --------------------------------- routing -------------------------------- */

function parseRoute() {
  const hash = String(location.hash || '').replace(/^#\/?/, '');
  const route = hash.split('?')[0].split('/')[0];
  return ROUTES.includes(route) ? route : 'dashboard';
}

function routeMeta(route) {
  return {
    title: t(`nav.${route}`),
    subtitle: {
      dashboard: t('dashboard.subtitle'),
      meters: t('meters.subtitle'),
      usage: t('usage.subtitle'),
      insights: t('insights.subtitle'),
      settings: t('settings.subtitle'),
    }[route],
  };
}

function navigate(route) {
  if (!ROUTES.includes(route)) route = 'dashboard';
  if (location.hash !== `#/${route}`) {
    location.hash = `#/${route}`;
  } else {
    currentRoute = route;
    renderChrome();
    renderView();
  }
}

/* ------------------------------- chrome/nav ------------------------------- */

function renderNav() {
  const side = document.getElementById('sideNav');
  const tabbar = document.getElementById('tabbar');
  const meters = state.meters;

  mount(
    side,
    h('span', { class: 'nav-label' }, t('nav.section')),
    ...NAV.map((item) =>
      h(
        'button',
        {
          class: `nav-item ${currentRoute === item.id ? 'active' : ''}`,
          type: 'button',
          'aria-current': currentRoute === item.id ? 'page' : null,
          onclick: () => {
            closeSidebar();
            navigate(item.id);
          },
        },
        icon(item.icon),
        h('span', {}, t(item.label)),
      ),
    ),
    h('div', { class: 'divider', style: { margin: '12px 4px' } }),
    h(
      'button',
      {
        class: 'nav-item',
        type: 'button',
        onclick: () => openAddMeter(),
      },
      icon('plus'),
      h('span', {}, t('nav.addMeter')),
    ),
    meters.length
      ? h(
          'div',
          { class: 'stack', style: { gap: '2px', marginTop: '6px' } },
          h(
            'span',
            { class: 'nav-label' },
            t('meters.count', { count: meters.length }),
          ),
          ...meters.map((meter) =>
            h(
              'button',
              {
                class: `nav-item ${meter.id === state.activeMeterId ? 'active' : ''}`,
                type: 'button',
                style: { fontSize: '13px' },
                onclick: () => {
                  const changed = state.activeMeterId !== meter.id;
                  setActiveMeter(meter.id);
                  closeSidebar();
                  navigate('dashboard');
                  // Selecting a meter must also fetch that meter's balance,
                  // otherwise the dashboard keeps showing the previous one.
                  if (changed || !runtime.account) loadActive();
                },
              },
              h('span', {
                style: {
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background:
                    meter.provider === 'desco' ? 'var(--accent)' : 'var(--violet)',
                  boxShadow:
                    meter.id === state.activeMeterId ? '0 0 10px currentColor' : 'none',
                  flex: '0 0 auto',
                },
              }),
              h(
                'span',
                { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                meter.label || `${meter.provider.toUpperCase()} · ${meter.accountNo}`,
              ),
            ),
          ),
        )
      : null,
  );

  mount(
    tabbar,
    ...NAV.map((item) =>
      h(
        'button',
        {
          type: 'button',
          class: currentRoute === item.id ? 'active' : '',
          'aria-current': currentRoute === item.id ? 'page' : null,
          onclick: () => navigate(item.id),
        },
        icon(item.icon, { size: 20 }),
        h('span', {}, t(item.label)),
      ),
    ),
  );
}

function renderMiniMeter() {
  const container = document.getElementById('miniMeter');
  const meter = activeMeter();
  if (!meter) {
    mount(
      container,
      h('div', { class: 'mini-row' }, h('span', { class: 'mini-label' }, t('meters.empty.title'))),
      h(
        'button',
        { class: 'btn sm block', type: 'button', onclick: () => openAddMeter() },
        icon('plus', { size: 14 }),
        t('meters.add'),
      ),
    );
    return;
  }

  const account = runtime.account;
  const forecast = account ? forecastBalance(account, { threshold: meter.threshold ?? state.settings.threshold }) : null;
  const balance = account?.balance;

  mount(
    container,
    h(
      'div',
      { class: 'mini-row' },
      h('span', { class: 'mini-label' }, meter.provider.toUpperCase()),
      h(
        'span',
        { class: `badge ${runtime.account?.demo ? 'demo' : 'accent'}`, style: { fontSize: '9.5px' } },
        runtime.account?.demo ? 'DEMO' : 'LIVE',
      ),
    ),
    h(
      'div',
      { class: 'mini-row' },
      h('span', { class: 'mini-value' }, balance === null || balance === undefined ? '--' : formatMoney(balance, state.settings.lang, { decimals: 2 })),
      h('span', { class: 'mini-label' }, t('dashboard.balance')),
    ),
    h(
      'div',
      { class: 'mini-row' },
      h('span', { class: 'mini-value' }, forecast?.daysLeft ? formatDuration(forecast.daysLeft, state.settings.lang) : '--'),
      h('span', { class: 'mini-label' }, t('dashboard.daysLeft')),
    ),
  );
}

function renderChrome() {
  const meta = routeMeta(currentRoute);
  document.getElementById('pageTitle').textContent = meta.title;
  document.getElementById('pageSubtitle').textContent = meta.subtitle || '';
  document.title = `${meta.title} · PrepaidPro`;

  setLang(state.settings.lang);
  applyStaticTranslations();

  renderNav();
  renderMiniMeter();
  updateStatus();
}

function updateStatus() {
  const pill = document.getElementById('statusPill');
  const text = document.getElementById('statusText');
  pill.classList.remove('is-warn', 'is-error', 'is-demo', 'is-loading');

  if (runtime.loading) {
    pill.classList.add('is-loading');
    text.textContent = t('status.refreshing');
    return;
  }
  if (!navigator.onLine) {
    pill.classList.add('is-warn');
    text.textContent = t('status.offline');
    return;
  }
  if (runtime.error && !runtime.account) {
    pill.classList.add('is-error');
    text.textContent = t('status.error');
    return;
  }
  if (runtime.account?.demo) {
    pill.classList.add('is-demo');
    text.textContent = t('status.demo');
    return;
  }
  if (runtime.account) {
    if (runtime.fromSnapshot) {
      pill.classList.add('is-warn');
      text.textContent = t('status.stale');
    } else {
      text.textContent = `${t('status.live')} · ${formatTimeAgo(runtime.fetchedAt || runtime.account.fetchedAt, state.settings.lang)}`;
    }
    return;
  }
  text.textContent = t('status.connecting');
}

/* --------------------------------- data ----------------------------------- */

function currentKey() {
  const meter = activeMeter();
  return meter ? `${meter.provider}:${meter.accountNo}` : null;
}

async function loadActive({ refresh = false, silent = false } = {}) {
  const meter = activeMeter();
  if (!meter) return;
  const key = `${meter.provider}:${meter.accountNo}`;

  if (runtime.lastKey !== key) {
    runtime.account = null;
    runtime.error = null;
    runtime.fetchedAt = null;
    runtime.fromSnapshot = false;
  }
  runtime.lastKey = key;
  runtime.loading = true;
  updateStatus();
  renderMiniMeter();
  if (!silent) renderView();

  try {
    const account = await fetchMeter(meter.provider, meter.accountNo, { refresh, demo: meter.demo });
    // Ignore late responses for a meter the user already switched away from.
    if (currentKey() !== key) return;
    runtime.account = account;
    runtime.error = null;
    runtime.fetchedAt = new Date();
    runtime.fromSnapshot = false;
    saveSnapshot(meter, account);
    maybeNotify(meter, account);
    if (refresh) {
      toast(t('dashboard.refreshed'), `${formatMoney(account.balance, state.settings.lang)} · ${meter.provider.toUpperCase()} ${meter.accountNo}`);
    }
  } catch (error) {
    if (currentKey() !== key) return;
    runtime.error = error instanceof ApiError ? error : new ApiError('UNKNOWN', String(error?.message || error));
    if (!runtime.account) {
      const snapshot = getSnapshot(meter);
      if (snapshot) {
        runtime.account = snapshot;
        runtime.fromSnapshot = true;
        runtime.fetchedAt = new Date(snapshot.fetchedAt || Date.now());
      }
    }
  } finally {
    if (currentKey() === key) {
      runtime.loading = false;
      updateStatus();
      renderMiniMeter();
      renderView();
    }
  }
}

async function loadAllSummaries() {
  const meters = state.meters;
  await Promise.all(
    meters.map(async (meter) => {
      try {
        const account = await fetchMeter(meter.provider, meter.accountNo, { demo: meter.demo });
        runtime.meterSummaries[meter.id] = { account, error: null, at: Date.now() };
        saveSnapshot(meter, account);
      } catch (error) {
        runtime.meterSummaries[meter.id] = {
          account: getSnapshot(meter),
          error,
          at: Date.now(),
        };
      }
      if (currentRoute === 'meters') renderView();
    }),
  );
}

/* ------------------------------- notifications ---------------------------- */

function notificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Show a notification. `new Notification()` throws on Android Chrome and inside
 * installed apps; a service worker registration works everywhere, so use it first.
 */
async function showNotification(title, options) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return true;
    }
  } catch {
    /* fall through to the constructor */
  }
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

async function requestNotifications() {
  if (!notificationSupported()) {
    toast(t('settings.notificationsUnsupported'), '', { type: 'warn' });
    return false;
  }
  if (Notification.permission === 'denied') {
    toast(t('settings.notificationsDenied'), t('settings.notificationsDeniedHelp'), { type: 'warn', timeout: 8000 });
    return false;
  }
  let permission = Notification.permission;
  if (permission !== 'granted') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      // Very old Safari only supports the callback form.
      permission = await new Promise((resolve) => Notification.requestPermission(resolve));
    }
  }
  if (permission !== 'granted') {
    toast(
      t(permission === 'denied' ? 'settings.notificationsDenied' : 'alerts.permissionDenied'),
      permission === 'denied' ? t('settings.notificationsDeniedHelp') : '',
      { type: 'warn', timeout: 8000 },
    );
    return false;
  }
  toast(t('settings.notificationsOn'), '');
  return true;
}

async function sendTestNotification() {
  if (!notificationSupported() || Notification.permission !== 'granted') {
    toast(t('settings.notificationsDenied'), t('settings.notificationsDeniedHelp'), { type: 'warn', timeout: 8000 });
    return false;
  }
  const ok = await showNotification(t('settings.notificationTestTitle'), {
    body: t('settings.notificationTestBody'),
    icon: '/icons/icon-192.png',
    tag: 'prepaidpro-test',
  });
  if (!ok) toast(t('settings.notificationsUnsupported'), '', { type: 'warn' });
  return ok;
}

function maybeNotify(meter, account) {
  if (!notificationSupported() || Notification.permission !== 'granted') return;
  if (!state.settings.notifications) return;
  const threshold = meter.threshold ?? state.settings.threshold;
  if (typeof account.balance !== 'number' || account.balance > threshold) return;

  const last = state.settings.lastNotifiedAt ? new Date(state.settings.lastNotifiedAt).getTime() : 0;
  if (Date.now() - last < 6 * 3600_000) return;

  const forecast = forecastBalance(account, { threshold });
  const name = meter.label || `${meter.provider.toUpperCase()} ${meter.accountNo}`;
  const critical = account.balance < threshold / 2;
  const title = t(critical ? 'alerts.critical.title' : 'alerts.lowBalance.title');
  const body = t(critical ? 'alerts.critical.body' : 'alerts.lowBalance.body', {
    meter: name,
    amount: formatMoney(account.balance, state.settings.lang),
    days: formatDuration(forecast.daysLeft, state.settings.lang),
  });
  showNotification(title, { body, icon: '/icons/icon-192.png', tag: `prepaidpro-${meter.id}` }).then((shown) => {
    if (shown) updateSettings({ lastNotifiedAt: new Date().toISOString() });
  });
}

/* --------------------------------- actions -------------------------------- */

function setTheme(theme) {
  updateSettings({ theme });
  // "classic" is the light theme plus a style layer (grey page, white cards, blue buttons).
  document.documentElement.dataset.theme = theme === 'classic' ? 'light' : theme;
  if (theme === 'classic') document.documentElement.dataset.style = 'classic';
  else delete document.documentElement.dataset.style;
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute('content', theme === 'dark' ? '#070d15' : theme === 'classic' ? '#eceef1' : '#f2f6f9');
}

function setLanguage(lang) {
  updateSettings({ lang });
  setLang(lang);
  renderChrome();
  renderView();
}

function go(route) {
  navigate(route);
}

function refresh(force = true) {
  const button = document.getElementById('refreshBtn');
  button?.classList.add('spinning');
  loadActive({ refresh: force }).finally(() => {
    setTimeout(() => button?.classList.remove('spinning'), 400);
  });
}

function startDemo() {
  if (state.meters.some((item) => item.demo)) {
    const existing = state.meters.find((item) => item.demo);
    setActiveMeter(existing.id);
    navigate('dashboard');
    loadActive();
    return existing;
  }
  const meter = addMeter({
    provider: 'desco',
    accountNo: '104237569',
    label: 'Demo home',
    demo: true,
  });
  runtime.lastKey = null;
  navigate('dashboard');
  loadActive();
  toast(t('status.demo'), t('dashboard.demoNote'), { type: 'warn', timeout: 6000 });
  return meter;
}

function openAddMeter(options = {}) {
  import('./views/meters.js').then(({ openAddMeterModal }) => {
    openAddMeterModal(ctx, options);
  });
}

function confirmRemoveMeter(meter) {
  const footer = [
    h('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, t('common.cancel')),
    h(
      'button',
      {
        class: 'btn danger',
        type: 'button',
        onclick: () => {
          removeMeter(meter.id);
          runtime.lastKey = null;
          runtime.account = null;
          delete runtime.meterSummaries[meter.id];
          closeModal();
          toast(t('meters.removeSuccess'));
          if (state.meters.length) loadActive();
          renderChrome();
          renderView();
        },
      },
      t('common.remove'),
    ),
  ];
  openModal({
    title: t('meters.remove'),
    subtitle: t('meters.removeConfirm', {
      name: meter.label || `${meter.provider.toUpperCase()} ${meter.accountNo}`,
    }),
    body: h('div', { class: 'alert info' }, icon('info', { size: 18 }), h('div', {}, t('settings.privacyDesc'))),
    footer,
  });
}

/* -------------------------------- rendering -------------------------------- */

const VIEWS = {
  dashboard: renderDashboard,
  meters: renderMeters,
  usage: renderUsage,
  insights: renderInsights,
  settings: renderSettings,
};

function renderView() {
  const view = document.getElementById('view');
  if (!view) return;
  const token = ++viewRenderToken;
  const meter = activeMeter();

  let node;
  if (!meter && currentRoute !== 'settings') {
    node = renderOnboarding(ctx);
  } else {
    const render = VIEWS[currentRoute] || renderDashboard;
    node = render(ctx);
  }

  // A newer render already started (fast route switches): drop this one.
  if (token !== viewRenderToken) return;
  mount(view, node);
}

// Handy for debugging and for the end-to-end smoke test: no behaviour attached.
window.__prepaidpro = {
  get account() {
    return runtime.account;
  },
  get error() {
    return runtime.error;
  },
  get meter() {
    return activeMeter();
  },
};

const ctx = {
  get state() {
    return state;
  },
  get route() {
    return currentRoute;
  },
  get meter() {
    return activeMeter();
  },
  get account() {
    return runtime.account;
  },
  get snapshot() {
    return activeMeter() ? getSnapshot(activeMeter()) : null;
  },
  get loading() {
    return runtime.loading;
  },
  get error() {
    return runtime.error;
  },
  get fromSnapshot() {
    return runtime.fromSnapshot;
  },
  get summaries() {
    return runtime.meterSummaries;
  },
  get serverConfig() {
    return runtime.serverConfig;
  },
  get t() {
    return t;
  },
  get lang() {
    return state.settings.lang;
  },
  go,
  refresh,
  navigate,
  loadActive,
  loadAllSummaries,
  openAddMeter,
  startDemo,
  confirmRemoveMeter,
  setActiveMeter,
  requestNotifications,
  sendTestNotification,
  setTheme,
  setLanguage,
  renderChrome,
  renderView,
  closeModal,
  navigateToMeters: () => navigate('meters'),
};

/* --------------------------------- sidebar -------------------------------- */

function openSidebar() {
  const scrim = document.getElementById('scrim');
  document.querySelector('.sidebar')?.classList.add('open');
  if (scrim) {
    scrim.hidden = false;
    scrim.classList.remove('blur');   // drawer открывается → blur নেই
    scrim.onclick = closeSidebar;
  }
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('drawer-open');
}

function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  const scrim = document.getElementById('scrim');
  if (scrim) scrim.hidden = true;
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('drawer-open');
}

/* ---------------------------------- boot ---------------------------------- */

function bindEvents() {
  window.addEventListener('hashchange', () => {
    currentRoute = parseRoute();
    closeSidebar();
    renderChrome();
    renderView();
    if (currentRoute === 'meters') loadAllSummaries();
  });

  document.getElementById('refreshBtn')?.addEventListener('click', () => refresh(true));
  document.getElementById('avatarBtn')?.addEventListener('click', () => navigate('settings'));
  document.getElementById('menuBtn')?.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar?.classList.contains('open')) closeSidebar();
    else openSidebar();
  });

  window.addEventListener('online', () => {
    toast(t('status.live'), 'Connection restored');
    loadActive({ silent: true });
  });
  window.addEventListener('offline', () => {
    toast(t('status.offline'), t('errors.offline.body'), { type: 'warn' });
    updateStatus();
    renderView();
  });

  subscribe(() => {
    // Settings persisted from a view: refresh chrome labels.
    setLang(state.settings.lang);
    applyStaticTranslations();
    renderNav();
    renderMiniMeter();
  });

  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const index = Number(event.key);
    if (index >= 1 && index <= NAV.length) navigate(NAV[index - 1].id);
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.info('Service worker not registered:', error?.message);
  }
}

async function boot() {
  currentRoute = parseRoute();
  setLang(state.settings.lang);
  setTheme(state.settings.theme);
  applyStaticTranslations();
  bindEvents();
  renderChrome();
  renderView();

  runtime.serverConfig = await fetchServerConfig();
  if (runtime.serverConfig?.demoMode) {
    console.info('PrepaidPro is running in demo mode.');
  }

  if (state.meters.length) {
    await loadActive();
    if (currentRoute === 'meters') loadAllSummaries();
  }

  registerServiceWorker();
}

boot();

export { ctx };
