const assert = require("node:assert/strict");
const { test } = require("node:test");
const Pulse = require("./pulse");

function series(namespace, pod, value, labels = {}) {
  return { labels: { namespace, pod, ...labels }, values: [[123, value]] };
}
const metric = (...rows) => ({ state: "live", series: rows });
const pod = (name, overrides = {}) => ({ key: "default|" + name, name, namespace: "default", node: "primary", request: 64 * 1024 ** 2, usage: 32 * 1024 ** 2, ratio: 0.5, restarts: 0, phase: "Running", ...overrides });

test("treemap conserves area with finite, bounded and non-overlapping rectangles", () => {
  const items = Array.from({ length: 40 }, (_, index) => ({ name: "pod-" + index, value: (index + 1) ** 2 }));
  const cells = Pulse.treemap(items, 713, 317);
  assert.equal(cells.length, items.length);
  let area = 0;
  for (const cell of cells) {
    assert.ok([cell.x, cell.y, cell.width, cell.height].every(Number.isFinite));
    assert.ok(cell.x >= 0 && cell.y >= 0 && cell.width > 0 && cell.height > 0);
    assert.ok(cell.x + cell.width <= 713 + 1e-8);
    assert.ok(cell.y + cell.height <= 317 + 1e-8);
    area += cell.width * cell.height;
  }
  assert.ok(Math.abs(area - 713 * 317) < 1e-6);
  for (let index = 0; index < cells.length; index++) {
    for (const other of cells.slice(index + 1)) {
      const cell = cells[index];
      const overlapWidth = Math.min(cell.x + cell.width, other.x + other.width) - Math.max(cell.x, other.x);
      const overlapHeight = Math.min(cell.y + cell.height, other.y + other.height) - Math.max(cell.y, other.y);
      assert.ok(overlapWidth <= 1e-8 || overlapHeight <= 1e-8);
    }
  }
});

test("treemap is deterministic, keeps item identity, and scales areas by explicit value", () => {
  const items = [{ name: "a", value: 2 }, { name: "b", value: 1 }, { name: "c", value: 1 }];
  const copy = structuredClone(items);
  const first = Pulse.treemap(items, 100, 100);
  assert.deepEqual(first, Pulse.treemap(items, 100, 100));
  assert.deepEqual(items, copy);
  assert.equal(first[0].item, items[0]);
  assert.deepEqual(first.map((cell) => cell.item.name), ["a", "b", "c"]);
  assert.deepEqual(first.map((cell) => cell.width * cell.height), [5000, 2500, 2500]);
});

test("treemap rejects invalid surfaces and nonpositive weights without NaN coordinates", () => {
  assert.deepEqual(Pulse.treemap([], 100, 100), []);
  for (const [width, height] of [[0, 100], [100, -1], [NaN, 100], [100, Infinity]]) {
    assert.deepEqual(Pulse.treemap([{ value: 1 }], width, height), []);
  }
  const cells = Pulse.treemap([{ value: 0 }, { value: null }, { value: -1 }, { value: Infinity }, { value: 2 }], 0.1, 0.2);
  assert.equal(cells.length, 1);
  assert.deepEqual([cells[0].x, cells[0].y, cells[0].width, cells[0].height], [0, 0, 0.1, 0.2]);
});

test("pod inventory excludes orphan telemetry and unassigned pods", () => {
  const rows = Pulse.joinPods({
    pod_info: metric(series("default", "live", 1, { node: "primary" }), series("default", "pending", 1, { node: "" })),
    pod_mem_usage: metric(series("default", "live", 100), series("default", "retired", 200)),
    pod_mem_request: metric(series("default", "live", 200)),
    pod_restarts_24h: metric(series("default", "live", 0)),
    pod_phase: metric(series("default", "live", 1, { phase: "Running" })),
  });
  assert.deepEqual(rows, [{ key: "default|live", name: "live", namespace: "default", node: "primary", request: 200, usage: 100, ratio: 0.5, restarts: 0, phase: "Running" }]);
  assert.deepEqual(Pulse.joinPods({ pod_mem_usage: metric(series("default", "retired", 200)) }), []);
});

test("pod joins use namespace and never add duplicate exporter observations", () => {
  const rows = Pulse.joinPods({
    pod_info: metric(series("one", "app", 1, { node: "primary" }), series("two", "app", 1, { node: "utility" }), series("one", "app", 1, { node: "primary" })),
    pod_mem_request: metric(series("one", "app", 100), series("one", "app", 100), series("two", "app", 200)),
    pod_mem_usage: metric(series("one", "app", 25), series("one", "app", 25), series("two", "app", 50)),
    pod_restarts_24h: metric(series("one", "app", 1), series("one", "app", 1)),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].request, 100);
  assert.equal(rows[0].usage, 25);
  assert.equal(rows[0].restarts, 1);
  assert.equal(rows[1].request, 200);
  assert.equal(rows[1].usage, 50);
});

test("pod joins preserve real zero and missing usage, request, restart and phase data", () => {
  const rows = Pulse.joinPods({
    pod_info: metric(series("default", "zero", 1, { node: "primary" }), series("default", "unknown", 1, { node: "primary" })),
    pod_mem_request: metric(series("default", "zero", 0)),
    pod_mem_usage: metric(series("default", "zero", 0)),
    pod_restarts_24h: metric(series("default", "zero", 0)),
    pod_phase: metric(series("default", "unknown", 0, { phase: "Running" })),
  });
  assert.equal(rows[0].request, 0);
  assert.equal(rows[0].usage, 0);
  assert.equal(rows[0].restarts, 0);
  assert.equal(rows[0].ratio, null);
  assert.equal(rows[1].request, null);
  assert.equal(rows[1].usage, null);
  assert.equal(rows[1].ratio, null);
  assert.equal(rows[1].restarts, null);
  assert.equal(rows[1].phase, "unknown");
});

