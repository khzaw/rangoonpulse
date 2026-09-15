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
  // Physical node drawings deliberately use the same one-pixel ink as the charts.
  function silhouette(arch) {
    const pi = arch === 'arm64';
    const label = pi ? 'Raspberry Pi board with GPIO pins, processor and network sockets' : 'Tower server with drive slots, ventilation and feet';
    const drawing = pi
      ? '<rect x="12" y="43" width="96" height="61" rx="5"/>' +
        '<path d="M24 43V33H72V43M28 33V26M34 33V26M40 33V26M46 33V26M52 33V26M58 33V26M64 33V26M70 33V26M28 39V34M34 39V34M40 39V34M46 39V34M52 39V34M58 39V34M64 39V34M70 39V34"/>' +
        '<rect x="82" y="48" width="28" height="19" rx="2"/><path d="M87 53H105V61H87ZM93 54V60M99 54V60"/>' +
        '<rect x="82" y="75" width="28" height="23" rx="2"/><path d="M87 80H105V93H87ZM91 80V84H101V80"/>' +
        '<rect x="39" y="62" width="25" height="25" rx="1"/><rect x="44" y="67" width="15" height="15"/>' +
        '<path d="M44 58V62M50 58V62M56 58V62M62 58V62M44 87V91M50 87V91M56 87V91M62 87V91M35 67H39M35 73H39M35 79H39M64 67H68M64 73H68M64 79H68M19 66H28V77H19ZM23 104V111H38V104"/>' +
        '<circle cx="20" cy="51" r="2"/><circle cx="20" cy="96" r="2"/><circle cx="74" cy="96" r="2"/>'
      : '<rect x="32" y="13" width="55" height="101" rx="3"/><path d="M78 13V114M32 48H78M40 25H70V30H40ZM40 36H70V41H40Z"/>' +
        '<circle cx="59" cy="61" r="5"/><path d="M59 54V60M41 79H68M41 85H68M41 91H68M41 97H68M41 103H68M39 114V121H48V114M70 114V121H79V114"/>' +
        '<rect x="40" y="58" width="4" height="7" rx="1"/>';
    return '<svg class="twin-silhouette ' + (pi ? 'is-pi' : 'is-tower') + '" viewBox="0 0 120 132" role="img" aria-label="' + label + '" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="square" stroke-linejoin="round">' + drawing.replace(/<(path|rect|circle)\b/g, '<$1 vector-effect="non-scaling-stroke"') + '</svg>';
  }

  function twinCard(model) {
    const ready = model.ready === 1 || model.ready === true;
    const status = ready ? 'ready' : model.ready === 0 || model.ready === false ? 'not ready' : 'readiness unavailable';
    const roles = Array.isArray(model.roles) ? model.roles.join(' · ') : model.roles;
    const unavailable = 'n/a';
    const maxWatts = model.arch === 'arm64' ? 12 : 75;
    function reading(label, value, formatter, request, scale = 1) {
      const observed = ready && numeric(value);
      const requested = ready && numeric(request);
      const display = ready ? formatter(value) : unavailable;
      const ratio = observed ? value / scale : 0;
      const tone = ratio > .9 ? ' danger' : ratio > .7 ? ' warning' : '';
      const requestLabel = requested ? 'requested ' + fmt.pct(request) : request === undefined ? '' : 'requested ' + (ready ? '—' : unavailable);
      const description = label + ': ' + display + (requestLabel ? '; ' + requestLabel : '') + (scale !== 1 ? '; scale 0–' + scale + ' watts' : '');
      return '<div class="twin-reading"><div class="twin-reading-top"><span class="twin-reading-label">' + label + '</span>' +
        '<span class="twin-request-label">' + requestLabel + '</span><strong class="twin-value">' + display + '</strong></div>' +
        '<div class="twin-bar' + (!observed ? ' is-unavailable' : '') + '" role="img" aria-label="' + esc(description) + '">' +
        '<span class="twin-bar-fill' + tone + '" style="width:' + (clamp(ratio) * 100).toFixed(2) + '%"></span>' +
        (requested ? '<span class="twin-bar-request' + (request > 1 ? ' is-over' : '') + '" style="left:' + (clamp(request) * 100).toFixed(2) + '%" title="' + esc(requestLabel) + '"></span>' : '') + '</div></div>';
    }
    const alarm = model.arch === 'arm64' && (model.lowVoltage === 1 || model.lowVoltage === true) ? '<span class="twin-alarm" role="status">low voltage</span>' : '';
    const history = ready ? sparkline(values(model.wattsSeries), { fill: true, dot: true, label: 'Estimated power over 24 hours for ' + model.name }) : '<span class="pulse-no-series">Node readings unavailable</span>';
    return '<article class="node-twin' + (!ready ? ' is-down' : '') + '" aria-label="' + esc(model.name + ', ' + status) + '">' +
      '<header class="twin-header"><div class="twin-identity"><h3>' + esc(model.name) + '</h3><div class="twin-meta">' + esc(model.arch || 'architecture unavailable') + (roles ? ' · ' + esc(roles) : '') + '</div></div>' + alarm + '</header>' +
      '<div class="twin-body"><div class="twin-machine">' + silhouette(model.arch) + '<span class="twin-machine-label">' + (model.arch === 'arm64' ? 'Raspberry Pi' : 'Workload node') + '</span></div><div class="twin-readings">' +
      reading('CPU', model.cpu, fmt.pct, model.reqCpu ?? null) + reading('Memory', model.mem, fmt.pct, model.reqMem ?? null) + reading('Est. power', model.watts, fmt.watts, undefined, maxWatts) + '</div></div>' +
      '<div class="twin-history"><span class="twin-history-label">Estimated power · 24 h</span>' + history + '</div>' +
      '<footer class="twin-footer"><span>' + (ready ? number(model.pods, 0) : unavailable) + ' pods</span><span>kernel ' + esc(model.kernel || '—') + '</span><span class="twin-state">' + status + '</span></footer></article>';
  }

  // Prometheus timestamps are seconds. Retain null samples so integration never
  // bridges an explicitly missing interval; infer cadence to catch omitted points.
  function timedPoints(series) {
    const byTime = new Map();
    for (const point of series?.values || []) {
      if (Array.isArray(point) && numeric(point[0])) byTime.set(point[0], numeric(point[1]) && point[1] >= 0 ? point[1] : null);
    }
    return [...byTime].sort((a, b) => a[0] - b[0]);
  }

  function power(series, tariff) {
    const points = timedPoints(series);
    const end = points.at(-1)?.[0] ?? null;
    const intervals = points.slice(1).map((point, index) => point[0] - points[index][0]).sort((a, b) => a - b);
    const middle = Math.floor(intervals.length / 2);
    const cadence = intervals.length ? intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2 : 0;
    function integrate(duration) {
      let seconds = 0;
      let wattSeconds = 0;
      const start = end === null ? null : end - duration;
      for (let index = 1; index < points.length; index++) {
        const [from, first] = points[index - 1];
        const [to, second] = points[index];
        if (first === null || second === null || to - from > cadence * 1.5) continue;
        const lower = Math.max(start, from);
        const upper = Math.min(end, to);
        if (upper <= lower) continue;
        const atLower = first + (second - first) * (lower - from) / (to - from);
        const atUpper = first + (second - first) * (upper - from) / (to - from);
        wattSeconds += (atLower + atUpper) / 2 * (upper - lower);
        seconds += upper - lower;
      }
      // Range queries can end up to one step short of the requested window.
      // Permit that small edge deficit, while keeping material gaps explicit.
      const sufficient = seconds / duration >= .98 && duration - seconds <= cadence + .001;
      const state = sufficient ? 'complete' : seconds > 0 ? 'partial' : 'unavailable';
      return { mean: seconds ? wattSeconds / seconds : null, kwh: seconds ? wattSeconds / 3600000 : null, coverage: { state, hours: seconds / 3600, ratio: clamp(seconds / duration), start, end } };
    }
    const recent = integrate(86400);
    const week = integrate(7 * 86400);
    const rate = numeric(tariff) && tariff >= 0 ? tariff : null;
    const kwh24h = recent.coverage.state === 'complete' ? recent.mean * 24 / 1000 : null;
    return {
      nowWatts: points.findLast((point) => numeric(point[1]))?.[1] ?? null,
      tariff: rate,
      mean24h: recent.mean,
      mean7d: week.mean,
      kwh24h,
      sgdPerDay: kwh24h !== null && rate !== null ? kwh24h * rate : null,
      sgd30d: week.coverage.state === 'complete' && rate !== null ? week.mean * 24 * 30 / 1000 * rate : null,
      observedKwh24h: recent.kwh,
      observedKwh7d: week.kwh,
      coverage24h: recent.coverage,
      coverage7d: week.coverage,
    };
  }

  function dayTicks(series) {
    const points = timedPoints(series);
    if (points.length < 2) return [];
    const start = points[0][0];
    const end = points.at(-1)[0];
    const offset = 8 * 3600;
    const day = 86400;
    const ticks = [];
    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    for (let at = Math.ceil((start + offset) / day) * day - offset; at <= end; at += day) {
      ticks.push({ x: (at - start) / (end - start), label: weekdays[new Date((at + offset) * 1000).getUTCDay()], at });
    }
    return ticks;
  }

  // Fit only observations, preserving their timestamps. A gap never shortens the
  // elapsed time or becomes an invented zero/measurement.
  function projectFull(samples, stepSeconds) {
    if (!Array.isArray(samples)) return null;
    const byTime = new Map();
    samples.forEach((sample, index) => {
      const paired = Array.isArray(sample);
      const timestamp = paired ? sample[0] : numeric(stepSeconds) && stepSeconds > 0 ? index * stepSeconds : null;
      const value = paired ? sample[1] : sample;
      if (numeric(timestamp)) byTime.set(timestamp, numeric(value) && value >= 0 ? value : null);
    });
    const observed = [...byTime].filter(([, value]) => numeric(value)).sort((a, b) => a[0] - b[0]);
    if (observed.length < 12 || observed.at(-1)[0] - observed[0][0] < 86400) return null;
    const origin = observed[0][0];
    const points = observed.map(([timestamp, value]) => [(timestamp - origin) / 86400, value]);
    const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
    const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
    let covariance = 0;
    let variance = 0;
    for (const [x, y] of points) {
      covariance += (x - meanX) * (y - meanY);
      variance += (x - meanX) ** 2;
    }
    const slope = covariance / variance;
    if (!numeric(slope) || slope <= 1e-12) return null;
    const fittedNow = meanY + slope * (points.at(-1)[0] - meanX);
    const days = (1 - fittedNow) / slope;
    return numeric(days) ? Math.max(0, days) : null;
  }

  function joinPvcs(metrics = {}) {
    function keyed(metric) {
      const result = new Map();
      if (metric?.state && metric.state !== 'live') return result;
      for (const series of metric?.series || []) {
        const { namespace, persistentvolumeclaim } = series.labels || {};
        if (typeof namespace !== 'string' || !namespace || typeof persistentvolumeclaim !== 'string' || !persistentvolumeclaim) continue;
        result.set(namespace + '|' + persistentvolumeclaim, series);
      }
      return result;
    }
    const inventory = keyed(metrics.pvc_class);
    const utilization = keyed(metrics.pvc_util);
    const usedBytes = keyed(metrics.pvc_used);
    const capacityBytes = keyed(metrics.pvc_capacity);
    const requestedBytes = keyed(metrics.pvc_requested);
    const history = keyed(metrics.pvc_util_7d);
    const nonnegative = (series) => { const value = last(series); return numeric(value) && value >= 0 ? value : null; };
    return [...inventory].map(([key, item]) => {
      const used = nonnegative(usedBytes.get(key));
      const capacity = nonnegative(capacityBytes.get(key));
      const requested = nonnegative(requestedBytes.get(key));
      const recordedUtil = nonnegative(utilization.get(key));
      const util = recordedUtil ?? (used !== null && capacity > 0 ? used / capacity : null);
      const measured = util !== null;
      return {
        key,
        name: item.labels.persistentvolumeclaim,
        namespace: item.labels.namespace,
        storageClass: item.labels.storageclass || 'unknown',
        util, used, capacity, requested, measured,
        daysToFull: measured ? projectFull(history.get(key)?.values, metrics.pvc_util_7d?.step) : null,
      };
    });
  }

  // Callers give each SVG a unique prefix, then reference <prefix>-ink-1..5.
  // Dot area increases with utilization; currentColor keeps the material in theme.
  function halftoneDefs(id) {
    const prefix = esc(id);
    return '<defs>' + [.35, .55, .78, 1.02, 1.3].map((radius, index) =>
      '<pattern id="' + prefix + '-ink-' + (index + 1) + '" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="' + radius + '" fill="currentColor"/></pattern>'
    ).join('') + '</defs>';
  }

  function tankSvg(model) {
    const id = 'pulse-tank-' + (++svgId);
    const measured = model.measured !== false && numeric(model.util) && model.util >= 0;
    const ratio = measured ? clamp(model.util) : null;
    const tone = measured && model.util >= .9 ? ' danger' : measured && model.util >= .8 ? ' warning' : '';
    const color = tone === ' danger' ? 'var(--red)' : tone === ' warning' ? 'var(--yellow)' : 'var(--text-1)';
    const identity = (model.namespace ? model.namespace + '/' : '') + (model.name || 'Volume');
    const description = measured
      ? identity + ' — ' + fmt.pct(model.util) + ' used; ' + fmt.bytes(model.used) + ' of ' + fmt.bytes(model.capacity)
      : identity + ' — utilization unavailable' + (numeric(model.requested) ? '; requested ' + fmt.bytes(model.requested) : '');
    const fillHeight = measured ? ratio * 80 : null;
    const fillY = measured ? 86 - fillHeight : null;
    const definitions = halftoneDefs(id) + '<defs><pattern id="' + id + '-missing" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0h2v2H0zM2 2h2v2H2z" fill="currentColor"/></pattern></defs>';
    const fill = measured
      ? '<rect class="tank-liquid" x="8" y="' + fillY.toFixed(3) + '" width="26" height="' + fillHeight.toFixed(3) + '" fill="url(#' + id + '-ink-' + Pulse.inkStep(model.util) + ')"/>' +
        (ratio > 0 ? '<path class="tank-meniscus" d="M8 ' + fillY.toFixed(3) + 'H34" stroke="currentColor" stroke-width=".75" opacity=".55"/>' : '')
      : '<rect class="tank-missing-fill" x="8" y="6" width="26" height="80" fill="url(#' + id + '-missing)" opacity=".14"/><path d="M16 46H26" stroke="currentColor" stroke-width="1.25"/>';
    const ticks = Array.from({ length: 11 }, (_, index) => {
      const y = 86 - index * 8;
      return '<path d="M38 ' + y + 'H' + (index % 5 === 0 ? 43 : 40) + '"/>';
    }).join('');
    return '<svg class="tank-svg' + tone + (measured ? ' is-measured' : ' is-unavailable') + '" viewBox="0 0 44 96" role="img" aria-labelledby="' + id + '-title" style="color:' + color + '">' +
      '<title id="' + id + '-title">' + esc(description) + '</title>' + definitions + fill +
      '<rect class="tank-outline" x="6" y="4" width="30" height="84" rx="3" fill="none" stroke="currentColor" stroke-width="1"/>' +
      '<path class="tank-warning-mark" d="M6 22H36" fill="none" stroke="var(--border-strong)" stroke-width=".75" stroke-dasharray="2 2"/>' +
      '<g class="tank-ruler" fill="none" stroke="var(--border-strong)" stroke-width=".65">' + ticks + '<path d="M11 92H31"/></g></svg>';
  }

  // Generic weights use item.value. Pod request floors belong to the renderer,
  // keeping this layout useful for both namespace and pod rectangles.
  function treemap(items, width, height) {
    if (!Array.isArray(items) || !numeric(width) || !numeric(height) || width <= 0 || height <= 0 || !numeric(width * height)) return [];
    const entries = items.map((item, index) => ({ item, index, value: item?.value })).filter((entry) => numeric(entry.value) && entry.value > 0).sort((a, b) => b.value - a.value || a.index - b.index);
    if (!entries.length) return [];
    const largest = entries[0].value;
    const total = entries.reduce((sum, entry) => sum + entry.value / largest, 0);
    for (const entry of entries) entry.area = (entry.value / largest / total) * width * height;
    const cells = [];
    let x = 0, y = 0, remainingWidth = width, remainingHeight = height, row = [];
    function worst(group, side) {
      if (!group.length || side <= 0) return Infinity;
      const areas = group.map((entry) => entry.area);
      const sum = areas.reduce((value, area) => value + area, 0);
      return Math.max(side * side * Math.max(...areas) / (sum * sum), sum * sum / (side * side * Math.min(...areas)));
    }
    function place(group) {
      const sum = group.reduce((value, entry) => value + entry.area, 0);
      const vertical = remainingWidth >= remainingHeight;
      const cross = vertical ? remainingHeight : remainingWidth;
      const thickness = Math.min(vertical ? remainingWidth : remainingHeight, sum / cross);
      let offset = 0;
      group.forEach((entry, index) => {
        const length = index === group.length - 1 ? Math.max(0, cross - offset) : Math.min(cross - offset, entry.area / thickness);
        cells.push({ item: entry.item, x: x + (vertical ? 0 : offset), y: y + (vertical ? offset : 0), width: vertical ? thickness : length, height: vertical ? length : thickness });
        offset += length;
      });
      if (vertical) { x += thickness; remainingWidth = Math.max(0, width - x); }
      else { y += thickness; remainingHeight = Math.max(0, height - y); }
    }
    for (const entry of entries) {
      const side = Math.min(remainingWidth, remainingHeight);
      if (row.length && worst([...row, entry], side) > worst(row, side)) { place(row); row = []; }
      row.push(entry);
    }
    if (row.length) place(row);
    return cells;
  }

  function joinPods(metrics = {}) {
    function keyed(metric, activePhase = false) {
      const result = new Map();
      if (metric?.state && metric.state !== 'live') return result;
      for (const series of metric?.series || []) {
        const { namespace, pod } = series.labels || {};
        if (typeof namespace !== 'string' || !namespace || typeof pod !== 'string' || !pod || (activePhase && last(series) !== 1)) continue;
        // Queries already aggregate containers by namespace and pod. Never sum
        // duplicate exporter observations, or memory and restart counts double.
        result.set(namespace + '|' + pod, series);
      }
      return result;
    }
    const inventory = keyed(metrics.pod_info);
    const requests = keyed(metrics.pod_mem_request);
    const usage = keyed(metrics.pod_mem_usage);
    const restarts = keyed(metrics.pod_restarts_24h);
    const phases = keyed(metrics.pod_phase, true);
    const observed = (series) => { const value = last(series); return numeric(value) && value >= 0 ? value : null; };
    return [...inventory].filter(([, series]) => typeof series.labels.node === 'string' && series.labels.node.trim()).map(([key, item]) => {
      const request = observed(requests.get(key));
      const used = observed(usage.get(key));
      return { key, name: item.labels.pod, namespace: item.labels.namespace, node: item.labels.node, request, usage: used, ratio: used !== null && request > 0 ? used / request : null, restarts: observed(restarts.get(key)), phase: phases.get(key)?.labels.phase || 'unknown' };
    });
  }

  function placementSvg(pods, width, height, options = {}) {
    if (!numeric(width) || !numeric(height) || width <= 0 || height <= 0) return '';
    const id = 'pulse-placement-' + (++svgId);
    const namespaces = new Map();
    for (const pod of pods || []) {
      if (!namespaces.has(pod.namespace)) namespaces.set(pod.namespace, { name: pod.namespace, value: 0, pods: [] });
      const namespace = namespaces.get(pod.namespace);
      const value = Math.max(32 * 1024 ** 2, numeric(pod.request) && pod.request >= 0 ? pod.request : 0);
      namespace.value += value;
      namespace.pods.push({ ...pod, value });
    }
    const text = (value, room, size = 10) => {
      const count = Math.floor(room / (size * .61));
      return count < 1 ? '' : value.length <= count ? value : count === 1 ? '…' : value.slice(0, count - 1) + '…';
    };
    const pos = (value) => Math.max(0, value).toFixed(3);
    const definitions = halftoneDefs(id) + '<defs><pattern id="' + id + '-check" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0h2v2H0zM2 2h2v2H2z" fill="currentColor" opacity=".28"/></pattern></defs>';
    const groups = treemap([...namespaces.values()], width, height).map((area) => {
      const group = area.item;
      const collapsed = options.collapsed?.has(group.name) || false;
      const gapX = Math.min(1.5, area.width / 4), gapY = Math.min(1.5, area.height / 4);
      const x = area.x + gapX, y = area.y + gapY;
      const w = Math.max(0, area.width - gapX * 2), h = Math.max(0, area.height - gapY * 2);
      // A namespace header must never consume the only space its pods have.
      // Small namespaces keep a keyboard-accessible header without visible text.
      const headerHeight = Math.min(22, h * .25);
      const inset = Math.min(1, w / 4, h / 4);
      const title = group.name + ' · ' + group.pods.length + ' pods';
      const header = '<g class="placement-namespace-label" role="button" tabindex="0" data-namespace="' + esc(group.name) + '" aria-expanded="' + !collapsed + '" aria-label="' + esc((collapsed ? 'Expand ' : 'Collapse ') + title) + '"><title>' + esc(title) + '</title><rect x="' + pos(x) + '" y="' + pos(y) + '" width="' + pos(w) + '" height="' + pos(headerHeight) + '" fill="transparent" pointer-events="all"/>' + (headerHeight >= 14 ? '<text x="' + pos(x + Math.min(6, w / 2)) + '" y="' + pos(y + 14) + '" font-size="11" fill="var(--text-1)" pointer-events="none">' + esc(text(title, w - 12, 11)) + '</text>' : '') + '</g>';
      let content = '';
      if (collapsed) {
        content = '<rect class="placement-collapsed-fill" x="' + pos(x + inset) + '" y="' + pos(y + headerHeight) + '" width="' + pos(w - inset * 2) + '" height="' + pos(h - headerHeight - inset) + '" fill="url(#' + id + '-ink-1)"/>';
      } else {
        const innerWidth = Math.max(0, w - inset * 2), innerHeight = Math.max(0, h - headerHeight - inset);
        const cells = treemap(group.pods, innerWidth, innerHeight);
        content = cells.map((cell) => {
          const pod = cell.item;
          const px = x + inset + cell.x, py = y + headerHeight + cell.y;
          const gap = Math.min(1, cell.width * .15, cell.height * .15);
          const pw = Math.max(0, cell.width - gap), ph = Math.max(0, cell.height - gap);
          const phase = pod.phase || 'unknown';
          const running = phase === 'Running';
          const step = Pulse.inkStep(pod.ratio);
          const fill = !running ? 'url(#' + id + '-check)' : step ? 'url(#' + id + '-ink-' + step + ')' : 'none';
          const description = pod.namespace + '/' + pod.name + '; request ' + fmt.bytes(pod.request) + '; usage ' + fmt.bytes(pod.usage) + '; usage/request ' + (numeric(pod.ratio) ? number(pod.ratio, 2) : 'unavailable') + '; ' + number(pod.restarts, 0) + ' restarts; phase ' + phase;
          const label = pw >= 64 && ph >= 16 ? text(pod.name, pw - 12) : '';
          const labelWidth = Math.min(pw - 4, label.length * 6.1 + 6);
          return '<g class="placement-pod' + (!running ? ' is-not-running' : '') + (options.flashing?.has(pod.key) ? ' is-flashing' : '') + '" role="img" tabindex="0" data-pod-key="' + esc(pod.key) + '" aria-label="' + esc(description) + '"><title>' + esc(description) + '</title>' +
            '<rect class="placement-pod-rect" x="' + pos(px) + '" y="' + pos(py) + '" width="' + pos(pw) + '" height="' + pos(ph) + '" fill="' + fill + '" stroke="var(--border)" stroke-width=".75" vector-effect="non-scaling-stroke"/>' +
            (numeric(pod.ratio) && pod.ratio > 1 && pw > 2 && ph > 2 ? '<rect class="placement-overload" x="' + pos(px + 1) + '" y="' + pos(py + 1) + '" width="' + pos(pw - 2) + '" height="' + pos(ph - 2) + '" fill="none" stroke="var(--red)" stroke-width="1" vector-effect="non-scaling-stroke"/>' : '') +
            (label ? '<rect class="placement-label-backplate" x="' + pos(px + 2) + '" y="' + pos(py + 2) + '" width="' + pos(labelWidth) + '" height="13" fill="var(--bg-panel)" opacity=".92" pointer-events="none"/><text class="placement-pod-name" x="' + pos(px + 5) + '" y="' + pos(py + 12) + '" font-size="10" fill="var(--text-1)" pointer-events="none">' + esc(label) + '</text>' : '') +
            (numeric(pod.restarts) && pod.restarts > 0 && pw >= 6 && ph >= 6 ? '<rect class="placement-restart" x="' + pos(px + pw - 5) + '" y="' + pos(py + 1) + '" width="4" height="4" fill="var(--text-1)" pointer-events="none"/>' : '') + '</g>';
        }).join('');
      }
      return '<g class="placement-namespace' + (collapsed ? ' is-collapsed' : '') + '"><rect class="placement-namespace-outline" x="' + pos(x) + '" y="' + pos(y) + '" width="' + pos(w) + '" height="' + pos(h) + '" fill="none" stroke="var(--border-strong)" stroke-width="1" vector-effect="non-scaling-stroke"/>' + content + header + '</g>';
    }).join('');
    return '<svg class="placement-svg" viewBox="0 0 ' + width + ' ' + height + '" role="group" aria-label="Pod placement by namespace" style="color:var(--text-1)">' + definitions + groups + '</svg>';
  }

  const Pulse = {
    numeric, esc, clamp, values, last, byLabel, fmt, number, sparkline, silhouette, twinCard, power, dayTicks, projectFull, joinPvcs, halftoneDefs, tankSvg, treemap, joinPods, placementSvg,
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
