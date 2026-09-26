const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const appSource = readFileSync(require.resolve('./app.js'), 'utf8');
function functionsBetween(start, end) {
  return appSource.slice(appSource.indexOf(start), appSource.indexOf(end));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function fakeClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(delay) {
      const target = now + delay;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = target;
    },
    get pending() { return timers.size; },
  };
}

function node(dataset = {}) {
  const classes = new Set();
  return {
    dataset, textContent: '', hidden: true, disabled: false,
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    style: { removeProperty() {} },
  };
}

function harness(fetch) {
  const clock = fakeClock();
  const document = { body: node(), activeElement: null };
  document.activeElement = document.body;
  let cards = [];
  let html = '';
  const list = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      cards = [...value.matchAll(/<article[^>]+data-site-id="([^"]+)"/g)].map((match) => {
        const card = node({ siteId: match[1] });
        card.button = node({ siteDeployRun: match[1] });
        card.button.focus = () => { document.activeElement = card.button; };
        card.progress = node();
        card.querySelector = (selector) => selector === '.deploy-progress' ? card.progress : card.button;
        return card;
      });
    },
    querySelectorAll() { return cards; },
    querySelector(selector) {
      const siteId = selector.match(/data-site-deploy-run="([^"]+)"/)?.[1];
      const button = cards.find((card) => card.dataset.siteId === siteId)?.button;
      return button && (!selector.includes(':not(:disabled)') || !button.disabled) ? button : null;
    },
  };
  const context = {
    window: clock, document, fetch,
    CSS: { escape: (value) => value },
    activePage: 'deploy',
    activitySequence: 0,
    requestActivities: new Map(),
    siteDeployOperations: new Map(),
    controlActivityEl: node(), controlActivityLabelEl: node(),
    controlActivityOrb: { paused: true, setPaused(paused) { this.paused = paused; }, setState(state) { this.state = state; } },
    siteDeployAllBtn: node(), siteDeployRefreshBtn: node(), siteDeployMsgEl: node(),
    siteDeploySummaryEl: node(), siteDeployOverviewStripEl: node(), siteDeployListEl: list,
    dashboardState: {},
    overviewSegment: () => '',
    fmtTime: (value) => value || 'n/a', fmtDateTime: (value) => value || 'n/a',
    setBtnLoading(button, on) { button.disabled = on; },
    setSiteDeployMsg(message, error) { context.siteDeployMsgEl.textContent = message; context.siteDeployMsgEl.error = Boolean(error); },
  };
  vm.createContext(context);
  vm.runInContext([
    functionsBetween('      function describeRequestActivity(', '      function withUnitSpace('),
    functionsBetween('      function escapeHtml(', '      function normalizeMatchToken('),
    functionsBetween('      function conditionLabel(', '      async function saveJobConfig('),
  ].join('\n'), context);
  return { context, clock, cards: () => cards };
}

const ok = (data = {}) => ({ ok: true, json: async () => data });
const targets = { items: [{ id: 'blog', title: 'Blog', ready: true }, { id: 'docs', title: 'Docs', ready: true }] };

test('quick requests never reveal the orb and clear their delayed callbacks', async () => {
  const pending = deferred();
  const { context, clock } = harness(() => pending.promise);
  const response = context.request('/api/services', 'GET');
  clock.advance(1999);
  assert.equal(context.controlActivityEl.hidden, true);
  pending.resolve(ok());
  await response;
  clock.advance(5000);
  assert.equal(context.controlActivityEl.hidden, true);
  assert.equal(context.controlActivityOrb.paused, true);
  assert.equal(context.requestActivities.size, 0);
  assert.equal(clock.pending, 0);
});

