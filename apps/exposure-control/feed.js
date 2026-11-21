/* Activity page for the control panel: a dot-matrix display face and the markup for one timeline. Owns no data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Feed = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  /* -------------------------------------------------------------- matrix */

  // Seven rows per glyph; a glyph is as wide as its rows. The lamp (▪) sits on
  // the baseline so a status mark shares the grid of the word beside it.
  const ROWS = 7;
  const GLYPHS = Object.fromEntries(Object.entries({
    A: '.###. #...# #...# ##### #...# #...# #...#',
    B: '####. #...# #...# ####. #...# #...# ####.',
    C: '.###. #...# #.... #.... #.... #...# .###.',
    D: '####. #...# #...# #...# #...# #...# ####.',
    E: '##### #.... #.... ####. #.... #.... #####',
    F: '##### #.... #.... ####. #.... #.... #....',
    G: '.###. #...# #.... #.### #...# #...# .###.',
    H: '#...# #...# #...# ##### #...# #...# #...#',
    I: '##### ..#.. ..#.. ..#.. ..#.. ..#.. #####',
    J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
    K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
    L: '#.... #.... #.... #.... #.... #.... #####',
    M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
    N: '#...# ##..# #.#.# #..## #...# #...# #...#',
    O: '.###. #...# #...# #...# #...# #...# .###.',
    P: '####. #...# #...# ####. #.... #.... #....',
    Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
    R: '####. #...# #...# ####. #.#.. #..#. #...#',
    S: '.#### #.... #.... .###. ....# ....# ####.',
    T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    U: '#...# #...# #...# #...# #...# #...# .###.',
    V: '#...# #...# #...# #...# #...# .#.#. ..#..',
    W: '#...# #...# #...# #.#.# #.#.# ##.## #...#',
    X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
    Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
    Z: '##### ....# ...#. ..#.. .#... #.... #####',
    0: '.###. #...# #...# #...# #...# #...# .###.',
    1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
    2: '.###. #...# ....# ...#. ..#.. .#... #####',
    3: '.###. #...# ....# ..##. ....# #...# .###.',
    4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
    5: '##### #.... ####. ....# ....# #...# .###.',
    6: '..##. .#... #.... ####. #...# #...# .###.',
    7: '##### ....# ...#. ..#.. .#... .#... .#...',
    8: '.###. #...# #...# .###. #...# #...# .###.',
    9: '.###. #...# #...# .#### ....# ...#. .##..',
    ':': '. . # . # . .',
    '.': '. . . . . . #',
    '-': '... ... ... ### ... ... ...',
    '/': '....# ....# ...#. ..#.. .#... #.... #....',
    '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
    ' ': '.. .. .. .. .. .. ..',
    '▪': '.. .. .. .. .. ## ##',
  }).map(([char, rows]) => [char, rows.split(' ')]));

  const round = (value) => String(+Number(value).toFixed(4));

  // Text as lit squares on a unit grid; `fill` is the lit share of each cell.
  // With `sweep`, columns are separate paths so CSS can print them in order.
  function matrix(text, options) {
    const o = options || {};
    const fill = Number.isFinite(o.fill) ? o.fill : 0.8;
    const side = round(fill);
    const columns = [];
    let x = 0;
    for (const char of String(text ?? '').toUpperCase()) {
      const glyph = GLYPHS[char] || GLYPHS['?'];
      const width = glyph[0].length;
      for (let column = 0; column < width; column += 1) {
        let d = '';
        for (let row = 0; row < ROWS; row += 1) {
          if (glyph[row][column] === '#') d += 'M' + (x + column) + ' ' + row + 'h' + side + 'v' + side + 'h-' + side + 'z';
        }
        columns.push(d);
      }
      x += width + 1;
    }
    const width = Math.max(1, x - 1) - (1 - fill);
    const body = o.sweep
      ? columns.map((d, index) => (d ? '<path style="--i:' + index + '" d="' + d + '"/>' : '')).join('')
      : '<path d="' + columns.join('') + '"/>';
    return '<svg class="matrix' + (o.sweep ? ' matrix-sweep' : '') + '" viewBox="0 0 ' + round(width) + ' ' + round(ROWS - (1 - fill)) + '" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  /* ---------------------------------------------------------------- time */

  const TIME_ZONE = 'Asia/Singapore';
  const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: 'short' });
  const fullFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

  const clock = (date) => clockFormat.format(date);
  function dayLabel(date) {
    const parts = Object.fromEntries(dayFormat.formatToParts(date).map((part) => [part.type, part.value]));
    return parts.weekday + ' ' + parts.day + ' ' + parts.month;
  }

  // How long a pinned condition has held: 14M, 2H, 3D.
  function age(date, now) {
    const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
    if (minutes < 60) return minutes + 'M';
    if (minutes < 1440) return Math.floor(minutes / 60) + 'H';
    return Math.min(999, Math.floor(minutes / 1440)) + 'D';
  }

  /* --------------------------------------------------------------- state */

  const STATES = {
    'in-sync': { word: 'IN SYNC', tone: 'status', label: 'in sync' },
    syncing: { word: 'SYNCING', tone: 'warning', label: 'syncing' },
    stalled: { word: 'STALLED', tone: 'danger', label: 'stalled' },
    unknown: { word: 'NO SIGNAL', tone: 'neutral', label: 'no signal' },
  };

  function headlineMarkup(state) {
    const meaning = STATES[state] || STATES.unknown;
    return '<span class="sr-only">Activity: ' + meaning.label + '</span>' +
      '<span class="feed-headline-art" aria-hidden="true">' + matrix(meaning.word, { sweep: true }) +
      '<span class="feed-lamp" data-tone="' + meaning.tone + '">' + matrix('▪') + '</span></span>';
  }

  function countersMarkup(summary) {
    const s = summary || {};
    const cells = [['Commits', s.commits], ['Rollouts', s.rollouts], ['Failed', s.failed]];
    return cells.map(([label, value]) => {
      const known = Number.isFinite(value);
      const figure = known ? String(Math.max(0, Math.round(value))).padStart(2, '0') : '--';
      const alarm = label === 'Failed' && known && value > 0;
      return '<div class="feed-counter"' + (alarm ? ' data-tone="danger"' : '') + '><dt class="eyebrow">' + label + '</dt>' +
        '<dd class="feed-figure">' + matrix(figure, { sweep: true }) + '<span class="sr-only">' + (known ? value : 'unavailable') + '</span></dd></div>';
    }).join('');
  }

  // One line under the filters: what is live and when it was read.
  function statusLine(payload, now) {
    const sources = (payload && payload.sources) || {};
    const missing = Object.entries(sources).filter(([, state]) => state !== 'live').map(([name]) => name);
    const at = clock(new Date(now ?? Date.now()));
    return { state: missing.length ? 'degraded' : 'live', text: (missing.length ? 'no ' + missing.join(', ') : 'Live') + ' · ' + at };
  }

  /* ------------------------------------------------------------- filters */

  const VIEWS = [
    { id: 'all', label: 'Everything', test: () => true },
    { id: 'people', label: 'People', test: (event) => event.actor?.kind === 'person' },
    { id: 'bots', label: 'Bots', test: (event) => event.actor?.kind === 'bot' },
    { id: 'rollouts', label: 'Rollouts', test: (event) => event.kind === 'rollout' || event.kind === 'reconcile' },
    { id: 'failed', label: 'Failed', test: (event) => Boolean(event.failed) },
  ];

  function areaOf(view) {
    return String(view || '').startsWith('area:') ? String(view).slice(5) : '';
  }

  function select(events, view) {
    const list = Array.isArray(events) ? events : [];
    const area = areaOf(view);
    if (area) return list.filter((event) => Array.isArray(event.areas) && event.areas.includes(area));
    const chosen = VIEWS.find((candidate) => candidate.id === view) || VIEWS[0];
    return list.filter(chosen.test);
  }

  // The two busiest areas earn a chip of their own; any other area appears
  // only while it is the chosen view.
  function busiestAreas(events, limit) {
    const counts = new Map();
    for (const event of Array.isArray(events) ? events : []) {
      if (event.area) counts.set(event.area, (counts.get(event.area) || 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name]) => name);
  }

  function filtersMarkup(events, view) {
    const current = areaOf(view) || VIEWS.some((candidate) => candidate.id === view) ? view : 'all';
    const failed = select(events, 'failed').length;
    const chip = (id, label, extra) => '<button type="button" class="feed-chip" data-feed-view="' + escape(id) + '" aria-pressed="' + (id === current) + '">' + label + (extra || '') + '</button>';
    const areas = busiestAreas(events, 2);
    const chosen = areaOf(current);
    if (chosen && !areas.includes(chosen)) areas.push(chosen);
    return VIEWS.map((candidate) => chip(candidate.id, candidate.label, candidate.id === 'failed' && failed ? '<span class="feed-chip-count" data-tone="danger">' + failed + '</span>' : '')).join('') +
      areas.map((area) => chip('area:' + area, '#' + escape(area))).join('');
  }

  /* ----------------------------------------------------------------- rows */

  const ICONS = {
    commit: '<circle cx="12" cy="12" r="3.5"/><path d="M2 12h6.5M15.5 12H22"/>',
    cycle: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    job: '<rect x="3" y="5" width="18" height="16"/><path d="M16 3v4M8 3v4M3 11h18m-12 4 5 3-5 2v-5Z"/>',
    panel: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
    arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  };
  const icon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || ICONS.commit) + '</svg>';

  function initials(name) {
    const words = String(name || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (!words.length) return '?';
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  }

  function avatar(actor) {
    const who = actor || {};
    if (who.kind === 'person') return '<span class="feed-avatar" data-kind="person" aria-hidden="true">' + escape(initials(who.name)) + '</span>';
    return '<span class="feed-avatar" data-kind="bot" aria-hidden="true">' + icon(who.icon) + '</span>';
  }

  // Lamps mark deviations only; a healthy value is plain text.
  function tagTone(key, value, event) {
    if (key === 'reason') return event.tone === 'danger' || event.tone === 'warning' ? event.tone : '';
    if (value === 'failed') return 'danger';
    if (value === 'pending' || value === 'running' || (key === 'auth' && value === 'none')) return 'warning';
    return '';
  }

  function quoteMarkup(quote) {
    if (!quote) return '';
    const date = new Date(quote.at);
    const when = Number.isNaN(date.getTime()) ? '' : ' · ' + clock(date);
    const more = Number(quote.more) > 0 ? ' · +' + Number(quote.more) + ' more' : '';
    return '<blockquote class="feed-quote"><div class="feed-quote-meta">' + icon(quote.actor?.icon) +
      '<strong>' + escape(quote.actor?.name || 'unknown') + '</strong><span>via ' + escape(quote.via || 'git') + when + more + '</span></div>' +
      '<p>' + escape(quote.text) + '</p></blockquote>';
  }

  function progressMarkup(progress) {
    if (!progress) return '';
    const known = Number.isFinite(progress.ratio);
    const percent = known ? Math.max(0, Math.min(100, progress.ratio * 100)) : 0;
    return '<div class="feed-progress">' + icon('timer') + '<span>' + escape(progress.label || 'in progress') + '</span>' +
      (known
        ? '<span class="feed-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(percent) + '"><span style="width:' + percent.toFixed(1) + '%"></span></span>'
        : '<span class="feed-meter is-indeterminate" role="progressbar" aria-label="' + escape(progress.label || 'in progress') + '"><span></span></span>') +
      '</div>';
  }

  function rowMarkup(event, options) {
    const o = options || {};
    const date = new Date(event.at);
    const valid = !Number.isNaN(date.getTime());
    const stamp = !valid ? '--:--' : event.pinned ? age(date, o.now ?? Date.now()) : clock(date);
    const tags = (Array.isArray(event.tags) ? event.tags : []).map(([key, value]) => {
      const tone = tagTone(key, String(value), event);
      return '<span class="feed-tag"' + (tone ? ' data-tone="' + tone + '"' : '') + '>' + escape(key) + '=' + escape(value) + '</span>';
    }).join('');
    // Only repository links the server built are followed.
    const links = (Array.isArray(event.links) ? event.links : [])
      .filter((link) => /^https:\/\/github\.com\//.test(String(link?.href || '')))
      .map((link) => '<a class="feed-link" href="' + escape(link.href) + '" target="_blank" rel="noreferrer">' + escape(link.label) + icon('arrow') + '</a>').join('');
    const detail = event.detail ? '<span class="feed-detail">' + escape(event.detail) + '</span>' : '';
    const area = event.area
      ? '<button type="button" class="feed-area" data-feed-view="area:' + escape(event.area) + '" title="Only ' + escape(event.area) + '">#' + escape(event.area) + '</button>'
      : '';
    return '<li class="feed-row' + (o.fresh ? ' is-new' : '') + '" data-id="' + escape(event.id) + '" data-tone="' + escape(event.tone || 'neutral') + '" style="--i:' + (Number(o.index) || 0) + '">' +
      '<time class="feed-time"' + (valid ? ' datetime="' + date.toISOString() + '" title="' + escape(fullFormat.format(date)) + ' SGT"' : '') + '>' +
        matrix(stamp, { fill: 2 / 3 }) + '<span class="feed-time-text">' + (event.pinned && valid ? 'for ' + stamp.toLowerCase() : stamp) + '</span></time>' +
      avatar(event.actor) +
      '<div class="feed-body">' +
        '<div class="feed-meta"><strong class="feed-actor">' + escape(event.actor?.name || 'unknown') + '</strong>' +
          '<span class="feed-via">via ' + escape(event.via || '') + '</span>' + area + '</div>' +
        '<p class="feed-text">' + escape(event.text) + '</p>' +
        quoteMarkup(event.quote) + progressMarkup(event.progress) +
        (detail || links || tags ? '<div class="feed-foot"><span class="feed-links">' + detail + links + '</span><span class="feed-tags">' + tags + '</span></div>' : '') +
      '</div></li>';
  }

  // Pinned conditions first under "Now", then one group per Singapore day.
  function listMarkup(events, options) {
    const o = options || {};
    const list = Array.isArray(events) ? events : [];
    const limit = Math.max(1, Number(o.limit) || 40);
    const shown = list.slice(0, limit);
    if (!shown.length) return '<p class="empty-state">' + escape(o.empty || 'Nothing here.') + '</p>';
    const fresh = o.fresh instanceof Set ? o.fresh : new Set();
    const groups = [];
    shown.forEach((event, index) => {
      const date = new Date(event.at);
      const label = event.pinned ? 'Now' : Number.isNaN(date.getTime()) ? 'Undated' : dayLabel(date);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, rows: [] });
      groups[groups.length - 1].rows.push(rowMarkup(event, { fresh: fresh.has(event.id), index, now: o.now }));
    });
    return groups.map((group) => '<section class="feed-day"><h2 class="feed-day-label">' + escape(group.label) + '</h2><ol class="feed-rows">' + group.rows.join('') + '</ol></section>').join('') +
      (list.length > limit ? '<button type="button" class="feed-more" data-feed-more>Older<span>' + (list.length - limit) + '</span></button>' : '');
  }

  return { GLYPHS, ROWS, STATES, VIEWS, escape, matrix, clock, dayLabel, age, headlineMarkup, countersMarkup, statusLine, select, busiestAreas, filtersMarkup, initials, rowMarkup, listMarkup };
});
