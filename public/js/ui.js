/** Small DOM toolkit: element builder, icon set, modal, toasts. */

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (key === 'html') element.innerHTML = value; // trusted, in-app markup only
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, String(value));
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

export function mount(container, ...children) {
  clear(container);
  append(container, children);
  return container;
}

/* ---------------------------------- icons --------------------------------- */

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  meter: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 11h3M8 15h5"/><circle cx="16" cy="16" r="2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  sparkles:
    '<path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a2 2 0 0 0 3.4 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  zap: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M16 12h4M3 8h18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trendUp: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  trendDown: '<path d="m3 7 6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  external: '<path d="M14 4h6v6M20 4 10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  gauge: '<path d="M12 14 16 9"/><path d="M4.5 19a9 9 0 1 1 15 0"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/><path d="M5 11v2M8 11v2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  receipt: '<path d="M4 4h16v18l-3-2-3 2-2-2-2 2-3-2-3 2V4Z"/><path d="M8 9h8M8 13h5"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h10"/>',
  leaf: '<path d="M4 20c0-8 5-14 16-16 0 11-6 16-13 16H4Z"/><path d="M4 20c2-6 6-9 12-11"/>',
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Z"/><path d="M9 21v-7h6v7"/>',
};

export function icon(name, { size = 18, stroke = 1.7, className = '' } = {}) {
  const body = ICONS[name] || ICONS.info;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  svg.innerHTML = body;
  return svg;
}

export function brandBolt(size = 40) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'big-bolt');
  svg.innerHTML =
    '<defs><linearGradient id="boltGrad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>' +
    '<circle cx="32" cy="32" r="26" fill="none" stroke="#123b3a" stroke-width="2.5" stroke-dasharray="4 5"/>' +
    '<path d="M35 6 19 35h12l-2 23 16-30H33L35 6Z" fill="url(#boltGrad)"/>';
  return svg;
}

/* ---------------------------------- toast --------------------------------- */

export function toast(title, message = '', { type = 'success', timeout = 4200 } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const iconName = type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check';
  const node = h(
    'div',
    { class: `toast ${type}`, role: 'status' },
    h('span', { class: 'ico' }, icon(iconName, { size: 17 })),
    h('div', {}, h('strong', {}, title), message ? h('span', {}, message) : null),
  );
  // Never stack more than three at once; drop the oldest.
  while (root.children.length >= 3) root.firstElementChild.remove();
  root.append(node);
  const remove = () => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  };
  node.addEventListener('click', remove);
  setTimeout(remove, timeout);
}

/* ---------------------------------- modal --------------------------------- */

let activeModal = null;

export function openModal({ title, subtitle, body, footer, onClose, width }) {
  closeModal();
  const root = document.getElementById('modalRoot');
  const scrim = document.getElementById('scrim');

  const content = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  if (width) content.style.width = width;

  const head = h(
    'div',
    { class: 'modal-head' },
    h('div', {}, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null),
    h(
      'button',
      { class: 'modal-close', type: 'button', 'aria-label': 'Close', onclick: () => closeModal() },
      icon('x', { size: 16 }),
    ),
  );

  const bodyNode = h('div', { class: 'modal-body' });
  append(bodyNode, [body]);

  const footNode = footer ? h('div', { class: 'modal-foot' }, footer) : null;

  content.append(head, bodyNode);
  if (footNode) content.append(footNode);
  mount(root, content);
  scrim.hidden = false;
  scrim.classList.add('blur');
  scrim.onclick = () => closeModal();

  const focusable = content.querySelector(
    'input, select, textarea, button.primary, button:not(.modal-close), a[href]',
  );
  if (focusable) setTimeout(() => focusable.focus(), 40);

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
    if (event.key === 'Tab') {
      const items = [...content.querySelectorAll('input, select, textarea, button, a[href]')].filter(
        (el) => !el.disabled && el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  activeModal = { onKey, onClose };
  document.body.style.overflow = 'hidden';
  return { close: closeModal, element: content };
}

export function closeModal() {
  const root = document.getElementById('modalRoot');
  const scrim = document.getElementById('scrim');
  if (activeModal) {
    document.removeEventListener('keydown', activeModal.onKey);
    if (typeof activeModal.onClose === 'function') activeModal.onClose();
    activeModal = null;
  }
  if (scrim) {
    scrim.hidden = true;
    scrim.classList.remove('blur');
  }
  document.body.style.overflow = '';
}

/* --------------------------------- helpers -------------------------------- */

export function debounce(fn, wait = 220) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Builds the standard card shell used by every view. */
export function card({ title, subtitle, badge, actions, body, footer, className = '' }) {
  const head =
    title || actions
      ? h(
          'div',
          { class: 'card-head' },
          h(
            'div',
            {},
            title
              ? h('h3', { class: 'card-title' }, title, badge || null)
              : null,
            subtitle ? h('p', { class: 'card-sub' }, subtitle) : null,
          ),
          actions ? h('div', { class: 'row' }, actions) : null,
        )
      : null;
  return h(
    'section',
    { class: `card ${className}` },
    head,
    h('div', { class: 'card-body' }, body),
    footer ? h('div', { class: 'card-foot' }, footer) : null,
  );
}

export function stat({ label, value, unit, iconName, foot, tone = '' }) {
  return h(
    'div',
    { class: 'stat' },
    h(
      'div',
      { class: 'stat-head' },
      h('span', {}, label),
      iconName ? h('span', { class: `stat-icon ${tone}` }, icon(iconName, { size: 16 })) : null,
    ),
    h('div', { class: 'stat-value' }, value, unit ? h('small', {}, unit) : null),
    foot ? h('div', { class: 'stat-foot' }, foot) : null,
  );
}

export function skeletonCard(lines = 3) {
  const body = [];
  body.push(h('span', { class: 'skeleton sk-title' }));
  for (let i = 0; i < lines; i += 1) {
    body.push(h('span', { class: 'skeleton sk-line', style: { width: `${88 - i * 13}%` } }));
  }
  return h('div', { class: 'card' }, h('div', { class: 'card-body' }, body));
}
