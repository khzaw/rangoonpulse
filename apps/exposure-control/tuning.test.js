const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

// Synthetic fixtures only: raw advice deliberately differs from the apply plan.
function workload(overrides = {}) {
  return {
    namespace: 'apps', workload: 'reader', release: 'reader', container: 'main',
    action: 'upsize', notes: [], cpu_p95_m: 0, mem_p95_mi: 100,
    restarts_window: 8, current_restarts: 0, matched_pods: 1, replicas: 1,
    current: { requests: { cpu: '100m', memory: '256Mi' }, limits: { cpu: '1', memory: '1Gi' } },
    recommended: { requests: { cpu: '75m', memory: '320Mi' }, limits: { cpu: '750m', memory: '1280Mi' } },
    ...overrides,
  };
}
function snapshot(rows = [workload()]) {
  return {
    fetch: { state: 'live', lastFetchOk: true, lastRunAt: '2026-09-29T18:30:00Z' },
    report: { recommendations: rows, metricsWindow: '14d', metricsCoverageDaysEstimate: 14.5,
      summary: { containers_analyzed: rows.length, containers_with_metrics: rows.length,
        total_current_requests_cpu_m: 100, total_recommended_requests_cpu_m: 75 } },
    applyPreflight: { builtAt: '2026-09-30T01:00:00Z', selectedCount: 1,
      selected: [{ ...rows[0], selection_reason: 'upsize_with_node_fit_under_advisory_pressure',
        recommended: { requests: { cpu: '100m', memory: '320Mi' }, limits: { cpu: '1', memory: '1280Mi' } } }],
      skipped: [], hardFitOk: true, advisoryPressure: { cpu: true, memory: false },
      nodeFit: { hard_fit_ok: true, nodes: [{ name: 'node-1',
        allocatable: { cpu_m: 8000, memory_mi: 32000 }, advisory_budget: { cpu_m: 4800, memory_mi: 20800 },
        current_requests: { cpu_m: 6000, memory_mi: 20000 }, projected_requests: { cpu_m: 6000, memory_mi: 20064 } }] },
      currentRequests: { cpu_m: 6000, memory_mi: 20000 },
      projectedRequestsAfterSelected: { cpu_m: 6000, memory_mi: 20064 } },
    schedule: { nextRunAt: '2026-10-04T19:30:00Z', timeZone: 'Asia/Singapore', schedule: '30 3 * * 1' },
  };
}
function api() {
  const file = __dirname + '/tuning.js';
  const context = { module: { exports: {} }, URL, Intl, console };
  vm.runInNewContext(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', context);
  return context.module.exports;
}

test('the ledger uses adjusted selected resources and whole-cluster preview totals, not raw advice', () => {
  const tuning = api();
  assert.equal(typeof tuning.buildModel, 'function', 'the tuning model must exist');
  const model = tuning.buildModel(snapshot());
  assert.equal(model.previewAvailable, true);
  assert.equal(model.counts.selected, 1);
  assert.equal(model.rows[0].current.requests.cpu, '100m');
  assert.equal(model.rows[0].recommended.requests.cpu, '100m');
  assert.equal(model.rows[0].recommended.limits.cpu, '1');
  assert.equal(model.rows[0].report.recommended.requests.cpu, '75m');
  assert.equal(model.cpuDelta, 0);
  assert.equal(model.memoryDelta, 64);
  const data = snapshot();
  data.report.recommendations[0].current = { requests: { cpu: '20m', memory: '128Mi' } };
  assert.equal(tuning.buildModel(data).rows[0].current.requests.cpu, '100m', 'current quantities also come from selected preflight');
});

test('all discovered containers remain inspectable, with no-change and waiting classified before skip reasons', () => {
  const tuning = api();
  const rows = [workload(), workload({ workload: 'quiet', release: 'quiet', action: 'no-change' }),
    workload({ workload: 'new', release: 'new', action: 'no-change', cpu_p95_m: null, notes: ['awaiting_metrics'] }),
    workload({ workload: 'small', release: 'small', action: 'downsize', notes: ['restart_guard'] })];
  const data = snapshot(rows);
  data.applyPreflight.skipped = rows.slice(1).map((row) => ({ release: row.release, container: row.container, reason: 'not_allowlisted' }));
  const model = tuning.buildModel(data);
  assert.deepEqual(JSON.parse(JSON.stringify(model.counts)), { selected: 1, deferred: 2, unchanged: 1, all: 4 });
  assert.equal(model.rows[1].status, 'No change');
  assert.equal(model.rows[2].status, 'Awaiting metrics');
  assert.match(model.rows[3].reason, /manual review/i);
  assert.equal(tuning.filterRows(model, { view: 'all' }).length, 4);
  assert.equal(tuning.filterRows(model, { view: 'selected' }).length, 1);
  assert.equal(tuning.filterRows(model, { view: 'deferred' }).length, 2);
  assert.equal(tuning.filterRows(model, { view: 'unchanged' }).length, 1);
  assert.equal(tuning.filterRows(model, { view: 'all', action: 'downsize', note: 'restart_guard', query: 'small' }).length, 1);
  assert.equal(tuning.filterRows(model, { view: 'all', query: 'absent' }).length, 0);
});

test('no-change explains the report threshold without claiming raw requests and limits are identical', () => {
  const tuning = api();
  const data = snapshot([workload({ action: 'no-change',
    current: { requests: { cpu: '100m', memory: '192Mi' }, limits: { cpu: '1', memory: '384Mi' } },
    recommended: { requests: { cpu: '100m', memory: '185Mi' }, limits: { cpu: '1', memory: '370Mi' } } })]);
  data.applyPreflight.selected = [];
  data.applyPreflight.selectedCount = 0;
  const model = tuning.buildModel(data);
  const row = model.rows[0];
  assert.equal(row.action, 'no-change');
  assert.equal(row.category, 'unchanged');
  assert.equal(row.status, 'No change');
  assert.equal(row.limitsChanged, true);
  assert.equal(row.reason, 'Below the report’s change threshold; advice may still differ.');
  const html = tuning.renderRow(row, model);
  assert.match(html, /192Mi[\s\S]*185Mi/);
  assert.match(html, /384Mi[\s\S]*370Mi/);
  assert.doesNotMatch(html, /keeping current resources/);
});

test('partial skip identities never spread reasons across workloads or namespaces', () => {
  const tuning = api();
  const rows = [workload(), workload({ workload: 'reader-worker' }), workload({ namespace: 'other' })];
  const data = snapshot(rows);
  data.applyPreflight.skipped = [{ release: 'reader', container: 'main', reason: 'node_capacity_block' }];
  const model = tuning.buildModel(data);
  assert.equal(model.counts.selected, 1);
  assert.equal(model.rows[1].status, 'Deferred');
  assert.equal(model.rows[1].reason, 'Not selected in this preview; no unambiguous reason reported.');
  assert.equal(model.rows[2].reason, model.rows[1].reason);
  data.applyPreflight.skipped[0].namespace = 'other';
  const precise = tuning.buildModel(data);
  assert.match(precise.rows[2].reason, /node capacity/i);
  assert.doesNotMatch(precise.rows[1].reason, /node capacity/i);
});

test('limit-only growth is proposed even when requests are steady', () => {
  const tuning = api();
  const data = snapshot();
  data.applyPreflight.selected[0].recommended.requests.memory = '256Mi';
  const row = tuning.buildModel(data).rows[0];
  assert.equal(row.limitOnly, true);
  assert.equal(row.limitsChanged, true);
  assert.equal(row.action, 'upsize');
  assert.equal(row.category, 'selected');
});

test('missing evidence does not turn into a zero-change or safe preview', () => {
  const tuning = api();
  for (const mutate of [d => delete d.applyPreflight, d => d.applyPreflight.builtAt = 'invalid',
    d => d.fetch.state = 'degraded', d => d.fetch.lastFetchOk = false,
    d => d.applyPreflight.selectedCount = 20, d => delete d.report,
    d => delete d.applyPreflight.selected[0].namespace,
    d => delete d.applyPreflight.nodeFit, d => d.applyPreflight.nodeFit = {},
    d => delete d.applyPreflight.nodeFit.hard_fit_ok, d => delete d.applyPreflight.nodeFit.nodes,
    d => delete d.applyPreflight.currentRequests, d => d.applyPreflight.currentRequests.memory_mi = null,
    d => d.applyPreflight.projectedRequestsAfterSelected = {},
    d => d.applyPreflight.projectedRequestsAfterSelected.cpu_m = '6000']) {
    const data = snapshot(); mutate(data);
    const model = tuning.buildModel(data);
    assert.equal(model.previewAvailable, false);
    assert.equal(model.counts.selected, 0);
    assert.equal(model.cpuDelta, null);
  }
  const data = snapshot();
  delete data.applyPreflight.currentRequests;
  assert.equal(tuning.buildModel(data).cpuDelta, null);
  assert.equal(tuning.buildModel(null).rows.length, 0);
});

test('the exporter failed-plan fallback is unavailable despite a healthy fetch and fresh timestamp', () => {
  const tuning = api();
  const data = snapshot();
  // Exact applyPreflight shape from exporter.build_ui_payload after build_apply_plan throws.
  data.applyPreflight = { builtAt: '2026-09-30T01:00:00Z', selectedCount: 0, selected: [], nextUp: [],
    skipped: [], skipSummary: [], selectedReasonCounts: {}, skippedReasonCounts: {},
    advisoryPressure: { cpu: false, memory: false }, nodeFit: {}, hardFitOk: false,
    budgets: {}, currentRequests: {}, projectedRequestsAfterSelected: {} };
  const model = tuning.buildModel(data);
  assert.equal(model.previewAvailable, false);
  assert.equal(model.cpuDelta, null);
  assert.equal(model.memoryDelta, null);
  assert.match(model.rows[0].reason, /Preview unavailable/);
  const h = viewHarness();
  tuning.createView(h.root).render(data);
  assert.match(h.ids.tuningSummary.innerHTML, /Preview unavailable/);
  assert.match(h.ids.tuningSummary.innerHTML, /Hard node fit[\s\S]*Unknown/);
  assert.match(h.ids.tuningSummary.innerHTML, /CPU unknown · memory unknown/);
  assert.doesNotMatch(h.ids.tuningSummary.innerHTML, /would be proposed|Blocked|within ceiling|Passes/);
  assert.match(h.ids.tuningEmpty.textContent, /Preview unavailable/);
  assert.match(h.ids.tuningDiagnostics.innerHTML, /Live node-fit evidence unavailable/);
});

test('successful empty-selection plans still show a zero-change preview, including zero request totals', () => {
  const tuning = api();
  for (const totals of [{ cpu_m: 6000, memory_mi: 20000 }, { cpu_m: 0, memory_mi: 0 }]) {
    const data = snapshot();
    data.applyPreflight.selected = [];
    data.applyPreflight.selectedCount = 0;
    data.applyPreflight.currentRequests = totals;
    data.applyPreflight.projectedRequestsAfterSelected = totals;
    data.applyPreflight.nodeFit.nodes[0].current_requests = totals;
    data.applyPreflight.nodeFit.nodes[0].projected_requests = totals;
    const model = tuning.buildModel(data);
    assert.equal(model.previewAvailable, true);
    assert.equal(model.counts.selected, 0);
    assert.equal(model.cpuDelta, 0);
    assert.equal(model.memoryDelta, 0);
    const html = tuning.renderSummary(model);
    assert.match(html, /0 changes would be proposed/);
    assert.match(html, /Passes/);
    assert.doesNotMatch(html, /Preview unavailable/);
  }
});

test('a loose date-like token is not a valid preflight timestamp', () => {
  const tuning = api();
  for (const token of ['0', '1', 'September 30, 2026', '', null]) {
    const data = snapshot(); data.applyPreflight.builtAt = token;
    assert.equal(tuning.buildModel(data).previewAvailable, false, String(token));
  }
});

test('advice-only limits never read as queued changes and unmeasured proposals do not claim steady resources', () => {
  const tuning = api();
  const data = snapshot(); data.applyPreflight.selected = []; data.applyPreflight.selectedCount = 0;
  let model = tuning.buildModel(data);
  assert.match(tuning.renderRow(model.rows[0], model), /Limits differ in report advice/);
  const missing = snapshot(); missing.applyPreflight.selected[0].current = {}; missing.applyPreflight.selected[0].recommended = {};
  model = tuning.buildModel(missing);
  assert.equal(model.rows[0].action, 'unknown');
});

test('duplicate full identities do not attach one selected proposal twice, and absent report entries remain visible', () => {
  const tuning = api();
  const data = snapshot([workload(), workload()]);
  const model = tuning.buildModel(data);
  assert.equal(model.counts.selected, 1);
  assert.equal(model.counts.all, 3);
  assert.equal(new Set(model.rows.map(row => row.key)).size, 3);
  assert.equal(model.rows.filter(row => row.proposal).length, 1);
  data.report.recommendations = [];
  assert.equal(tuning.buildModel(data).counts.selected, 1);
});

test('the decision summary separates reservations, node fit, pressure, schedule, and actual PR execution', () => {
  const tuning = api();
  assert.equal(typeof tuning.renderSummary, 'function');
  const data = snapshot();
  data.lastApply = { runAt: '2026-09-27T19:30:00Z', status: 'created_or_updated', prCount: 1,
    execution: { pull_requests: [{ release: 'reader', status: 'created', pr_url: 'https://github.com/example/cluster/pull/42' }] } };
  const html = tuning.renderSummary(tuning.buildModel(data));
  assert.match(html, /1 change would be proposed/);
  assert.match(html, /\+64 Mi/);
  assert.match(html, /reservations, not usage savings/);
  assert.match(html, /Hard node fit/);
  assert.match(html, /Passes/);
  assert.match(html, /Advisory pressure/);
  assert.match(html, /not a blocking gate/);
  assert.match(html, /Asia\/Singapore/);
  assert.match(html, /Oct 5, 2026/);
  assert.match(html, /03:30/);
  assert.match(html, /Sep 28, 2026, 03:30/);
  assert.match(html, /Sep 30, 2026, 02:30/);
  assert.doesNotMatch(html, /UTC/, 'use one schedule timezone for every timestamp');
  assert.match(html, /PRs created or updated/);
  assert.match(html, /href="https:\/\/github.com\/example\/cluster\/pull\/42"/);
  assert.match(html, /not confirm merge or deployment/);
  assert.doesNotMatch(html, /75m|savings of/);
});

test('rendered evidence distinguishes zero from absent metrics and history from current restarts', () => {
  const tuning = api();
  assert.equal(typeof tuning.renderRow, 'function');
  const data = snapshot();
  const html = tuning.renderRow(tuning.buildModel(data).rows[0], tuning.buildModel(data));
  assert.match(html, /Observed CPU p95/);
  assert.match(html, /0 m/);
  assert.match(html, /Historical restarts/);
  assert.match(html, /8 · 14d/);
  assert.match(html, /Current live restarts/);
  assert.match(html, /0 · 1 matched pod/);
  assert.match(html, /Apply preflight/);
  assert.match(html, /100m/);
  assert.doesNotMatch(html, /750m|75m/);
  delete data.report.recommendations[0].cpu_p95_m;
  delete data.report.recommendations[0].current_restarts;
  const missing = tuning.renderRow(tuning.buildModel(data).rows[0], tuning.buildModel(data));
  assert.match(missing, /Not reported/);
  assert.doesNotMatch(missing, /0 · 1 matched pod/);
  data.applyPreflight.selected[0].recommended.requests.memory = '256Mi';
  assert.match(tuning.renderRow(tuning.buildModel(data).rows[0], tuning.buildModel(data)), /Limits only/);
});

test('unavailable and unknown states never acquire a passing status', () => {
  const tuning = api();
  assert.equal(typeof tuning.renderSummary, 'function');
  const data = snapshot();
  delete data.applyPreflight.hardFitOk;
  data.lastApply = { runAt: '2026-09-27T19:30:00Z', status: 'new_backend_result' };
  let html = tuning.renderSummary(tuning.buildModel(data));
  assert.match(html, /Hard node fit[\s\S]*Unknown/);
  assert.match(html, /Recorded result: new backend result/);
  assert.doesNotMatch(html, /Passes/);
  data.applyPreflight.builtAt = 'bad';
  data.lastApply.runAt = 'bad';
  html = tuning.renderSummary(tuning.buildModel(data));
  assert.match(html, /Preview unavailable/);
  assert.match(html, /No recorded execution/);
  assert.doesNotMatch(html, /would be proposed|Passes|new backend result/);
});

test('API strings are escaped in every rendered surface and unsafe PR URLs are not links', () => {
  const tuning = api();
  assert.equal(typeof tuning.renderDiagnostics, 'function');
  const attack = '<img src=x onerror="alert(1)">';
  const row = workload({ workload: attack, notes: [attack], current: { requests: { cpu: attack, memory: '1Gi' } } });
  const data = snapshot([row]);
  data.applyPreflight.selected[0].selection_reason = attack;
  data.fetch.detail = attack;
  data.report.policy = { [attack]: attack };
  data.runtime = { latestMarkdown: attack };
  data.lastApply = { runAt: '2026-09-27T19:30:00Z', status: attack, execution: { pull_requests:
    ['javascript:alert(1)', 'data:text/html,bad', 'https://github.com.evil.test/a/b/pull/1', 'https://evil.test/a/b', 'https://user:pass@github.com/a/b/pull/1']
      .map(pr_url => ({ pr_url, release: attack, status: attack })) } };
  const model = tuning.buildModel(data);
  const html = tuning.renderSummary(model) + tuning.renderRow(model.rows[0], model) + tuning.renderDiagnostics(model);
  assert.doesNotMatch(html, /<img|href="(?:javascript|data):|href="https:\/\/(?:evil|github\.com\.evil|user:pass)/);
  assert.match(html, /&lt;img/);
  data.applyPreflight.selected[0].selection_reason = '__proto__';
  assert.equal(typeof tuning.buildModel(data).rows[0].reason, 'string');
});

function viewHarness() {
  const document = { activeElement: null };
  const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  function element(dataset = {}) {
    return { dataset, value: 'all', textContent: '', hidden: false, innerHTML: '', listeners: {}, attrs: {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      setAttribute(key, value) { this.attrs[key] = value; },
      focus() { document.activeElement = this; },
      fire(event) { this.listeners[event]?.({ target: this }); },
    };
  }
  const ids = Object.fromEntries(['tuningSummary', 'tuningRows', 'tuningCount', 'tuningEmpty', 'noteFilter', 'tuningAction',
    'searchInput', 'tuningDiagnostics', 'tuningRawReport', 'tuningRawExecution'].map(id => [id, element()]));
  ids.searchInput.value = '';
  let rows = [], markup = '';
  Object.defineProperty(ids.tuningRows, 'innerHTML', {
    get: () => markup,
    set(value) {
      markup = value;
      rows = [...value.matchAll(/<details class="tuning-row" data-tuning-key="([^"]+)"( open)?>/g)].map(match => {
        const row = element({ tuningKey: decode(match[1]) });
        row.open = Boolean(match[2]);
        row.summary = element();
        row.contains = value => value === row.summary;
        row.querySelector = () => row.summary;
        return row;
      });
    },
  });
  ids.tuningRows.querySelectorAll = () => rows;
  const buttons = ['selected', 'deferred', 'unchanged', 'all'].map(view => element({ tuningView: view }));
  const root = { ownerDocument: document, querySelector: id => ids[id.slice(1)], querySelectorAll: () => buttons };
  return { root, ids, buttons, rows: () => rows, document };
}

