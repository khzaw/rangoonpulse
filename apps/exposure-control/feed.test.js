const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const Feed = require('./feed.js');

const read = (file) => fs.readFileSync(__dirname + '/' + file, 'utf8');
const count = (text, pattern) => (text.match(pattern) || []).length;
const event = (overrides = {}) => ({
  id: 'commit:abc', at: '2026-11-21T15:49:13.000Z', kind: 'commit',
  actor: { name: 'renovate', kind: 'bot', icon: 'cycle' }, via: 'git', text: 'Update jackett to v2', detail: null,
  area: 'jackett', areas: ['jackett'], tone: 'neutral', failed: false, pinned: false,
  tags: [['state', 'applied']], links: [], quote: null, progress: null, ...overrides,
});

test('every glyph is seven rows of one width, and the vocabulary the page prints is covered', () => {
  for (const [char, rows] of Object.entries(Feed.GLYPHS)) {
    assert.equal(rows.length, Feed.ROWS, char);
    assert.ok(rows.every((row) => row.length === rows[0].length && /^[#.]+$/.test(row)), char);
  }
  const printed = Object.values(Feed.STATES).map((state) => state.word).join('') + '0123456789:MHD-▪';
  for (const char of printed) assert.ok(Feed.GLYPHS[char], 'missing glyph for ' + JSON.stringify(char));
  // Digits share one width so times and counts do not shift as they change.
  assert.deepEqual([...new Set('0123456789'.split('').map((digit) => Feed.GLYPHS[digit][0].length))], [5]);
});

test('the matrix draws one square per lit cell on a unit grid sized for whole-pixel dots', () => {
  const colon = Feed.matrix(':', { fill: 0.5 });
  assert.match(colon, /^<svg class="matrix" viewBox="0 0 0\.5 6\.5" aria-hidden="true" focusable="false">/);
  assert.match(colon, /<path d="M0 2h0\.5v0\.5h-0\.5zM0 4h0\.5v0\.5h-0\.5z"\/>/);

  const time = Feed.matrix('23:49', { fill: 2 / 3 });
  assert.match(time, /viewBox="0 0 24\.6667 6\.6667"/, 'four digits, a colon and four gaps, less the last dot gap');
  assert.equal(count(time, /<path /g), 1);
  const lit = 'IN SYNC'.split('').reduce((sum, char) => sum + Feed.GLYPHS[char].join('').split('#').length - 1, 0);
  assert.equal(count(Feed.matrix('in sync'), /M\d+ \d+h/g), lit, 'lowercase input prints the same glyphs');

  // Sweep splits the text into columns so CSS can print them in order.
  const sweep = Feed.matrix('10', { sweep: true });
  assert.match(sweep, /class="matrix matrix-sweep"/);
  assert.equal(count(sweep, /<path style="--i:\d+"/g), 8, 'empty columns carry no path');
  assert.match(sweep, /style="--i:9"/);

  assert.match(Feed.matrix('é<'), /viewBox="0 0 10\.8 6\.8"/, 'unknown characters print as question marks');
  assert.doesNotMatch(Feed.matrix('<script>"'), /script|"\s*"/);
  assert.match(Feed.matrix(''), /<path d=""\/>/);
});

test('the headline states its meaning in text and the counters never print an unread count as zero', () => {
  const stalled = Feed.headlineMarkup('stalled');
  assert.match(stalled, /<span class="sr-only">Activity: stalled<\/span>/);
  assert.match(stalled, /class="feed-lamp" data-tone="danger"/);
  assert.match(Feed.headlineMarkup('in-sync'), /Activity: in sync.*data-tone="status"/s);
  assert.match(Feed.headlineMarkup('syncing'), /data-tone="warning"/);
  assert.match(Feed.headlineMarkup('nonsense'), /Activity: no signal.*data-tone="neutral"/s);

  const counters = Feed.countersMarkup({ commits: 9, rollouts: 0, failed: 2 });
  assert.equal(count(counters, /class="feed-counter"/g), 3);
  assert.match(counters, /data-tone="danger"><dt class="eyebrow">Failed<\/dt>/);
  assert.match(counters, /<span class="sr-only">9<\/span>/);
  assert.match(counters, /<span class="sr-only">0<\/span>/);
  const blind = Feed.countersMarkup({ commits: null, rollouts: undefined, failed: null });
  assert.equal(count(blind, /<span class="sr-only">unavailable<\/span>/g), 3);
  assert.doesNotMatch(blind, /data-tone/);
  assert.equal(count(Feed.countersMarkup(), /unavailable/g), 3);
});

test('the status line names each source that could not be read', () => {
  const now = Date.parse('2026-11-21T15:49:00Z');
  assert.deepEqual(Feed.statusLine({ sources: { git: 'live', flux: 'live', jobs: 'live', panel: 'live' } }, now), { state: 'live', text: 'Live · 23:49' });
  assert.deepEqual(Feed.statusLine({ sources: { git: 'unconfigured', flux: 'unavailable', panel: 'live' } }, now), { state: 'degraded', text: 'no git, flux · 23:49' });
  assert.equal(Feed.statusLine(null, now).state, 'live');
});

test('views filter by actor, kind, failure or area, and unknown views fall back to everything', () => {
  const events = [
    event({ id: 'a', actor: { name: 'khzaw', kind: 'person' } }),
    event({ id: 'b', kind: 'rollout', actor: { name: 'flux', kind: 'bot' }, failed: true }),
    event({ id: 'c', kind: 'reconcile', area: 'radarr', areas: ['radarr'] }),
    event({ id: 'd', kind: 'job', area: null, areas: [] }),
  ];
  const ids = (view) => Feed.select(events, view).map((item) => item.id);
  assert.deepEqual(ids('all'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids('people'), ['a']);
  assert.deepEqual(ids('bots'), ['b', 'c', 'd']);
  assert.deepEqual(ids('rollouts'), ['b', 'c']);
  assert.deepEqual(ids('failed'), ['b']);
  assert.deepEqual(ids('area:radarr'), ['c']);
  assert.deepEqual(ids('area:missing'), []);
  assert.deepEqual(ids('nonsense'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(Feed.select(null, 'all'), []);
});

test('filter chips mark one view pressed, count failures and offer the busiest areas', () => {
  const events = [
    ...Array.from({ length: 4 }, (_, index) => event({ id: 'j' + index })),
    ...Array.from({ length: 3 }, (_, index) => event({ id: 'b' + index, area: 'blog', areas: ['blog'] })),
    ...Array.from({ length: 3 }, (_, index) => event({ id: 'r' + index, area: 'radarr', areas: ['radarr'], failed: index === 0 })),
    event({ id: 'x', area: '<img>', areas: ['<img>'] }),
  ];
  assert.deepEqual(Feed.busiestAreas(events, 2), ['jackett', 'blog'], 'ties break by name');
  const all = Feed.filtersMarkup(events, 'all');
  assert.equal(count(all, /aria-pressed="true"/g), 1);
  assert.match(all, /data-feed-view="all" aria-pressed="true">Everything</);
  assert.match(all, /data-feed-view="failed" aria-pressed="false">Failed<span class="feed-chip-count" data-tone="danger">1<\/span>/);
  assert.match(all, /data-feed-view="area:jackett" aria-pressed="false">#jackett</);
  assert.doesNotMatch(all, /area:radarr/);

  // A chosen area outside the busiest two still shows as the pressed chip.
  const chosen = Feed.filtersMarkup(events, 'area:<img>');
  assert.match(chosen, /data-feed-view="area:&lt;img&gt;" aria-pressed="true">#&lt;img&gt;</);
  assert.equal(count(chosen, /aria-pressed="true"/g), 1);
  assert.doesNotMatch(chosen, /<img>/);
  assert.match(Feed.filtersMarkup(events, 'nonsense'), /data-feed-view="all" aria-pressed="true"/);
  assert.doesNotMatch(Feed.filtersMarkup([], 'all'), /feed-chip-count/);
});

test('a row shows Singapore time, escapes everything it was given and follows only repository links', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const row = Feed.rowMarkup(event({
    id: hostile, text: hostile, detail: hostile, area: hostile, via: hostile,
    actor: { name: hostile, kind: 'person' },
    tags: [[hostile, hostile]],
    links: [
      { label: 'abc1234', href: 'https://github.com/khzaw/rangoonpulse/commit/abc' },
      { label: 'evil', href: 'javascript:alert(1)' },
      { label: 'elsewhere', href: 'https://example.test/' },
      { label: hostile, href: 'https://github.com/"onmouseover="x' },
    ],
    quote: { actor: { name: hostile, icon: hostile }, via: hostile, at: '2026-11-21T15:40:00Z', text: hostile, more: 2 },
  }));
  assert.doesNotMatch(row, /<img/);
  assert.doesNotMatch(row, /javascript:|example\.test/);
  assert.doesNotMatch(row, /href="[^"]*"onmouseover/);
  assert.equal(count(row, /class="feed-link"/g), 2);
  assert.match(row, /<time class="feed-time" datetime="2026-11-21T15:49:13\.000Z" title="Sat, 21 Nov 2026, 23:49:13 SGT">/);
  assert.match(row, /<span class="feed-time-text">23:49<\/span>/);
  assert.match(row, /via &lt;img src=x onerror=alert\(1\)&gt; · 23:40 · \+2 more/);
  assert.match(row, /data-kind="person" aria-hidden="true">IS</);

  const plain = Feed.rowMarkup(event({ area: null, tags: [], detail: null }));
  assert.doesNotMatch(plain, /feed-foot|feed-area|feed-quote|feed-progress/);
  assert.match(plain, /data-kind="bot"/);
  assert.match(Feed.rowMarkup(event({ at: 'not a date' })), /<time class="feed-time">/);
  assert.deepEqual([Feed.initials('Kaung Htet'), Feed.initials('khzaw'), Feed.initials('renovate[bot]'), Feed.initials('')], ['KH', 'KH', 'RB', '?']);
});

test('lamps mark deviations only and pinned rows show how long the condition has held', () => {
  const tones = (overrides) => [...Feed.rowMarkup(event(overrides)).matchAll(/<span class="feed-tag"( data-tone="(\w+)")?>([^<]+)</g)].map((match) => [match[3], match[2] || '']);
  assert.deepEqual(tones({ tags: [['state', 'applied'], ['status', 'deployed'], ['run', 'succeeded'], ['auth', 'cf-access']] }), [['state=applied', ''], ['status=deployed', ''], ['run=succeeded', ''], ['auth=cf-access', '']]);
  assert.deepEqual(tones({ tags: [['state', 'pending'], ['run', 'running'], ['auth', 'none'], ['status', 'failed']] }), [['state=pending', 'warning'], ['run=running', 'warning'], ['auth=none', 'warning'], ['status=failed', 'danger']]);
  assert.deepEqual(tones({ tone: 'danger', tags: [['reason', 'UpgradeFailed']] }), [['reason=UpgradeFailed', 'danger']]);
  assert.deepEqual(tones({ tone: 'neutral', tags: [['reason', 'Unknown']] }), [['reason=Unknown', '']]);

  const now = Date.parse('2026-11-21T16:15:13Z');
  const pinned = Feed.rowMarkup(event({ pinned: true }), { now });
  assert.match(pinned, /<span class="feed-time-text">for 26m<\/span>/);
  assert.deepEqual([Feed.age(new Date(now - 59 * 60000), now), Feed.age(new Date(now - 60 * 60000), now), Feed.age(new Date(now - 49 * 3600000), now), Feed.age(new Date(now + 5000), now)], ['59M', '1H', '2D', '0M']);
});

test('progress is a measured bar only when there is something to measure against', () => {
  const measured = Feed.rowMarkup(event({ progress: { ratio: 0.6, label: '48 s of ~2 min' } }));
  assert.match(measured, /role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60"><span style="width:60\.0%">/);
  assert.match(measured, /<span>48 s of ~2 min<\/span>/);
  const open = Feed.rowMarkup(event({ progress: { ratio: null, label: 'in progress' } }));
  assert.match(open, /class="feed-meter is-indeterminate" role="progressbar" aria-label="in progress"/);
  assert.doesNotMatch(open, /aria-valuenow/);
  assert.match(Feed.rowMarkup(event({ progress: { ratio: 7, label: 'x' } })), /width:100\.0%/);
  assert.match(Feed.rowMarkup(event({ progress: { ratio: -1, label: 'x' } })), /width:0\.0%/);
});

test('the list groups pinned conditions under Now, then by Singapore day, and pages older rows', () => {
  const events = [
    event({ id: 'pin', pinned: true }),
    event({ id: 'late', at: '2026-11-21T16:30:00Z' }),
    event({ id: 'early', at: '2026-11-21T15:59:59Z' }),
    event({ id: 'older', at: '2026-11-20T10:00:00Z' }),
  ];
  const markup = Feed.listMarkup(events, { limit: 3, fresh: new Set(['early']), now: Date.parse('2026-11-21T17:00:00Z') });
  assert.deepEqual([...markup.matchAll(/<h2 class="feed-day-label">([^<]+)</g)].map((match) => match[1]), ['Now', 'Sun 22 Nov', 'Sat 21 Nov'], '16:00 UTC is midnight in Singapore');
  assert.equal(count(markup, /<li class="feed-row/g), 3);
  assert.equal(count(markup, /class="feed-row is-new"/g), 1);
  assert.match(markup, /class="feed-row is-new" data-id="early"/);
  assert.match(markup, /<button type="button" class="feed-more" data-feed-more>Older<span>1<\/span><\/button>/);
  assert.deepEqual([...markup.matchAll(/style="--i:(\d+)"/g)].map((match) => match[1]).slice(0, 3), ['0', '1', '2']);

  assert.doesNotMatch(Feed.listMarkup(events, { limit: 40 }), /data-feed-more/);
  assert.match(Feed.listMarkup([], { empty: '<nothing>' }), /<p class="empty-state">&lt;nothing&gt;<\/p>/);
  assert.match(Feed.listMarkup(null), /Nothing here\./);
});

test('the feed module is delivered as a versioned asset ahead of the application script', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('/assets/feed.js') > html.indexOf('/assets/fx.js'));
  assert.ok(html.indexOf('/assets/feed.js') < html.indexOf('/assets/app.js'));
  const server = read('server.js');
  assert.match(server, /"\/assets\/feed.js"/);
  assert.match(server, /feed\\.js\|/);
  assert.match(server, /require\("\.\/activity-feed\.js"\)/);
  const kustomization = read('kustomization.yaml');
  assert.match(kustomization, /- feed.js/);
  assert.match(kustomization, /- activity-feed.js/);
  const checks = fs.readFileSync(__dirname + '/../../package.json', 'utf8');
  assert.match(checks, /node --check apps\/exposure-control\/feed.js/);
  assert.match(checks, /node --check apps\/exposure-control\/activity-feed.js/);

  // As a browser script it defines one global and needs nothing but Intl.
  const context = vm.createContext({ window: {}, Intl });
  context.window = context;
  vm.runInContext(read('feed.js'), context);
  assert.equal(typeof context.Feed.listMarkup, 'function');
});

test('the page keeps its state readable without colour or motion and stays unframed', () => {
  const html = read('index.html');
  const section = html.slice(html.indexOf('<section id="activity"'), html.indexOf('<section id="exposure"'));
  assert.match(section, /<h1 id="feedHeadline"/);
  assert.match(section, /id="feedFilters" class="feed-filters" role="group" aria-label="Filter activity"/);
  assert.match(section, /id="feedStatus" class="pulse-status" role="status"/);
  assert.match(html, /data-page-title="Activity" href="#activity"/);

  const css = read('styles.css');
  assert.match(css, /svg\.matrix \{[^}]*fill: currentColor;[^}]*stroke: none;/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /animation: none !important/);
  // The rule that brings rows in together must not outlive a change of view.
  const app = read('app.js');
  assert.match(app, /feedListEl\.classList\.toggle\('is-swapping', swap\)/);
  assert.match(app, /if \(activePage === 'activity'\) loadActivity\(\);/);
  assert.match(app, /request\(force \? '\/api\/activity\?force=1' : '\/api\/activity', 'GET'\)/);
});