test('each request waits two seconds, mutations take priority, and errors release the orb', async () => {
  const reads = [deferred(), deferred()];
  const mutation = deferred();
  const { context, clock } = harness((path) => path.endsWith('/run') ? mutation.promise : reads.shift().promise);
  const firstRead = reads[0];
  const secondRead = reads[1];
  const background = context.request('/api/services', 'GET');
  clock.advance(2000);
  assert.equal(context.controlActivityEl.hidden, false);
  assert.equal(context.controlActivityOrb.state, 'working');

  const deployment = context.request('/api/site-deployments/blog/run', 'POST', {});
  assert.equal(context.controlActivityEl.hidden, true, 'a young mutation suppresses background activity until its own delay');
  clock.advance(2000);
  assert.equal(context.controlActivityLabelEl.textContent, 'Reconciling deployment');
  assert.equal(context.controlActivityOrb.state, 'working');
  const moreBackground = context.request('/api/image-updates', 'GET');
  clock.advance(2000);
  assert.equal(context.controlActivityLabelEl.textContent, 'Reconciling deployment');
  mutation.reject(new Error('network failed'));
  await assert.rejects(deployment, /network failed/);
  assert.equal(context.controlActivityLabelEl.textContent, 'Loading update report');
  firstRead.resolve(ok());
  secondRead.resolve(ok());
  await Promise.all([background, moreBackground]);
  assert.equal(context.controlActivityEl.hidden, true);
  assert.equal(context.controlActivityOrb.paused, true);
  assert.equal(clock.pending, 0);
});

test('a selected deployment keeps its delayed beam and disabled control across refreshed cards', () => {
  const { context, clock, cards } = harness();
  context.renderSiteDeployments(targets);
  const operation = context.beginSiteDeployment('blog');
  assert.ok(operation);
  assert.equal(context.beginSiteDeployment('blog'), null);
  assert.equal(context.beginSiteDeployment('*'), null);
  assert.equal(cards()[0].button.disabled, true);
  assert.equal(cards()[1].button.disabled, false);
  clock.advance(2999);
  assert.equal(cards()[0].classList.contains('is-beaming'), false);
  const oldCard = cards()[0];
  context.renderSiteDeployments(targets);
  assert.notEqual(cards()[0], oldCard);
  assert.equal(cards()[0].button.disabled, true);
  clock.advance(1);
  assert.equal(cards()[0].classList.contains('is-beaming'), true);
  assert.equal(cards()[1].classList.contains('is-beaming'), false);
  context.finishSiteDeployment(operation, false, '5/5 controllers acknowledged');
  assert.equal(cards()[0].classList.contains('is-beaming'), false);
  assert.equal(cards()[0].classList.contains('is-deploying'), false);
  assert.equal(cards()[0].button.disabled, false);
  assert.equal(cards()[0].progress.textContent, 'Reconcile requested');
  assert.equal(context.siteDeployAllBtn.disabled, false);
});

test('deploy all uses one beam, blocks conflicting operations, and clears on failure', () => {
  const { context, clock, cards } = harness();
  context.renderSiteDeployments(targets);
  const operation = context.beginSiteDeployment('*');
  assert.equal(context.beginSiteDeployment('blog'), null);
  assert.equal(context.beginSiteDeployment('*'), null);
  assert.equal(cards().every((card) => card.button.disabled), true);
  clock.advance(3000);
  assert.equal(context.siteDeployMsgEl.classList.contains('is-beaming'), true);
  assert.equal(cards().some((card) => card.classList.contains('is-beaming')), false);
  context.finishSiteDeployment(operation, true, 'request failed');
  assert.equal(context.siteDeployMsgEl.classList.contains('is-beaming'), false);
  assert.equal(context.siteDeployAllBtn.disabled, false);
  assert.equal(cards().every((card) => !card.button.disabled), true);
  assert.equal(clock.pending, 0);
});

test('request completion stops deployment animation before the inventory refresh completes', async () => {
  const post = deferred();
  const get = deferred();
  const { context, clock, cards } = harness((path, options) => options.method === 'POST' ? post.promise : get.promise);
  context.renderSiteDeployments(targets);
  const deployment = context.runSiteDeployment('blog', cards()[0].button);
  clock.advance(3000);
  assert.equal(cards()[0].classList.contains('is-beaming'), true);
  post.resolve(ok({ steps: [{ handled: true }, { handled: false }] }));
  // Flush the POST's fetch and JSON continuations, leaving inventory fetch unresolved.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cards()[0].classList.contains('is-deploying'), false);
  assert.equal(cards()[0].progress.textContent, 'Reconcile requested');
  assert.match(context.siteDeployMsgEl.textContent, /1\/2 controllers acknowledged/);
  assert.doesNotMatch(context.siteDeployMsgEl.textContent, /deployed|release verified/i);
  get.resolve(ok(targets));
  await deployment;
  assert.equal(cards()[0].progress.textContent, 'Reconcile requested');
  assert.equal(cards()[0].button.disabled, false);
  clock.advance(5000);
  assert.equal(clock.pending, 0);
});

