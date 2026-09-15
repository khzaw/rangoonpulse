const assert = require("node:assert/strict");
const { test } = require("node:test");
const Pulse = require("./pulse");

function series(namespace, name, value, extra = {}) {
  return { labels: { namespace, persistentvolumeclaim: name, ...extra }, values: [[123, value]] };
}

function metric(...rows) {
  return { state: "live", series: rows };
}

const trend = (hours, slope = .1, initial = .4) => Array.from({ length: hours + 1 }, (_, hour) => [hour * 3600, initial + slope * hour / 24]);

test("storage inventory includes unmeasured claims and excludes retired telemetry", () => {
  const models = Pulse.joinPvcs({
    pvc_class: metric(series("default", "local", 1, { storageclass: "local-path" }), series("media", "library", 1, { storageclass: "truenas-nfs" })),
    pvc_used: metric(series("media", "library", 25), series("default", "retired", 50)),
    pvc_capacity: metric(series("media", "library", 100), series("default", "retired", 100)),
    pvc_util: metric(series("media", "library", .25), series("default", "retired", .5)),
    pvc_requested: metric(series("default", "local", 200)),
  });
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], { key: "default|local", name: "local", namespace: "default", storageClass: "local-path", util: null, used: null, capacity: null, requested: 200, measured: false, daysToFull: null });
  assert.equal(models[1].measured, true);
  assert.equal(models[1].util, .25);
  assert.equal(models[1].capacity, 100);
  assert.deepEqual(Pulse.joinPvcs({ pvc_util: metric(series("default", "retired", .5)) }), []);
});

test("storage joins include namespace and distinguish measured zero from unavailable", () => {
  const rows = Pulse.joinPvcs({
    pvc_class: metric(series("one", "data", 1), series("two", "data", 1)),
    pvc_util: metric(series("one", "data", 0)),
    pvc_used: metric(series("one", "data", 0)),
    pvc_capacity: metric(series("one", "data", 100)),
  });
  assert.equal(rows[0].util, 0);
  assert.equal(rows[0].used, 0);
  assert.equal(rows[0].measured, true);
  assert.equal(rows[1].util, null);
  assert.equal(rows[1].measured, false);
  assert.equal(rows[1].storageClass, "unknown");
});

test("storage derives utilization only from measured bytes, never requested capacity", () => {
  const [derived, requestedOnly] = Pulse.joinPvcs({
    pvc_class: metric(series("default", "observed", 1), series("default", "requested", 1)),
    pvc_used: metric(series("default", "observed", 60), series("default", "requested", 50)),
    pvc_capacity: metric(series("default", "observed", 100)),
    pvc_requested: metric(series("default", "requested", 100)),
  });
  assert.equal(derived.util, .6);
  assert.equal(derived.measured, true);
  assert.equal(requestedOnly.capacity, null);
  assert.equal(requestedOnly.util, null);
  assert.equal(requestedOnly.measured, false);
});

test("storage ignores degraded and invalid telemetry instead of presenting it as live", () => {
  const [model] = Pulse.joinPvcs({
    pvc_class: metric(series("default", "data", 1)),
    pvc_util: { state: "degraded", series: [series("default", "data", .9)] },
    pvc_used: metric(series("default", "data", -1)),
    pvc_capacity: metric(series("default", "data", NaN)),
    pvc_requested: metric(series("default", "data", 100)),
    pvc_util_7d: { ...metric({ ...series("default", "data", 0), values: trend(48) }), step: 3600 },
  });
  assert.equal(model.util, null);
  assert.equal(model.used, null);
  assert.equal(model.capacity, null);
  assert.equal(model.daysToFull, null);
});

test("storage projection fits real timestamps and numeric sample cadence", () => {
  assert.ok(Math.abs(Pulse.projectFull(trend(48), 3600) - 4) < 1e-10);
  assert.ok(Math.abs(Pulse.projectFull(trend(48).map((point) => point[1]), 3600) - 4) < 1e-10);
  assert.equal(Pulse.projectFull(trend(48).map((point) => point[1])), null);
  const offset = trend(48).map(([time, value]) => [time + 1_700_000_000, value]);
  assert.ok(Math.abs(Pulse.projectFull(offset, 1) - 4) < 1e-10);
});

test("storage projection preserves explicit and omitted gaps without compressing time", () => {
  const explicit = trend(48).map(([time, value], index) => [time, index >= 12 && index < 36 ? null : value]);
  const omitted = explicit.filter((point) => point[1] !== null);
  assert.ok(Math.abs(Pulse.projectFull(explicit, 3600) - 4) < 1e-10);
  assert.ok(Math.abs(Pulse.projectFull(omitted, 3600) - 4) < 1e-10);
  assert.ok(Math.abs(Pulse.projectFull(explicit.map((point) => point[1]), 3600) - 4) < 1e-10);
});

