/** Colour theme of the welcome / sign-in screen: one base colour, two shades derived from it. */
export const WELCOME_PRESETS = ['#0f9d58', '#2563eb', '#7c3aed', '#0d9488', '#dc2626', '#ea580c', '#111c2e'];

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
function mix(hex, to, amount) {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => clamp(c + (to - c) * amount));
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function applyWelcomeColor(color) {
  const root = document.body;
  const valid = /^#[0-9a-f]{6}$/i.test(color || '');
  for (const key of ['--wl-a', '--wl-b', '--wl-c']) root.style.removeProperty(key);
  if (!valid) return;
  root.style.setProperty('--wl-b', color);
  root.style.setProperty('--wl-a', mix(color, 0, 0.3));
  root.style.setProperty('--wl-c', mix(color, 255, 0.12));
}

/** A row of colour dots plus a custom picker. `onPick(hex)` receives '' for "default". */
export function colorSwatches(h, current, onPick, label) {
  const row = h('div', { class: 'wl-swatches', role: 'group', 'aria-label': label });
  for (const hex of WELCOME_PRESETS) {
    row.append(
      h('button', {
        type: 'button',
        class: `wl-swatch${current.toLowerCase() === hex ? ' on' : ''}`,
        style: { background: hex },
        'aria-label': hex,
        onclick: () => onPick(hex),
      }),
    );
  }
  const custom = h('input', { type: 'color', class: 'wl-custom', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#0f9d58', 'aria-label': label });
  custom.addEventListener('change', () => onPick(custom.value));
  row.append(custom);
  return row;
}