test("degraded pod metrics and invalid negative observations never appear live", () => {
  const [row] = Pulse.joinPods({
    pod_info: metric(series("default", "app", 1, { node: "primary" })),
    pod_mem_request: metric(series("default", "app", -1)),
    pod_mem_usage: { state: "degraded", series: [series("default", "app", 80)] },
    pod_restarts_24h: metric(series("default", "app", NaN)),
    pod_phase: { state: "degraded", series: [series("default", "app", 1, { phase: "Running" })] },
  });
  assert.equal(row.request, null);
  assert.equal(row.usage, null);
  assert.equal(row.restarts, null);
  assert.equal(row.phase, "unknown");
});

test("placement namespaces expose buttons while every pod exposes a focusable reading", () => {
  const svg = Pulse.placementSvg([pod("one"), pod("two")], 400, 200);
  assert.match(svg, /role="group" aria-label="Pod placement by namespace"/);
  assert.match(svg, /class="placement-namespace-label" role="button" tabindex="0" data-namespace="default" aria-expanded="true"/);
  assert.equal((svg.match(/role="img" tabindex="0" data-pod-key=/g) || []).length, 2);
  assert.match(svg, /request 64\u00a0Mi; usage 32\u00a0Mi; usage\/request 0.5; 0 restarts; phase Running/);
  assert.match(svg, /placement-label-backplate/);
});

test("placement shows unknown phases as checkerboard and unknown usage as hollow", () => {
  const unknown = Pulse.placementSvg([pod("completed-or-unknown", { phase: "unknown" })], 160, 100);
  assert.match(unknown, /class="placement-pod is-not-running"/);
  assert.match(unknown, /fill="url\(#pulse-placement-\d+-check\)"/);
  const hollow = Pulse.placementSvg([pod("unmeasured", { usage: null, ratio: null })], 160, 100);
  assert.match(hollow, /class="placement-pod-rect"[^>]*fill="none"/);
  assert.match(hollow, /usage\/request unavailable/);
});

test("placement marks overload and restarts but flashes only requested pod keys", () => {
  const svg = Pulse.placementSvg([pod("hot", { ratio: 1.2, restarts: 2 }), pod("steady")], 400, 200, { flashing: new Set(["default|hot"]) });
  assert.equal((svg.match(/class="placement-overload"/g) || []).length, 1);
  assert.equal((svg.match(/class="placement-restart"/g) || []).length, 1);
  assert.equal((svg.match(/class="placement-pod is-flashing"/g) || []).length, 1);
  assert.doesNotMatch(Pulse.placementSvg([pod("hot", { restarts: 2 })], 200, 100), /is-flashing/);
});

test("collapsed namespaces keep their accessible header and omit child readings", () => {
  const pods = [pod("one"), pod("two"), pod("other", { namespace: "system", key: "system|other" })];
  const svg = Pulse.placementSvg(pods, 400, 200, { collapsed: new Set(["default"]) });
  assert.match(svg, /class="placement-namespace is-collapsed"/);
  assert.match(svg, /data-namespace="default" aria-expanded="false"/);
  assert.match(svg, /aria-label="Expand default · 2 pods"/);
  assert.doesNotMatch(svg, /data-pod-key="default\|/);
  assert.match(svg, /data-pod-key="system\|other"/);
});

test("placement escapes metadata and generates unique IDs independently of pod names", () => {
  const model = pod('name"><script>x</script>', { namespace: 'ns" onclick="x', key: 'ns|pod" onfocus="x' });
  const first = Pulse.placementSvg([model], 200, 100);
  const second = Pulse.placementSvg([model], 200, 100);
  assert.doesNotMatch(first, /<script>| onclick="| onfocus="/);
  assert.match(first, /data-pod-key="ns\|pod&quot; onfocus=&quot;x"/);
  const firstId = first.match(/<pattern id="([^"]+)-ink-1"/)[1];
  const secondId = second.match(/<pattern id="([^"]+)-ink-1"/)[1];
  assert.notEqual(firstId, secondId);
  assert.ok(first.includes(`fill="url(#${firstId}-ink-3)"`));
  assert.ok(!first.includes(secondId));
});

test("placement floors absent requests to visible cells and truncates long labels", () => {
  const svg = Pulse.placementSvg([pod("a".repeat(100), { request: null, ratio: null }), pod("zero-request", { request: 0, ratio: null })], 220, 120);
  assert.equal((svg.match(/data-pod-key=/g) || []).length, 2);
  assert.match(svg, /class="placement-pod-name"[^>]*>a+…<\/text>/);
  assert.doesNotMatch(svg, /(?:width|height)="(?:-|NaN|Infinity)/);
  assert.equal(Pulse.placementSvg([], 0, 100), "");
});

test("skewed namespaces retain every pod when their headers have little room", () => {
  for (const skew of [128, 1000]) {
    const pods = Array.from({ length: 100 }, (_, index) => {
      const namespace = "namespace-" + Math.floor(index / 10);
      return pod("pod-" + index, { namespace, key: namespace + "|pod-" + index, request: 32 * 1024 ** 2 * (index < 10 ? skew : 1) });
    });
    for (const [width, height] of [[320, 180], [700, 280]]) {
      const svg = Pulse.placementSvg(pods, width, height);
      assert.equal((svg.match(/data-pod-key=/g) || []).length, 100);
      assert.equal((svg.match(/class="placement-namespace-label"/g) || []).length, 10);
      assert.doesNotMatch(svg, /(?:width|height)="(?:-|NaN|Infinity)/);
    }
  }
});