test('filter and row-detail state survives refresh, empty/error responses, and recovery without stale rows', () => {
  const tuning = api();
  assert.equal(typeof tuning.createView, 'function');
  const h = viewHarness();
  const view = tuning.createView(h.root);
  const data = snapshot([workload({ notes: ['restart_guard'] }), workload({ release: 'quiet', workload: 'quiet', action: 'no-change' })]);
  view.render(data);
  assert.equal(h.rows().length, 1, 'default shows proposed changes');
  assert.equal(h.buttons[0].attrs['aria-pressed'], 'true');
  h.rows()[0].open = true;
  h.rows()[0].summary.focus();
  view.render(data);
  assert.equal(h.rows()[0].open, true);
  assert.equal(h.document.activeElement, h.rows()[0].summary);
  h.buttons[3].fire('click');
  assert.equal(h.rows().length, 2);
  h.ids.searchInput.value = 'reader'; h.ids.searchInput.fire('input');
  h.ids.noteFilter.value = 'restart_guard'; h.ids.noteFilter.fire('change');
  h.ids.tuningAction.value = 'upsize'; h.ids.tuningAction.fire('change');
  view.render(null);
  assert.equal(h.rows().length, 0);
  assert.equal(h.ids.tuningEmpty.hidden, false);
  assert.match(h.ids.tuningEmpty.textContent, /unavailable/i);
  assert.equal(h.ids.noteFilter.value, 'restart_guard');
  assert.equal(h.ids.searchInput.value, 'reader');
  assert.equal(h.buttons[3].attrs['aria-pressed'], 'true');
  const empty = snapshot([]); empty.applyPreflight.selected = []; empty.applyPreflight.selectedCount = 0;
  view.render(empty);
  assert.equal(h.rows().length, 0);
  view.render(data);
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].open, true);
  assert.equal(h.ids.tuningAction.value, 'upsize');
  assert.match(h.ids.noteFilter.innerHTML, /restart_guard/);
});