test("storage projection requires twelve independent observations spanning at least a day", () => {
  assert.equal(Pulse.projectFull([[0, .4]], 3600), null);
  assert.equal(Pulse.projectFull(trend(23), 3600), null);
  assert.equal(Pulse.projectFull(trend(48).filter((_, index) => index % 5 === 0), 3600), null);
  assert.equal(Pulse.projectFull(Array.from({ length: 50 }, () => [0, .4]), 3600), null);
  assert.equal(Pulse.projectFull([[0, .1], ...Array(25).fill(null).map((_, i) => [(i + 1) * 3600, null]), [86400 * 4, .3]], 3600), null);
  assert.ok(Number.isFinite(Pulse.projectFull(trend(24), 3600)));
});

test("storage projection rejects flat, falling and nonfinite histories", () => {
  assert.equal(Pulse.projectFull(trend(48, 0), 3600), null);
  assert.equal(Pulse.projectFull(trend(48, -.1), 3600), null);
  assert.equal(Pulse.projectFull(Array(49).fill(NaN), 3600), null);
  assert.equal(Pulse.projectFull(Array(49).fill(null), 3600), null);
  assert.equal(Pulse.projectFull(trend(48, .1, .9), 3600), 0);
});

test("storage projection joins only the current claim history", () => {
  const rows = Pulse.joinPvcs({
    pvc_class: metric(series("default", "data", 1), series("other", "data", 1)),
    pvc_util: metric(series("default", "data", .6), series("other", "data", .6)),
    pvc_util_7d: { ...metric({ ...series("default", "data", 0), values: trend(48) }, { ...series("other", "data", 0), values: [[123, .6]] }), step: 3600 },
  });
  assert.ok(Math.abs(rows[0].daysToFull - 4) < 1e-10);
  assert.equal(rows[1].daysToFull, null);
});

test("storage tank thresholds are 80 and 90 percent with a truthful missing texture", () => {
  for (const [util, tone] of [[0, "is-measured"], [.799, "is-measured"], [.8, "warning"], [.899, "warning"], [.9, "danger"], [1, "danger"]]) {
    const svg = Pulse.tankSvg({ name: "data", namespace: "default", util, used: util * 100, capacity: 100, measured: true });
    assert.ok(svg.includes(tone));
    assert.doesNotMatch(svg, /is-unavailable|NaN|Infinity/);
    assert.match(svg, /viewBox="0 0 44 96"/);
    assert.match(svg, /class="tank-warning-mark" d="M6 22H36"/);
  }
  const missing = Pulse.tankSvg({ name: "data", util: null, measured: false, requested: 1024 });
  assert.match(missing, /is-unavailable/);
  assert.match(missing, /utilization unavailable; requested 1\u00a0Ki/);
  assert.match(missing, /tank-missing-fill/);
  assert.doesNotMatch(missing, /class="tank-liquid"|0\u00a0%|NaN|Infinity/);
});

test("storage SVG titles escape names and each SVG owns unique IDs", () => {
  const first = Pulse.tankSvg({ namespace: "bad<&", name: '\" onload=\"alert(1)<script>', util: .5 });
  const second = Pulse.tankSvg({ namespace: "default", name: "data", util: .6 });
  assert.match(first, /bad&lt;&amp;/);
  assert.match(first, /&quot; onload=&quot;alert\(1\)&lt;script&gt;/);
  assert.doesNotMatch(first, /<script>| onload="/);
  const firstIds = [...first.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const secondIds = new Set([...second.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  assert.equal(new Set(firstIds).size, firstIds.length);
  assert.ok(firstIds.every((id) => !secondIds.has(id)));
  for (const svg of [first, second]) {
    const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    for (const [, reference] of svg.matchAll(/url\(#([^\)]+)\)/g)) assert.ok(ids.has(reference));
    assert.ok(ids.has(svg.match(/aria-labelledby="([^"]+)"/)[1]));
  }
});

test("shared halftone definitions offer five increasing densities", () => {
  const defs = Pulse.halftoneDefs("example");
  const ids = [...defs.matchAll(/<pattern id="([^"]+)"/g)].map((match) => match[1]);
  const radii = [...defs.matchAll(/\br="([^"]+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(ids, ["example-ink-1", "example-ink-2", "example-ink-3", "example-ink-4", "example-ink-5"]);
  assert.ok(radii.every((radius, index) => index === 0 || radius > radii[index - 1]));
});
