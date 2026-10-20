/**
 * Chart primitives. Plain SVG, no chart library, no canvas:
 * they inherit the theme, print well and stay sharp on any screen.
 */

import { h, icon } from './ui.js';
import { t } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

function text(content, attrs = {}) {
  const node = s('text', attrs);
  node.textContent = content;
  return node;
}

function tooltip(wrapper) {
  const tip = h('div', { class: 'chart-tip', hidden: true });
  wrapper.append(tip);
  return {
    node: tip,
    show(x, y, title, subtitle) {
      tip.innerHTML = '';
      tip.append(h('strong', {}, title));
      if (subtitle) tip.append(h('span', {}, subtitle));
      tip.hidden = false;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

/** Runs `onDismiss` when the user taps/clicks anywhere outside `wrap`. */
function dismissOnOutsideTap(wrap, onDismiss) {
  const handler = (event) => {
    if (!wrap.isConnected) {
      // The chart was re-rendered away: stop listening.
      document.removeEventListener('pointerdown', handler);
      return;
    }
    if (!wrap.contains(event.target)) onDismiss();
  };
  document.addEventListener('pointerdown', handler);
}

function emptyChart(message) {
  return h(
    'div',
    { class: 'chart-empty' },
    icon('chart', { size: 26 }),
    h('span', {}, message || t('chart.noData')),
  );
}

/* --------------------------------- bar chart ------------------------------- */

/** Charts scale with the viewport instead of letterboxing inside a wide viewBox. */
export function chartDims(width = 760, height = 260) {
  const viewport = typeof window === 'undefined' ? 1280 : window.innerWidth;
  if (viewport < 520) return { width: 430, height: Math.round(height * 0.86) };
  if (viewport < 860) return { width: 640, height: Math.round(height * 0.94) };
  return { width, height };
}

export function barChart({
  data = [],
  width = 760,
  height = 260,
  formatValue = (value) => String(value),
  formatTooltip,
  accentIndex = data.length - 1,
} = {}) {
  if (!data.length) return emptyChart();

  const pad = { top: 18, right: 6, bottom: 30, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((row) => row.value || 0), 1);
  const niceMax = niceCeil(max);
  const slot = innerW / data.length;
  const barW = Math.min(46, Math.max(10, slot * 0.52));

  const wrap = h('div', { class: 'chart-wrap' });
  const svg = s('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': t('chart.taka'),
  });

  const defs = s('defs');
  const gradient = s('linearGradient', { id: 'barAccent', x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(
    s('stop', { offset: '0', 'stop-color': '#5eead4' }),
    s('stop', { offset: '1', 'stop-color': '#14b8a6' }),
  );
  defs.append(gradient);
  svg.append(defs);

  // horizontal grid + y labels
  for (let i = 0; i <= 3; i += 1) {
    const value = (niceMax / 3) * i;
    const y = pad.top + innerH - (value / niceMax) * innerH;
    svg.append(
      s('line', {
        x1: pad.left,
        x2: width - pad.right,
        y1: y,
        y2: y,
        stroke: 'currentColor',
        'stroke-opacity': i === 0 ? 0.22 : 0.08,
        'stroke-dasharray': i === 0 ? '0' : '3 5',
      }),
    );
    svg.append(
      text(compact(value), {
        x: pad.left - 10,
        y: y + 4,
        'text-anchor': 'end',
        fill: 'currentColor',
        'fill-opacity': 0.45,
        'font-size': 10.5,
      }),
    );
  }

  const tip = tooltip(wrap);
  const labelStep = Math.ceil(data.length / 9);
  const resets = [];
  let pinned = -1;
  dismissOnOutsideTap(wrap, () => {
    pinned = -1;
    resets.forEach((reset) => reset());
  });

  data.forEach((row, index) => {
    const x = pad.left + slot * index + (slot - barW) / 2;
    const barH = Math.max(3, ((row.value || 0) / niceMax) * innerH);
    const y = pad.top + innerH - barH;
    const isAccent = index === accentIndex;

    const bar = s('rect', {
      x,
      y,
      width: barW,
      height: barH,
      rx: Math.min(7, barW / 2.4),
      fill: isAccent ? 'url(#barAccent)' : 'currentColor',
      'fill-opacity': isAccent ? 1 : 0.18,
      class: 'bar',
    });
    bar.style.transition = 'fill-opacity .18s ease';
    svg.append(bar);

    const hit = s('rect', {
      x: pad.left + slot * index,
      y: pad.top,
      width: slot,
      height: innerH,
      fill: 'transparent',
      style: 'cursor:pointer',
    });
    const activate = () => {
      bar.setAttribute('fill-opacity', isAccent ? '1' : '0.4');
      const box = wrap.getBoundingClientRect();
      const scale = box.width / width;
      tip.show(
        (x + barW / 2) * scale,
        (y - 6) * scale,
        formatTooltip ? formatTooltip(row) : formatValue(row.value),
        row.subtitle || row.label,
      );
    };
    const deactivate = () => {
      bar.setAttribute('fill-opacity', isAccent ? '1' : '0.18');
      tip.hide();
    };
    resets.push(deactivate);

    // Mouse: hover. Touch: pointerleave fires the moment the finger lifts, which
    // used to hide the tooltip instantly, so a tap now pins it until the next tap.
    hit.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      if (pinned === -1) activate();
    });
    hit.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'mouse') return;
      if (pinned !== index) deactivate();
    });
    hit.addEventListener('click', () => {
      if (pinned === index) {
        pinned = -1;
        deactivate();
        return;
      }
      resets.forEach((reset) => reset());
      pinned = index;
      activate();
    });
    svg.append(hit);

    if (index % labelStep === 0 || index === data.length - 1) {
      svg.append(
        text(row.label, {
          x: pad.left + slot * index + slot / 2,
          y: height - 8,
          'text-anchor': 'middle',
          fill: 'currentColor',
          'fill-opacity': 0.5,
          'font-size': 10.5,
        }),
      );
    }
  });

  wrap.append(svg);
  return wrap;
}

