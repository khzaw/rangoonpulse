/* Small, dependency-free rendering primitives for the cluster Pulse page. */
(function (root) {
  'use strict';
  const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const values = (series) => (series?.values || []).map((point) => numeric(point[1]) ? point[1] : null);
  const last = (series) => values(series).findLast(numeric) ?? null;
  const byLabel = (metric, key) => new Map((metric?.series || []).map((series) => [series.labels[key], series]));
  const number = (value, digits = 1) => numeric(value) ? value.toLocaleString('en-SG', { maximumFractionDigits: digits }) : '—';
  const fmt = {
    pct: (value) => numeric(value) ? number(value * 100) + '\u00a0%' : '—',
    watts: (value) => numeric(value) ? number(value) + '\u00a0W' : '—',
    sgd: (value) => numeric(value) ? 'S$\u00a0' + value.toFixed(2) : '—',
    bytes(value) {
      if (!numeric(value)) return '—';
      const unit = value >= 1024 ** 4 ? 4 : value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0;
      return number(value / 1024 ** unit) + '\u00a0' + ['B', 'Ki', 'Mi', 'Gi', 'Ti'][unit];
    },
  };
  let svgId = 0;
  function sparkline(input, options = {}) {
    const data = input.map((value) => numeric(value) ? value : null);
    const finite = data.filter(numeric);
    if (!finite.length) return '<span class="pulse-no-series">No history available</span>';
    let min = options.min ?? Math.min(...finite);
    let max = options.max ?? Math.max(...finite);
    const pad = (max - min || Math.abs(max) || 1) * 0.05;
    if (options.min == null) min -= pad;
    if (options.max == null) max += pad;
    if (max <= min) max = min + 1;
    const height = options.height || 28;
    const width = options.width || 120;
    const bottom = height - 2;
    const segments = [];
    let segment = [];
    data.forEach((value, index) => {
      if (value === null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else {
        segment.push([data.length > 1 ? index / (data.length - 1) * width : width / 2, bottom - clamp((value - min) / (max - min)) * (height - 4)]);
      }
    });
    if (segment.length) segments.push(segment);
    const id = 'pulse-dots-' + (++svgId);
    const points = (part) => part.map(([x, y]) => x.toFixed(2) + ',' + y.toFixed(2)).join(' ');
    const definitions = options.pattern ? '<defs><pattern id="' + id + '" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="0.8" fill="currentColor"/></pattern></defs>' : '';
    const fills = options.fill ? segments.map((part) => '<polygon points="' + points([[part[0][0], bottom], ...part, [part.at(-1)[0], bottom]]) + '" fill="' + (options.pattern ? 'url(#' + id + ')' : 'currentColor') + '" opacity="' + (options.pattern ? '.3' : '.10') + '"/>').join('') : '';
    const ticks = (options.ticks || []).map((tick) => '<line x1="' + clamp(tick.x) * width + '" x2="' + clamp(tick.x) * width + '" y1="0" y2="' + height + '" stroke="var(--subtle-line-strong)" vector-effect="non-scaling-stroke"/>').join('');
    const lines = segments.map((part) => part.length === 1 ? '<circle cx="' + part[0][0] + '" cy="' + part[0][1] + '" r="1" fill="currentColor"/>' : '<polyline points="' + points(part) + '" fill="none" stroke="currentColor" stroke-width="1.25" vector-effect="non-scaling-stroke"/>').join('');
    const endpoint = segments.at(-1)?.at(-1);
    const dot = options.dot && endpoint ? '<rect x="' + (endpoint[0] - 1) + '" y="' + (endpoint[1] - 1) + '" width="2" height="2" fill="currentColor"/>' : '';
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" role="img" aria-label="' + esc(options.label || 'Metric history') + '">' + definitions + ticks + fills + lines + dot + '</svg>';
  }
  const Pulse = {
    numeric, esc, clamp, values, last, byLabel, fmt, number, sparkline,
    inkStep: (ratio) => !numeric(ratio) ? 0 : ratio < .25 ? 1 : ratio < .5 ? 2 : ratio < .75 ? 3 : ratio <= 1 ? 4 : 5,
    async fetch(names, range = '24h') {
      const response = await root.fetch('/api/metrics?' + new URLSearchParams({ names: names.join(','), range }), { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Metrics unavailable (' + response.status + ')');
      const snapshot = await response.json();
      if (!snapshot || !Number.isFinite(Date.parse(snapshot.at)) || !snapshot.metrics || names.some((name) => !snapshot.metrics[name] || !Array.isArray(snapshot.metrics[name].series))) {
        throw new Error('Invalid metrics response');
      }
      return snapshot;
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Pulse;
  else root.Pulse = Pulse;
})(typeof window !== 'undefined' ? window : globalThis);
