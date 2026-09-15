const assert = require("node:assert/strict");
const { test } = require("node:test");

const Pulse = require("./pulse");

function series(values, labels = {}) {
  return { labels, values: values.map((value, index) => [index * 300, value]) };
}

function coordinates(svg, element) {
  return [...svg.matchAll(new RegExp(`<${element}\\b[^>]*points="([^"]+)"`, "g"))]
    .map((match) => match[1].split(" ").map((point) => point.split(",").map(Number)));
}

test("metric values preserve zero and gaps without coercing missing or invalid data", () => {
  const input = series([0, null, 0.5, NaN, Infinity, -Infinity, "0", undefined, false]);

  assert.deepEqual(Pulse.values(input), [0, null, 0.5, null, null, null, null, null, null]);
  assert.equal(input.values[6][1], "0");
  assert.deepEqual(Pulse.values(undefined), []);
  assert.deepEqual(Pulse.values({}), []);
});

test("last returns the latest finite observation while distinguishing an observed zero from no data", () => {
  assert.equal(Pulse.last(series([0.5, 0, null, NaN])), 0);
  assert.equal(Pulse.last(series([null, NaN, Infinity])), null);
  assert.equal(Pulse.last(series([])), null);
  assert.equal(Pulse.last(undefined), null);
});

test("byLabel preserves each labeled series for node and PVC joins", () => {
  const primary = series([0], { node: "talos-primary", namespace: "default" });
  const utility = series([0.25], { node: "talos-utility", namespace: "monitoring" });
  const mapped = Pulse.byLabel({ series: [primary, utility] }, "node");

  assert.ok(mapped instanceof Map);
  assert.equal(mapped.get("talos-primary"), primary);
  assert.equal(mapped.get("talos-utility"), utility);
  assert.equal(mapped.get("missing"), undefined);
  assert.equal(Pulse.byLabel(undefined, "node").size, 0);
});

test("formatters retain real zero values and use nonbreaking unit spacing", () => {
  assert.equal(Pulse.fmt.pct(0), "0\u00a0%");
  assert.equal(Pulse.fmt.pct(0.125), "12.5\u00a0%");
  assert.equal(Pulse.fmt.watts(0), "0\u00a0W");
  assert.equal(Pulse.fmt.watts(42.25), "42.3\u00a0W");
  assert.equal(Pulse.fmt.sgd(0), "S$\u00a00.00");
  assert.equal(Pulse.fmt.sgd(12.5), "S$\u00a012.50");
  assert.equal(Pulse.fmt.bytes(0), "0\u00a0B");
  assert.equal(Pulse.fmt.bytes(1023), "1,023\u00a0B");
  assert.equal(Pulse.fmt.bytes(1024), "1\u00a0Ki");
  assert.equal(Pulse.fmt.bytes(1.5 * 1024 ** 2), "1.5\u00a0Mi");
  assert.equal(Pulse.fmt.bytes(1024 ** 3), "1\u00a0Gi");
  assert.equal(Pulse.fmt.bytes(2 * 1024 ** 4), "2\u00a0Ti");
});

test("formatters render unavailable data as unavailable rather than a fabricated zero", () => {
  for (const format of Object.values(Pulse.fmt)) {
    for (const value of [null, undefined, NaN, Infinity, -Infinity, "0"]) {
      assert.equal(format(value), "—");
    }
  }
});

test("sparklines break both strokes and fills at missing observations", () => {
  const svg = Pulse.sparkline([0, 1, null, 4, 5], { fill: true });
  const lines = coordinates(svg, "polyline");
  const fills = coordinates(svg, "polygon");

  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.map(([x]) => x)), [[0, 30], [90, 120]]);
  assert.equal(fills.length, 2);
  assert.ok(fills[0].every(([x]) => x <= 30));
  assert.ok(fills[1].every(([x]) => x >= 90));
  assert.equal((svg.match(/vector-effect="non-scaling-stroke"/g) || []).length, 2);
});

test("sparklines report no history only when no finite samples exist", () => {
  for (const data of [[], [null], [NaN, Infinity, undefined]]) {
    assert.match(Pulse.sparkline(data), /No history available/);
    assert.doesNotMatch(Pulse.sparkline(data), /<svg/);
  }
  assert.match(Pulse.sparkline([0, 0]), /<svg/);
});

test("singleton and flat histories remain visible with finite coordinates", () => {
  const singleton = Pulse.sparkline([0], { dot: true });
  assert.match(singleton, /<circle cx="60" cy="14"/);
  assert.match(singleton, /<rect x="59" y="13"/);

  for (const value of [0, 1, -1, 1024 ** 4]) {
    const svg = Pulse.sparkline([value, value, value]);
    const [points] = coordinates(svg, "polyline");
    assert.equal(points.length, 3);
    assert.ok(points.flat().every(Number.isFinite));
    assert.ok(points.every(([, y]) => y > 0 && y < 28));
    assert.equal(new Set(points.map(([, y]) => y)).size, 1);
  }
});

