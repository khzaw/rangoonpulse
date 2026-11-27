const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('./app.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
function element(id, attributes = {}) {
  const classes = new Set();
  return {
    id, hidden: false, attributes, dataset: {},
    classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    getAttribute(name) { return attributes[name]; },
    focus() { this.focused = true; },
    scrollIntoView() { this.scrolled = true; },
  };
}

function routing() {
  const pages = ['overview', 'pulse', 'activity', 'updates', 'deploy', 'travel', 'exposure', 'tuning', 'jobs', 'secrets'];
  const nodes = Object.fromEntries(pages.map((id) => {
    const node = element(id);
    node.heading = element(id + '-heading');
    node.querySelector = () => node.heading;
    return [id, node];
  }));
  nodes.currentPageName = element();
  nodes.auditDisclosure = element();
  const loads = [];
  const context = {
    document: { getElementById: (id) => nodes[id] },
    window: { location: { hash: '#overview' }, scrollTo() {} },
    history: { pushState(_a, _b, hash) { context.window.location.hash = hash; }, replaceState(_a, _b, hash) { context.window.location.hash = hash; } },
    pageSections: Object.values(nodes).filter((node) => pages.includes(node.id)),
    pageLinks: pages.map((id) => { const link = element(id, { href: '#' + id }); link.dataset.pageTitle = id === 'exposure' ? 'Public access' : id; return link; }),
    activePage: 'overview', hasLoadedDashboard: true, dashboardState: {},
    mobileNavigation: { matches: true }, navigation: { open: true, close() { this.open = false; } },
    transmissionPanelEl: element(), auditPanelEl: element(),
    jobsListEl: element(), jobsOverviewStripEl: element(), siteDeployListEl: element(), siteDeployOverviewStripEl: element(), secretsListEl: element(),
    loadPulse: () => loads.push('pulse'), loadActivity: () => loads.push('activity'), loadJobs: () => loads.push('jobs'), loadSecrets: () => loads.push('secrets'), loadSiteDeployments: () => loads.push('deploy'),
    skeletonTableRows: () => '', skeletonOverviewStrip: () => '',
  };
  vm.createContext(context);
  vm.runInContext(between('      function normalizePage(', '      const dateTimeFormatter'), context);
  return { context, nodes, loads };
}

test('navigation shows one page, marks the current link, closes the mobile menu and focuses the heading', () => {
  const { context, nodes } = routing();
  context.setActivePage('exposure', { focus: true });
  assert.deepEqual(context.pageSections.filter((node) => !node.hidden).map((node) => node.id), ['exposure']);
  assert.deepEqual(context.pageLinks.filter((node) => node.getAttribute('aria-current') === 'page').map((node) => node.id), ['exposure']);
  assert.equal(context.document.title, 'Public access · rangoonpulse');
  assert.equal(context.window.location.hash, '#exposure');
  assert.equal(context.navigation.open, false);
  assert.equal(nodes.exposure.heading.focused, true);
  context.setActivePage('overview');
  assert.equal(context.pageLinks.find((node) => node.id === 'exposure').getAttribute('aria-current'), undefined);
});

test('legacy deep links still reveal and scroll to audit or Transmission', () => {
  const { context, nodes } = routing();
  context.setActivePage('#audit');
  assert.equal(nodes.auditDisclosure.open, true);
  assert.equal(context.auditPanelEl.scrolled, true);
  assert.equal(context.activePage, 'exposure');
  context.setActivePage('#transmission');
  assert.equal(context.transmissionPanelEl.scrolled, true);
  context.setActivePage('#unknown');
  assert.equal(context.activePage, 'overview');
});

test('page navigation loads lazy inventories but reuses an existing snapshot', () => {
  const { context, loads } = routing();
  context.setActivePage('jobs');
  context.dashboardState.jobs = { items: [] };
  context.setActivePage('overview');
  context.setActivePage('jobs');
  context.setActivePage('deploy');
  context.setActivePage('secrets');
  assert.deepEqual(loads, ['jobs', 'deploy', 'secrets']);
});

test('telemetry pages load on entry and not again while they stay on screen', () => {
  const { context, loads } = routing();
  context.setActivePage('activity', { focus: true });
  context.setActivePage('#activity');
  assert.equal(context.activePage, 'activity');
  assert.equal(context.window.location.hash, '#activity');
  context.setActivePage('pulse');
  context.setActivePage('activity');
  assert.deepEqual(loads, ['activity', 'pulse', 'activity']);
});

test('share search combines literal case-insensitive text and active filtering without replacing forms', () => {
  const services = [
    { id: 'reader', name: 'Book library', publicHost: 'share-reader.example.test', enabled: true },
    { id: 'media', name: 'Media', publicHost: 'share-media.example.test', enabled: false },
  ];
  const rows = services.map((service) => ({ dataset: { serviceId: service.id }, hidden: false, form: { expiry: '6' } }));
  const originalForm = rows[0].form;
  const empty = { hidden: true };
  const count = {};
  const context = vm.createContext({
    dashboardState: { services }, sharesSearch: { value: '  LIBRARY ' }, shareView: 'all', shareViewButtons: [],
    rowsEl: { querySelectorAll: () => rows, querySelector: () => empty },
    document: { getElementById: () => count },
  });
  vm.runInContext(between('      function shareMatches(', "      sharesSearch.addEventListener('input'"), context);
  context.filterShares();
  assert.equal(rows[0].hidden, false);
  assert.equal(rows[1].hidden, true);
  assert.equal(count.textContent, '1 / 2');
  context.sharesSearch.value = 'share-media.example.test';
  context.shareView = 'active';
  context.filterShares();
  assert.equal(empty.hidden, false);
  assert.equal(count.textContent, '0 / 2');
  context.sharesSearch.value = '';
  context.filterShares();
  assert.equal(empty.hidden, true);
  assert.equal(rows[0].form, originalForm);
  assert.equal(rows[0].form.expiry, '6');
  assert.equal(context.shareMatches('.*', 'all', services[0]), false);
});

test('share rows keep their configured order and their nodes across refreshes', () => {
  const rowsEl = {
    children: [],
    appendChild(node) { return this.insertBefore(node, null); },
    insertBefore(node, reference) {
      const at = this.children.indexOf(node);
      if (at !== -1) this.children.splice(at, 1);
      const index = reference ? this.children.indexOf(reference) : -1;
      node.parent = this;
      if (index === -1) this.children.push(node); else this.children.splice(index, 0, node);
      return node;
    },
  };
  function domNode(tag) {
    return {
      tag, dataset: {}, textContent: '',
      remove() { const list = this.parent.children; list.splice(list.indexOf(this), 1); },
    };
  }
  const painted = [];
  const context = vm.createContext({
    rowsEl,
    shareDraft: null,
    openShareId: null,
    isAgent: (service) => Boolean(service) && service.kind === 'agent',
    renderAgents() {},
    filterShares() {},
    tickExpiryCountdowns() {},
    buildShareRow: (svc) => { const row = domNode('li'); row.dataset.serviceId = svc.id; return row; },
    paintShareRow: (row, svc) => painted.push([row, svc.enabled]),
    document: {
      createElement: domNode,
      getElementById: () => ({ textContent: '' }),
    },
  });
  vm.runInContext(between('      function renderRows(', '      // Each agent host is one standing switch:'), context);
  const serviceOrder = () => rowsEl.children.map((row) => row.dataset.serviceId).filter(Boolean);
  const catalog = [
    { id: 'bento', name: 'BentoPDF', publicHost: 'share-bento.example.test', enabled: false },
    { id: 'jellyfin', name: 'Jellyfin', publicHost: 'share-jellyfin.example.test', enabled: false },
    { id: 'vaultwarden', name: 'Vaultwarden', publicHost: 'share-vaultwarden.example.test', enabled: false },
    { id: 'actual', name: 'Actual Budget', kind: 'agent', enabled: true },
  ];
  context.renderRows(catalog);
  assert.deepEqual(serviceOrder(), ['bento', 'jellyfin', 'vaultwarden']);
  const firstRows = rowsEl.children.filter((row) => row.dataset.serviceId);
  context.renderRows(catalog.map((svc) => (svc.id === 'vaultwarden' ? { ...svc, enabled: true } : svc)));
  assert.deepEqual(serviceOrder(), ['bento', 'jellyfin', 'vaultwarden']);
  context.renderRows(catalog.map((svc) => (svc.id === 'jellyfin' ? { ...svc, enabled: true } : svc)));
  assert.deepEqual(serviceOrder(), ['bento', 'jellyfin', 'vaultwarden']);
  assert.deepEqual(rowsEl.children.filter((row) => row.dataset.serviceId), firstRows, 'rows are repainted, not rebuilt');
  assert.equal(rowsEl.children.filter((row) => 'shareEmpty' in row.dataset).length, 1);
  context.renderRows(catalog.filter((svc) => svc.id !== 'bento').reverse());
  assert.deepEqual(serviceOrder(), ['vaultwarden', 'jellyfin']);
  assert.equal(rowsEl.children.at(-1).dataset.shareEmpty, '');
});

for (const [page, field, loader] of [['jobs', 'jobs', 'loadJobs'], ['deploy', 'siteDeployments', 'loadSiteDeployments'], ['secrets', 'secrets', 'loadSecrets']]) {
  test('opening ' + page + ' during initial loading completes its lazy request', async () => {
    let resolveServices;
    const services = new Promise((resolve) => { resolveServices = resolve; });
    const loads = [];
    const context = {
      activePage: 'overview', hasLoadedDashboard: false, dashboardState: {},
      exposureClient: { list: () => services, audit: async () => ({ entries: [] }) },
      request: async () => ({}),
      renderPlanner() {}, renderRows() {}, renderAudit() {}, renderTransmissionVpn() {}, renderUpdates() {}, renderHelmUpdates() {},
      renderRenovateStatus() {}, renderTravel() {}, renderOverview() {}, setLoadState() {}, fmtTime: () => 'now',
      loadJobs: () => loads.push('loadJobs'), loadSiteDeployments: () => loads.push('loadSiteDeployments'), loadSecrets: () => loads.push('loadSecrets'),
    };
    for (const name of ['jobsSummaryEl', 'jobsOverviewStripEl', 'jobsOverviewMetaEl', 'jobsOverviewDetailEl', 'jobsListEl', 'siteDeploySummaryEl', 'siteDeployOverviewStripEl', 'siteDeployListEl', 'secretsSummaryEl', 'secretsListEl']) context[name] = element();
    vm.createContext(context);
    vm.runInContext(between('      async function loadDashboard(', '      refreshAllBtn.onclick'), context);
    const pending = context.loadDashboard({ silent: true });
    context.activePage = page;
    resolveServices({ services: [] });
    await pending;
    assert.equal(context.hasLoadedDashboard, true);
    assert.deepEqual(loads, [loader]);
    assert.equal(context.dashboardState[field], undefined, 'the route loader owns its data; do not synthesize an empty result');
  });
}
