const assert = require("node:assert/strict");
const { test } = require("node:test");

const Pulse = require("./pulse");
const hour = 3600;
const day = 24 * hour;

function history(count, value = 40, step = hour, start = 0) {
  return { values: Array.from({ length: count }, (_, index) => [start + index * step, typeof value === "function" ? value(index) : value]) };
}

function node(overrides = {}) {
  return {
    name: "talos-primary", arch: "amd64", roles: ["control-plane", "worker"],
    ready: 1, cpu: 0.25, mem: 0.5, watts: 40, reqCpu: 0.75, reqMem: 0.9,
    pods: 51, kernel: "6.18.36", lowVoltage: 0, wattsSeries: history(25),
    ...overrides,
  };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be approximately ${expected}`);
}

test("node silhouettes have distinct accessible hardware drawings with unscaled strokes", () => {
  const tower = Pulse.silhouette("amd64");
  const pi = Pulse.silhouette("arm64");
  assert.notEqual(tower, pi);
  assert.match(tower, /class="twin-silhouette is-tower"/);
  assert.match(tower, /aria-label="Tower server with drive slots, ventilation and feet"/);
  assert.match(pi, /class="twin-silhouette is-pi"/);
  assert.match(pi, /aria-label="Raspberry Pi board with GPIO pins, processor and network sockets"/);
  for (const svg of [tower, pi]) {
    assert.match(svg, /viewBox="0 0 120 132" role="img"/);
    assert.match(svg, /fill="none" stroke="currentColor" stroke-width="1"/);
    const elements = [...svg.matchAll(/<(?:path|rect|circle)\b[^>]*>/g)];
    assert.ok(elements.length > 4);
    assert.ok(elements.every(([element]) => element.includes('vector-effect="non-scaling-stroke"')));
  }
});

test("ready twin cards distinguish actual zero from unavailable readings", () => {
  const html = Pulse.twinCard(node({ cpu: 0, mem: null, watts: 0, pods: 0 }));
  assert.match(html, /class="node-twin"/);
  assert.match(html, /class="twin-value">0\u00a0%<\/strong>/);
  assert.match(html, /class="twin-value">—<\/strong>/);
  assert.match(html, /class="twin-value">0\u00a0W<\/strong>/);
  assert.match(html, /<span>0 pods<\/span>/);
  assert.match(html, /class="twin-bar is-unavailable"/);
  assert.match(html, /control-plane · worker/);
  assert.doesNotMatch(html, /twin-alarm/);
});

test("requested commitments retain percentages above capacity while their markers clamp to the bar", () => {
  const html = Pulse.twinCard(node({ reqCpu: 1.25, reqMem: 0, cpu: 1.2 }));
  assert.match(html, /requested 125\u00a0%/);
  assert.match(html, /class="twin-bar-request is-over" style="left:100.00%"/);
  assert.match(html, /requested 0\u00a0%/);
  assert.match(html, /class="twin-bar-request" style="left:0.00%"/);
  assert.match(html, /class="twin-bar-fill danger" style="width:100.00%"/);
  assert.match(html, /class="twin-value">120\u00a0%/);
  assert.doesNotMatch(html, /(?:width|left):(?:125|120)\.00%/);
});

test("down and missing readiness suppress live values, request markers and charts", () => {
  for (const ready of [0, false, null, undefined]) {
    const html = Pulse.twinCard(node({ ready }));
    assert.match(html, /class="node-twin is-down"/);
    assert.equal((html.match(/class="twin-value">n\/a/g) || []).length, 3);
    assert.match(html, /Node readings unavailable/);
    assert.doesNotMatch(html, /class="twin-bar-request|<polyline/);
    assert.match(html, ready === 0 || ready === false ? /class="twin-state">not ready/ : /class="twin-state">readiness unavailable/);
  }
});

test("the voltage alarm appears only for a currently alarming Raspberry Pi", () => {
  assert.match(Pulse.twinCard(node({ arch: "arm64", lowVoltage: 1 })), /class="twin-alarm" role="status">low voltage/);
  assert.match(Pulse.twinCard(node({ arch: "arm64", lowVoltage: true })), /class="twin-alarm" role="status">low voltage/);
  for (const model of [node({ lowVoltage: 1 }), node({ arch: "arm64", lowVoltage: 0 }), node({ arch: "arm64", lowVoltage: null })]) {
    assert.doesNotMatch(Pulse.twinCard(model), /twin-alarm/);
  }
});

test("node metadata is escaped in visible text and SVG accessible names", () => {
  const html = Pulse.twinCard(node({ name: 'node"><script>x</script>', arch: '<img src=x>', roles: ['<b>admin</b>'], kernel: '" onmouseover="x' }));
  assert.doesNotMatch(html, /<script>|<img src=x>|<b>admin<\/b>| onmouseover="/);
  assert.match(html, /node&quot;&gt;&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;admin&lt;\/b&gt;/);
  assert.match(html, /kernel &quot; onmouseover=&quot;x/);
});

test("power uses separate timestamp-weighted daily and weekly windows", () => {
  const result = Pulse.power(history(169, (index) => index), 0.5);
  assert.equal(result.nowWatts, 168);
  assert.equal(result.mean24h, 156);
  assert.equal(result.mean7d, 84);
  close(result.kwh24h, 3.744);
  close(result.sgdPerDay, 1.872);
  close(result.sgd30d, 30.24);
  assert.equal(result.coverage24h.state, "complete");
  assert.equal(result.coverage7d.state, "complete");
  assert.equal(result.coverage7d.hours, 168);
});

test("irregular sample intervals are integrated by elapsed time rather than sample count", () => {
  const result = Pulse.power({ values: [[0, 0], [hour, 100], [2.5 * hour, 100], [4 * hour, 0]] }, 0.3);
  close(result.mean24h, 68.75);
  close(result.observedKwh24h, 0.275);
  assert.equal(result.coverage24h.hours, 4);
  assert.equal(result.coverage24h.state, "partial");
  assert.equal(result.kwh24h, null);
  assert.equal(result.sgdPerDay, null);
  assert.equal(result.sgd30d, null);
});

test("window integration interpolates readings at the exact 24 hour cutoff", () => {
  const result = Pulse.power(history(18, (index) => index * 1.5, 1.5 * hour), 1);
  close(result.mean24h, 13.5);
  close(result.kwh24h, 0.324);
  assert.equal(result.coverage24h.hours, 24);
});

test("range query rounding by less than one step still permits an estimated month", () => {
  const result = Pulse.power(history(297, 40, 2040), 0.3);
  assert.equal(result.coverage7d.state, "complete");
  assert.ok(result.coverage7d.ratio > 0.98 && result.coverage7d.ratio < 1);
  close(result.sgd30d, 8.64);
  close(result.kwh24h, 0.96);
});

test("explicit null samples and omitted intervals break coverage rather than bridging outages", () => {
  const explicit = history(169);
  explicit.values[160][1] = null;
  const missing = history(169);
  missing.values.splice(154, 8);
  for (const input of [explicit, missing]) {
    const result = Pulse.power(input, 0.3);
    assert.equal(result.coverage24h.state, "partial");
    assert.equal(result.coverage7d.state, "partial");
    assert.equal(result.kwh24h, null);
    assert.equal(result.sgdPerDay, null);
    assert.equal(result.sgd30d, null);
    assert.ok(result.observedKwh24h > 0);
  }
});

test("new or singleton histories report observed coverage without inventing a daily total", () => {
  for (const input of [history(1), history(2)]) {
    const result = Pulse.power(input, 0.3);
    assert.equal(result.nowWatts, 40);
    assert.equal(result.kwh24h, null);
    assert.equal(result.sgdPerDay, null);
    assert.equal(result.sgd30d, null);
  }
  const empty = Pulse.power(undefined, null);
  assert.equal(empty.nowWatts, null);
  assert.equal(empty.coverage24h.state, "unavailable");
  assert.equal(empty.observedKwh24h, null);
});

test("power preserves zero energy and zero tariff but never substitutes an unavailable tariff", () => {
  const zero = Pulse.power(history(169, 0), 0);
  assert.equal(zero.nowWatts, 0);
  assert.equal(zero.kwh24h, 0);
  assert.equal(zero.sgdPerDay, 0);
  assert.equal(zero.sgd30d, 0);
  for (const tariff of [null, undefined, NaN, Infinity, -0.3, "0.3"]) {
    const result = Pulse.power(history(169), tariff);
    close(result.kwh24h, 0.96);
    assert.equal(result.tariff, null);
    assert.equal(result.sgdPerDay, null);
    assert.equal(result.sgd30d, null);
  }
});

test("power sorts timestamps without mutating source data and retains invalid readings as gaps", () => {
  const input = { values: [[2 * hour, 0], [0, 40], [hour, NaN], [NaN, 80]] };
  const copy = structuredClone(input);
  const result = Pulse.power(input, 0.3);
  assert.deepEqual(input, copy);
  assert.equal(result.nowWatts, 0);
  assert.equal(result.coverage24h.state, "unavailable");
  assert.equal(result.mean24h, null);
});

test("day ticks mark Singapore midnights independently of the browser time zone", () => {
  const start = Date.parse("2026-09-13T12:00:00Z") / 1000;
  const ticks = Pulse.dayTicks(history(3, 40, day, start));
  assert.deepEqual(ticks.map(({ at, label }) => [new Date(at * 1000).toISOString(), label]), [
    ["2026-09-13T16:00:00.000Z", "mon"],
    ["2026-09-14T16:00:00.000Z", "tue"],
  ]);
  close(ticks[0].x, 1 / 12);
  close(ticks[1].x, 7 / 12);
  assert.ok(ticks.every(({ x }) => Number.isFinite(x) && x >= 0 && x <= 1));
});

test("day ticks handle empty, singleton and midnight-aligned histories", () => {
  assert.deepEqual(Pulse.dayTicks(undefined), []);
  assert.deepEqual(Pulse.dayTicks(history(1)), []);
  const start = Date.parse("2026-09-13T16:00:00Z") / 1000;
  const ticks = Pulse.dayTicks(history(2, null, day, start));
  assert.deepEqual(ticks.map(({ x, label }) => [x, label]), [[0, "mon"], [1, "tue"]]);
});