test("nonfinite data creates gaps instead of invalid SVG coordinates", () => {
  const svg = Pulse.sparkline([0, 1, Infinity, 2, 3, NaN, 4, 5], { fill: true, dot: true });

  assert.equal(coordinates(svg, "polyline").length, 3);
  assert.ok(coordinates(svg, "polyline").flat(2).every(Number.isFinite));
  assert.ok(coordinates(svg, "polygon").flat(2).every(Number.isFinite));
  assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
});

test("explicit chart bounds clamp outliers and respect custom chart dimensions", () => {
  const svg = Pulse.sparkline([-1, 0.5, 2], { min: 0, max: 1, width: 240, height: 60 });
  const [points] = coordinates(svg, "polyline");

  assert.match(svg, /viewBox="0 0 240 60"/);
  assert.match(svg, /preserveAspectRatio="none"/);
  assert.deepEqual(points, [[0, 58], [120, 30], [240, 2]]);
});

test("the endpoint marker follows the last observation before trailing gaps", () => {
  const svg = Pulse.sparkline([0, 1, null, 2, null], { min: 0, max: 2, dot: true });

  assert.match(svg, /<rect x="89" y="1" width="2" height="2"/);
  assert.doesNotMatch(Pulse.sparkline([0, 1]), /<rect/);
});

test("chart labels escape markup and cannot introduce SVG attributes", () => {
  const svg = Pulse.sparkline([0, 1], { label: 'disk " onclick="alert(1) <script>&\'' });

  assert.match(svg, /aria-label="disk &quot; onclick=&quot;alert\(1\) &lt;script&gt;&amp;&#39;"/);
  assert.doesNotMatch(svg, /<script>| onclick="/);
  assert.match(svg, /role="img"/);
});

test("halftone fills use unique pattern IDs with references confined to their own chart", () => {
  const first = Pulse.sparkline([0, 1], { fill: true, pattern: true });
  const second = Pulse.sparkline([0, 1], { fill: true, pattern: true });
  const firstId = first.match(/<pattern id="([^"]+)"/)[1];
  const secondId = second.match(/<pattern id="([^"]+)"/)[1];

  assert.notEqual(firstId, secondId);
  assert.ok(first.includes(`fill="url(#${firstId})"`));
  assert.ok(second.includes(`fill="url(#${secondId})"`));
  assert.ok(!first.includes(secondId));
  assert.ok(!second.includes(firstId));
});

test("ink density distinguishes missing usage and each documented utilization boundary", () => {
  for (const missing of [null, undefined, NaN, Infinity, "0"]) {
    assert.equal(Pulse.inkStep(missing), 0);
  }
  for (const [ratio, step] of [[0, 1], [0.249, 1], [0.25, 2], [0.499, 2], [0.5, 3], [0.749, 3], [0.75, 4], [1, 4], [1.001, 5]]) {
    assert.equal(Pulse.inkStep(ratio), step, `density for utilization ${ratio}`);
  }
});

test("fetch requests named metrics and range with a bounded abort signal", async (t) => {
  const payload = {
    at: "2026-09-15T10:00:00.000Z",
    metrics: {
      node_cpu: { state: "live", series: [series([0])] },
      cluster_watts: { state: "live", series: [series([0])] },
      pvc_util_7d: { state: "degraded", series: [] },
    },
  };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    calls.push({ url: new URL(input, "https://controlpanel.example"), options });
    return { ok: true, json: async () => payload };
  });

  assert.equal(await Pulse.fetch(["node_cpu", "cluster_watts"]), payload);
  assert.equal(calls[0].url.pathname, "/api/metrics");
  assert.equal(calls[0].url.searchParams.get("names"), "node_cpu,cluster_watts");
  assert.equal(calls[0].url.searchParams.get("range"), "24h");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.signal.aborted, false);

  await Pulse.fetch(["pvc_util_7d"], "7d");
  assert.equal(calls[1].url.searchParams.get("range"), "7d");
});

test("fetch rejects failed HTTP responses and preserves network failures", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  await assert.rejects(Pulse.fetch(["cluster_watts"]), /Metrics unavailable \(503\)/);

  const networkError = new Error("network unavailable");
  fetch.mock.mockImplementation(async () => { throw networkError; });
  await assert.rejects(Pulse.fetch(["cluster_watts"]), (error) => error === networkError);
});

test("fetch rejects malformed snapshots instead of displaying false live status", async (t) => {
  const at = "2026-09-15T10:00:00.000Z";
  const metrics = { cluster_watts: { state: "live", series: [] } };
  const fetch = t.mock.method(globalThis, "fetch");

  for (const payload of [null, {}, { metrics }, { at: "invalid", metrics }, { at }, { at, metrics: {} }, { at, metrics: { cluster_watts: {} } }]) {
    fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => payload }));
    await assert.rejects(Pulse.fetch(["cluster_watts"]), /Invalid metrics response/);
  }
});