test('failed deploy requests stop delayed animation and permit retry', async () => {
  const post = deferred();
  const { context, clock, cards } = harness(() => post.promise);
  context.renderSiteDeployments(targets);
  const deployment = context.runSiteDeployment('blog', cards()[0].button);
  post.reject(new Error('Flux unavailable'));
  await deployment;
  clock.advance(5000);
  assert.equal(cards()[0].progress.textContent, 'Reconcile request failed');
  assert.equal(cards()[0].progress.classList.contains('is-error'), true);
  assert.equal(cards()[0].button.disabled, false);
  assert.equal(context.siteDeployAllBtn.disabled, false);
  assert.equal(context.controlActivityEl.hidden, true);
  assert.equal(clock.pending, 0);
  assert.ok(context.beginSiteDeployment('blog'));
});

test('image tags retain the timestamp and canonical short SHA with the full tag in the tooltip', () => {
  const { context } = harness();
  const full = '1790411919-5eed42690a443133a9fada7375b9a3c8a85194c4';
  assert.equal(context.shortHash(full), '1790411919-5eed426');
  assert.match(context.deployTag('current', full), new RegExp('title="' + full + '"'));
  assert.equal(context.shortHash('v1.2.3'), 'v1.2.3');
});

for (const outcome of ['success', 'failure']) {
  test('an earlier refresh ' + outcome + ' cannot overwrite a pending deploy-all message', async () => {
    const get = deferred();
    const post = deferred();
    const { context, clock, cards } = harness((path, options) => options.method === 'POST' ? post.promise : get.promise);
    context.renderSiteDeployments(targets);
    const refresh = context.loadSiteDeployments({ force: true });
    const deployment = context.runAllSiteDeployments(context.siteDeployAllBtn);
    const pendingMessage = context.siteDeployMsgEl.textContent;
    clock.advance(3000);
    if (outcome === 'success') get.resolve(ok(targets));
    else get.reject(new Error('snapshot unavailable'));
    await refresh;
    assert.equal(context.siteDeployMsgEl.textContent, pendingMessage);
    assert.equal(context.siteDeployMsgEl.error, false);
    assert.equal(context.siteDeployMsgEl.classList.contains('is-beaming'), true);
    assert.equal(cards().every((card) => card.button.disabled), true);
    assert.equal(context.siteDeployRefreshBtn.disabled, false);
    if (outcome === 'failure') assert.equal(context.siteDeploySummaryEl.textContent, 'Deploy snapshot unavailable');
    post.reject(new Error('deployment stopped'));
    await deployment;
    clock.advance(5000);
    assert.equal(context.siteDeployMsgEl.classList.contains('is-beaming'), false);
    assert.equal(clock.pending, 0);
  });
}

test('concurrent targets share one beam, handing it back when the newest request finishes', () => {
  const { context, clock, cards } = harness();
  context.renderSiteDeployments(targets);
  const first = context.beginSiteDeployment('blog');
  clock.advance(3000);
  const second = context.beginSiteDeployment('docs');
  assert.equal(cards().filter((card) => card.classList.contains('is-beaming')).length, 1);
  clock.advance(3000);
  assert.equal(cards()[0].classList.contains('is-beaming'), false);
  assert.equal(cards()[1].classList.contains('is-beaming'), true);
  assert.equal(cards().every((card) => card.progress.textContent === 'Requesting Flux reconcile…'), true);
  context.finishSiteDeployment(second, false);
  assert.equal(cards()[0].classList.contains('is-beaming'), true);
  assert.equal(cards()[1].classList.contains('is-beaming'), false);
  context.finishSiteDeployment(first, false);
  assert.equal(cards().some((card) => card.classList.contains('is-beaming')), false);
  assert.equal(clock.pending, 0);
});

test('a retried target becomes the newest beam candidate', () => {
  const { context, clock, cards } = harness();
  context.renderSiteDeployments(targets);
  const first = context.beginSiteDeployment('blog');
  const second = context.beginSiteDeployment('docs');
  clock.advance(3000);
  context.finishSiteDeployment(first, true);
  const retry = context.beginSiteDeployment('blog');
  clock.advance(3000);
  assert.equal(cards()[0].classList.contains('is-beaming'), true);
  assert.equal(cards()[1].classList.contains('is-beaming'), false);
  context.finishSiteDeployment(retry, false);
  assert.equal(cards()[1].classList.contains('is-beaming'), true);
  context.finishSiteDeployment(second, false);
  assert.equal(clock.pending, 0);
});