test('an empty proposed view points to other workloads without resetting filters', () => {
  const tuning = api();
  assert.equal(typeof tuning.createView, 'function');
  const h = viewHarness();
  const data = snapshot(); data.applyPreflight.selected = []; data.applyPreflight.selectedCount = 0;
  tuning.createView(h.root).render(data);
  assert.equal(h.rows().length, 0);
  assert.match(h.ids.tuningEmpty.textContent, /Deferred.*All workloads/);
});

test('dashboard refresh clears failed tuning even when an unrelated service API fails', async () => {
  const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const functionSource = source.slice(source.indexOf('      async function loadDashboard('), source.indexOf('      refreshAllBtn.onclick'));
  const seen = [];
  const context = { activePage: 'tuning', dashboardState: { tuning: snapshot() },
    request: async () => { throw new Error('offline'); }, renderPlanner: value => seen.push(value), setLoadState() {} };
  vm.createContext(context);
  vm.runInContext(functionSource, context);
  await context.loadDashboard({ silent: true });
  assert.deepEqual(seen, [null]);
  assert.equal(context.dashboardState.tuning, null);
});

test('the delivered page uses named pressed filters, progressive diagnostics, responsive rows, and versioned mounted assets', () => {
  const read = file => fs.readFileSync(__dirname + '/' + file, 'utf8');
  const html = read('index.html');
  const section = html.slice(html.indexOf('<section id="tuning"'), html.indexOf('<section id="jobs"'));
  assert.match(section, /data-tuning-view="selected"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(section, /role="tablist"|plannerGrid|tuningFocusGrid|<table/);
  assert.match(section, /aria-label="Search tuning workloads"/);
  assert.match(section, /<details[^>]*>[\s\S]*Capacity and policy/);
  assert.match(section, /api\/tuning\/latest.json/);
  assert.match(section, /api\/tuning\/latest.md/);
  assert.match(section, /api\/tuning\/metrics/);
  assert.ok(html.indexOf('/assets/tuning.js') < html.indexOf('/assets/app.js'));
  assert.match(read('server.js'), /"\/assets\/tuning.js"/);
  assert.match(read('server.js'), /tuning\\.js\|/);
  assert.match(read('kustomization.yaml'), /- tuning.js/);
  assert.match(read('helmrelease.yaml'), /path: \/app-files\s+readOnly: true/);
  assert.match(fs.readFileSync(__dirname + '/../../package.json', 'utf8'), /node --check apps\/exposure-control\/tuning.js/);
  assert.match(read('styles.css'), /@container tuning/);
  assert.match(read('styles.css'), /\.tuning-row:not\(\[open\]\) > \.tuning-row-detail/);
  assert.ok(/\.tuning-identity \{ grid-column: 1 \/ -1; grid-row: 1;/.test(read('styles.css')), 'mobile identity is explicitly in the first row, beside the disclosure control');
});
