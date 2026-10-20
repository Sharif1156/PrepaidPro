/**
 * Application state, persisted in localStorage.
 *
 * Everything stays on the device: meters, settings and the last known
 * balance snapshot. There is no account, no login and no server-side
 * profile. `clearAll()` is the "delete my data" button.
 */

const STORAGE_KEY = 'prepaidpro:v1';

const defaultSettings = {
  lang: 'en',
  theme: 'dark',
  threshold: 200,
  notifications: false,
  lastNotifiedAt: null,
};

const listeners = new Set();

function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeMeter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const provider = raw.provider === 'nesco' ? 'nesco' : 'desco';
  const accountNo = String(raw.accountNo || '').replace(/\D/g, '');
  if (accountNo.length < 5) return null;
  return {
    id: raw.id || uid(),
    provider,
    accountNo,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 48) : '',
    demo: Boolean(raw.demo),
    threshold:
      raw.threshold === null || raw.threshold === undefined || raw.threshold === ''
        ? null
        : Number.isFinite(Number(raw.threshold))
          ? Number(raw.threshold)
          : null,
    addedAt: raw.addedAt || new Date().toISOString(),
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const meters = Array.isArray(raw?.meters) ? raw.meters.map(sanitizeMeter).filter(Boolean) : [];
    const settings = { ...defaultSettings, ...(raw?.settings || {}) };
    if (!['en', 'bn'].includes(settings.lang)) settings.lang = 'en';
    if (!['dark', 'light', 'classic'].includes(settings.theme)) settings.theme = 'dark';
    return {
      meters,
      settings,
      activeMeterId: meters.some((meter) => meter.id === raw?.activeMeterId)
        ? raw.activeMeterId
        : meters[0]?.id || null,
      snapshots: raw?.snapshots && typeof raw.snapshots === 'object' ? raw.snapshots : {},
    };
  } catch {
    return { meters: [], settings: { ...defaultSettings }, activeMeterId: null, snapshots: {} };
  }
}

export const state = {
  ...load(),
  online: navigator.onLine,
  loading: false,
  error: null,
};

let saveTimer = null;

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          meters: state.meters,
          settings: state.settings,
          activeMeterId: state.activeMeterId,
          snapshots: state.snapshots,
        }),
      );
    } catch (error) {
      console.warn('Could not persist state:', error);
    }
  }, 120);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setState(patch, { silent = false } = {}) {
  Object.assign(state, patch);
  save();
  if (!silent) listeners.forEach((listener) => listener(state));
}

export function activeMeter() {
  return state.meters.find((meter) => meter.id === state.activeMeterId) || null;
}

export function addMeter({ provider, accountNo, label = '', threshold = null, demo = false }) {
  const clean = String(accountNo || '').replace(/\D/g, '');
  if (clean.length < 5) throw new Error('INVALID_ACCOUNT');
  const existing = state.meters.find(
    (meter) => meter.provider === provider && meter.accountNo === clean,
  );
  if (existing) {
    setState({ activeMeterId: existing.id });
    return existing;
  }
  const meter = sanitizeMeter({ provider, accountNo: clean, label, threshold, demo, id: uid() });
  setState({ meters: [...state.meters, meter], activeMeterId: meter.id });
  return meter;
}

export function removeMeter(id) {
  const meters = state.meters.filter((meter) => meter.id !== id);
  const activeMeterId =
    state.activeMeterId === id ? meters[0]?.id || null : state.activeMeterId;
  const snapshots = { ...state.snapshots };
  for (const key of Object.keys(snapshots)) {
    if (key.includes(id)) delete snapshots[key];
  }
  setState({ meters, activeMeterId, snapshots });
}

export function setActiveMeter(id) {
  setState({ activeMeterId: id });
}

export function updateSettings(patch) {
  setState({ settings: { ...state.settings, ...patch } });
}

export function updateMeter(id, patch) {
  setState({
    meters: state.meters.map((meter) => (meter.id === id ? { ...meter, ...patch } : meter)),
  });
}

export function snapshotKey(meter) {
  return `${meter.provider}:${meter.accountNo}`;
}

export function saveSnapshot(meter, account) {
  const key = snapshotKey(meter);
  const snapshots = {
    ...state.snapshots,
    [key]: { savedAt: new Date().toISOString(), account },
  };
  // Keep at most 6 meters worth of snapshots.
  const keys = Object.keys(snapshots);
  if (keys.length > 6) {
    const oldest = keys
      .sort((a, b) => String(snapshots[a].savedAt).localeCompare(String(snapshots[b].savedAt)))
      .slice(0, keys.length - 6);
    oldest.forEach((oldKey) => delete snapshots[oldKey]);
  }
  setState({ snapshots }, { silent: true });
}

export function getSnapshot(meter) {
  return state.snapshots[snapshotKey(meter)]?.account || null;
}

export function clearAll() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  state.meters = [];
  state.activeMeterId = null;
  state.snapshots = {};
  state.settings = { ...defaultSettings };
  state.error = null;
  listeners.forEach((listener) => listener(state));
}

/**
 * Restore a backup produced by `exportAll()`.
 * Merge, never overwrite: meters already on this device are kept, new ones are
 * added, and snapshots are only filled in where none exist yet.
 * Throws Error('INVALID_BACKUP') when the file is not a PrepaidPro export.
 */
export function importAll(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch {
    throw new Error('INVALID_BACKUP');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.meters)) {
    throw new Error('INVALID_BACKUP');
  }

  const incoming = data.meters.map(sanitizeMeter).filter(Boolean);
  const meters = [...state.meters];
  let added = 0;
  let skipped = 0;
  for (const meter of incoming) {
    const exists = meters.some(
      (item) => item.provider === meter.provider && item.accountNo === meter.accountNo,
    );
    if (exists) {
      skipped += 1;
      continue;
    }
    // Never trust ids from a file: a clash would silently merge two meters.
    meters.push({ ...meter, id: uid() });
    added += 1;
  }

  const snapshots = { ...state.snapshots };
  if (data.snapshots && typeof data.snapshots === 'object') {
    for (const [key, value] of Object.entries(data.snapshots)) {
      if (!/^(desco|nesco):\d+$/.test(key) || !value || typeof value !== 'object') continue;
      if (!snapshots[key]) snapshots[key] = value;
    }
  }

  const settings = { ...state.settings };
  if (data.settings && typeof data.settings === 'object') {
    if (['en', 'bn'].includes(data.settings.lang)) settings.lang = data.settings.lang;
    if (['dark', 'light', 'classic'].includes(data.settings.theme)) settings.theme = data.settings.theme;
    const threshold = Number(data.settings.threshold);
    if (Number.isFinite(threshold) && threshold >= 0) settings.threshold = threshold;
    // `notifications` is deliberately not restored: it needs this browser's permission.
  }

  setState({
    meters,
    snapshots,
    settings,
    activeMeterId: state.activeMeterId || meters[0]?.id || null,
  });
  return { added, skipped, total: incoming.length };
}

export function exportAll() {
  return JSON.stringify(
    {
      app: 'PrepaidPro',
      version: 1,
      exportedAt: new Date().toISOString(),
      meters: state.meters,
      settings: state.settings,
      snapshots: state.snapshots,
    },
    null,
    2,
  );
}
