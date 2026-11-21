const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const Fx = require('./fx.js');

const read = (file) => fs.readFileSync(__dirname + '/' + file, 'utf8');

test('palette ranking prefers word starts and keeps the given order without a query', () => {
  const commands = [
    { label: 'Deployments', group: 'Go to' },
    { label: 'Deploy all sites', group: 'Run' },
    { label: 'Disable all shares', group: 'Run' },
    { label: 'Jellyfin', group: 'Shares', keywords: 'jellyfin share-jellyfin.example.test' },
  ];
  assert.deepEqual(Fx.rank('', commands), commands);
  assert.deepEqual(Fx.rank('   ', commands), commands);
  assert.equal(Fx.rank('dall', commands)[0].label, 'Deploy all sites');
  assert.equal(Fx.rank('dis', commands)[0].label, 'Disable all shares');
  assert.equal(Fx.rank('share-jelly', commands)[0].label, 'Jellyfin');
  assert.deepEqual(Fx.rank('zzz', commands), []);
  assert.equal(Fx.score('x', 'Overview'), 0);
  assert.ok(Fx.score('ov', 'Overview') > Fx.score('ov', 'Remove'));
});

test('digit roll renders one strip per digit, starts from the previous value and escapes text', () => {
  const first = Fx.rollMarkup('12.5 %');
  assert.equal((first.match(/class="roll-digit"/g) || []).length, 3);
  assert.match(first, /data-d="1" style="--d:0"/);
  assert.match(first, /<span class="roll-char">\.<\/span>/);

  // Digits align from the right, so 9 → 10 moves the units and adds a ten.
  const grown = Fx.rollMarkup('10', '9');
  assert.match(grown, /data-d="1" style="--d:0"/);
  assert.match(grown, /data-d="0" style="--d:9"/);

  assert.match(Fx.rollMarkup('7', '7'), /data-d="7" style="--d:7"/);
  assert.match(Fx.rollMarkup('<b>'), /&lt;/);
  assert.doesNotMatch(Fx.rollMarkup('<b>'), /<b>/);
});

test('the signal trace is brightest at the sweep head, fades behind it and flattens without a reading', () => {
  const base = { width: 800, step: 8, gap: 120, tail: 500, period: 340, amp: 80, mid: 140, sigma: 5, flat: true, head: 400 };
  const onLine = (x, extra = {}) => Fx.fieldLevel(x, base.mid, { ...base, ...extra });
  assert.ok(onLine(396) > 0.9);
  assert.ok(onLine(300) < onLine(396));
  assert.equal(onLine(404), 0, 'cells ahead of the head stay dark until the sweep reaches them');
  assert.ok(Fx.fieldLevel(396, base.mid - 60, base) < 1e-6, 'cells far from the stroke stay dark');

  // A live trace leaves the baseline at the QRS spike and keeps the stroke continuous.
  const spikeX = 0.37 * base.period;
  const live = { ...base, flat: false, head: spikeX + 40 };
  assert.ok(Fx.fieldLevel(spikeX, base.mid - base.amp * 0.6, live) > 0.4);
  assert.ok(Fx.fieldLevel(spikeX, base.mid - base.amp * 0.6, { ...live, flat: true }) < 1e-6);

  const nearPointer = Fx.fieldLevel(100, 40, { ...base, px: 100, py: 40 });
  assert.ok(nearPointer > 0.4 && nearPointer <= 1);
  assert.ok(Math.abs(Fx.ecg(0.37) - 1) < 0.05);
});

test('fx is delivered as a versioned asset ahead of the application script', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('/assets/fx.js') > html.indexOf('/assets/pulse.js'));
  assert.ok(html.indexOf('/assets/fx.js') < html.indexOf('/assets/app.js'));
  assert.match(read('server.js'), /"\/assets\/fx.js"/);
  assert.match(read('server.js'), /fx\\.js\|/);
  assert.match(read('kustomization.yaml'), /- fx.js/);
  assert.match(fs.readFileSync(__dirname + '/../../package.json', 'utf8'), /node --check apps\/exposure-control\/fx.js/);
});

test('motion has a reduced-motion fallback and state is never colour alone', () => {
  const css = read('styles.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.pill\[data-tone="neutral"\]::before/);
  const fx = read('fx.js');
  assert.match(fx, /prefers-reduced-motion: reduce/);
  // Toast and palette text reaches the DOM as text or escaped markup only.
  assert.match(fx, /\.textContent = text/);
  assert.doesNotMatch(fx, /innerHTML = [^;]*command\.label(?![^;]*escape)/);
});

test('the rail folds from one control and the choice is restored before first paint', () => {
  const html = read('index.html');
  assert.match(html, /localStorage\.getItem\('rp-nav'\) === 'folded'/);
  assert.match(html, /id="navMenuBtn"[^>]*aria-controls="navigation"/);
  const app = read('app.js');
  assert.match(app, /localStorage\.setItem\('rp-nav', 'folded'\)/);
  assert.match(app, /if \(!mobileNavigation\.matches\) \{\s+setNavFolded\(!navFolded\(\)\);/, 'narrow screens keep the modal drawer');
  const css = read('styles.css');
  const wide = css.slice(css.indexOf('@media (min-width: 981px)'));
  assert.match(wide, /:root\[data-nav="folded"\] \{ --sidebar-w: 56px; \}/);
  // Folded labels stay in the accessibility tree; they are moved, not removed.
  assert.doesNotMatch(wide.slice(0, wide.indexOf('.nav-count')), /\.nav-pill > span[^{]*\{[^}]*display: none/);
});

test('boxes stay on the dashboard pages', () => {
  const html = read('index.html');
  const section = (id) => {
    const start = html.indexOf('<section id="' + id + '"');
    return html.slice(start, html.indexOf('</section>\n\n', start));
  };
  const classTokens = (source) => [...source.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/));
  assert.ok(classTokens(section('overview')).includes('box'));
  assert.ok(classTokens(section('pulse')).includes('tiles'));
  for (const id of ['activity', 'exposure', 'deploy', 'updates', 'travel', 'tuning', 'jobs', 'secrets']) {
    const tokens = classTokens(section(id));
    assert.ok(tokens.length > 0, id + ' section was not found');
    for (const boxed of ['box', 'tiles', 'panel']) assert.ok(!tokens.includes(boxed), id + ' must not use ' + boxed);
  }
  assert.doesNotMatch(read('styles.css'), /\.panel\b/);
});