/* -------------------------------- area chart ------------------------------- */

export function areaChart({
  data = [],
  width = 760,
  height = 220,
  formatValue = (v) => String(v),
  unit = '',
} = {}) {
  if (data.length < 2) return emptyChart();

  const pad = { top: 16, right: 10, bottom: 26, left: 46 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((row) => row.value || 0), 1);
  const niceMax = niceCeil(max);
  const step = innerW / (data.length - 1);

  const points = data.map((row, index) => ({
    ...row,
    x: pad.left + step * index,
    y: pad.top + innerH - ((row.value || 0) / niceMax) * innerH,
  }));

  const wrap = h('div', { class: 'chart-wrap' });
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': unit || 'chart' });

  const defs = s('defs');
  const gradient = s('linearGradient', { id: 'areaFill', x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(
    s('stop', { offset: '0', 'stop-color': '#2dd4bf', 'stop-opacity': '0.34' }),
    s('stop', { offset: '1', 'stop-color': '#2dd4bf', 'stop-opacity': '0' }),
  );
  defs.append(gradient);
  svg.append(defs);

  for (let i = 0; i <= 3; i += 1) {
    const value = (niceMax / 3) * i;
    const y = pad.top + innerH - (value / niceMax) * innerH;
    svg.append(
      s('line', {
        x1: pad.left,
        x2: width - pad.right,
        y1: y,
        y2: y,
        stroke: 'currentColor',
        'stroke-opacity': i === 0 ? 0.2 : 0.07,
      }),
    );
    svg.append(
      text(compact(value), {
        x: pad.left - 9,
        y: y + 4,
        'text-anchor': 'end',
        fill: 'currentColor',
        'fill-opacity': 0.45,
        'font-size': 10.5,
      }),
    );
  }

  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${pad.top + innerH} L${points[0].x},${
    pad.top + innerH
  } Z`;

  svg.append(s('path', { d: areaPath, fill: 'url(#areaFill)' }));
  svg.append(
    s('path', {
      d: linePath,
      fill: 'none',
      stroke: '#2dd4bf',
      'stroke-width': 2.2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }),
  );

  const last = points[points.length - 1];
  svg.append(s('circle', { cx: last.x, cy: last.y, r: 4.5, fill: '#2dd4bf' }));
  svg.append(
    s('circle', { cx: last.x, cy: last.y, r: 9, fill: 'none', stroke: '#2dd4bf', 'stroke-opacity': 0.35 }),
  );

  const labelStep = Math.ceil(points.length / 7);
  points.forEach((point, index) => {
    if (index % labelStep !== 0 && index !== points.length - 1) return;
    svg.append(
      text(point.label, {
        x: point.x,
        y: height - 7,
        'text-anchor': 'middle',
        fill: 'currentColor',
        'fill-opacity': 0.5,
        'font-size': 10.5,
      }),
    );
  });

  const hoverLine = s('line', {
    x1: 0,
    x2: 0,
    y1: pad.top,
    y2: pad.top + innerH,
    stroke: '#2dd4bf',
    'stroke-opacity': 0.4,
    'stroke-dasharray': '3 4',
    opacity: 0,
  });
  const hoverDot = s('circle', { r: 5, fill: '#2dd4bf', opacity: 0 });
  svg.append(hoverLine, hoverDot);

  const tip = tooltip(wrap);
  const hit = s('rect', {
    x: pad.left,
    y: pad.top,
    width: innerW,
    height: innerH,
    fill: 'transparent',
  });
  const update = (event) => {
    const box = svg.getBoundingClientRect();
    const scale = width / box.width;
    const x = (event.clientX - box.left) * scale;
    const index = Math.max(0, Math.min(points.length - 1, Math.round((x - pad.left) / step)));
    const point = points[index];
    hoverLine.setAttribute('x1', point.x);
    hoverLine.setAttribute('x2', point.x);
    hoverLine.setAttribute('opacity', '1');
    hoverDot.setAttribute('cx', point.x);
    hoverDot.setAttribute('cy', point.y);
    hoverDot.setAttribute('opacity', '1');

    const wrapBox = wrap.getBoundingClientRect();
    tip.show(
      event.clientX - wrapBox.left,
      event.clientY - wrapBox.top,
      formatValue(point.value),
      point.fullLabel || point.label,
    );
  };
  const clearHover = () => {
    hoverLine.setAttribute('opacity', '0');
    hoverDot.setAttribute('opacity', '0');
    tip.hide();
  };
  hit.addEventListener('pointermove', update);
  // A tap has no hover: show the point on press and keep it until the next tap elsewhere.
  hit.addEventListener('pointerdown', update);
  hit.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') clearHover();
  });
  dismissOnOutsideTap(wrap, clearHover);
  svg.append(hit);

  wrap.append(svg);
  return wrap;
}

/* --------------------------------- sparkline ------------------------------- */

export function sparkline(values = [], { width = 120, height = 36, color = '#2dd4bf' } = {}) {
  if (values.length < 2) return h('span');
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => ({
    x: index * step,
    y: height - 3 - ((value - min) / span) * (height - 6),
  }));
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  svg.append(
    s('path', {
      d: `${line} L${width},${height} L0,${height} Z`,
      fill: color,
      'fill-opacity': 0.1,
    }),
    s('path', {
      d: line,
      fill: 'none',
      stroke: color,
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
  return svg;
}

/* ---------------------------------- donut ---------------------------------- */

export function donut({ percent = 0, size = 150, stroke = 12, label = '', sublabel = '', tone = 'accent' }) {
  const clamped = Math.max(0, Math.min(1, percent));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const colors = { accent: '#2dd4bf', warn: '#fbbf24', danger: '#fb7185', muted: '#7f97a4' };
  const color = colors[tone] || colors.accent;

  const svg = s('svg', {
    viewBox: `0 0 ${size} ${size}`,
    width: '100%',
    style: `max-width:${size}px;height:auto`,
    role: 'img',
    'aria-label': `${label} ${Math.round(clamped * 100)}%`,
  });
  svg.append(
    s('circle', {
      cx: size / 2,
      cy: size / 2,
      r: radius,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-opacity': 0.1,
      'stroke-width': stroke,
    }),
    s('circle', {
      cx: size / 2,
      cy: size / 2,
      r: radius,
      fill: 'none',
      stroke: color,
      'stroke-width': stroke,
      'stroke-linecap': 'round',
      'stroke-dasharray': `${circumference * clamped} ${circumference}`,
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
      style: 'transition: stroke-dasharray .9s cubic-bezier(.22,1,.36,1)',
    }),
  );

  if (label) {
    svg.append(
      text(label, {
        x: size / 2,
        y: size / 2 + 2,
        'text-anchor': 'middle',
        fill: 'currentColor',
        'font-size': size * 0.2,
        'font-weight': 700,
        'font-family': 'inherit',
      }),
    );
  }
  if (sublabel) {
    svg.append(
      text(sublabel, {
        x: size / 2,
        y: size / 2 + size * 0.16,
        'text-anchor': 'middle',
        fill: 'currentColor',
        'fill-opacity': 0.5,
        'font-size': size * 0.075,
        'font-family': 'inherit',
      }),
    );
  }
  return svg;
}

/* --------------------------------- helpers -------------------------------- */

function niceCeil(value) {
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const fraction = value / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

function compact(value) {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`;
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value));
}
