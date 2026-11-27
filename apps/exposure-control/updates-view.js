/* Updates page for the control panel: one model from the image report, the
   chart report, Renovate status and the activity feed, and the markup for it.
   Owns no data and performs no I/O. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./update-policy.js'));
  else root.UpdatesView = factory(root.UpdatePolicy);
})(typeof window === 'object' ? window : globalThis, function (defaultPolicy) {
  'use strict';

  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function ms(value) {
    const time = Date.parse(String(value || ''));
    return Number.isFinite(time) ? time : null;
  }

  function ago(value, now) {
    const time = ms(value);
    if (time === null) return '';
    const seconds = Math.max(0, ((now ?? Date.now()) - time) / 1000);
    if (seconds < 60) return 'now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
    return Math.floor(seconds / 86400) + 'd';
  }

  /* ------------------------------------------------------------ versions */

  function versionParts(value) {
    const match = String(value || '').match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
  }

  function sameVersion(left, right) {
    return String(left || '').replace(/^v/, '') === String(right || '').replace(/^v/, '');
  }

  // How far a version moves: major, minor or patch; a rebuilt floating tag is
  // a build. Unparseable tags say nothing rather than guess.
  function bump(from, to) {
    if (from && to && sameVersion(from, to)) return 'build';
    const a = versionParts(from);
    const b = versionParts(to);
    if (!a || !b) return '';
    if (a[0] !== b[0]) return 'major';
    if (a[1] !== b[1]) return 'minor';
    if (a[2] !== b[2]) return 'patch';
    return '';
  }

  function shortDigest(value) {
    const match = String(value || '').match(/sha256:([0-9a-f]{7})/i);
    return match ? match[1].toLowerCase() : '';
  }

  /* --------------------------------------------------------------- links */

  function githubRepo(repository) {
    const repo = String(repository || '').replace(/\.git$/i, '').trim();
    return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : '';
  }

  // Where to read about a new image: its release notes when the registry
  // implies a source repository, otherwise its tag listing.
  function imageLinks(imageRepo) {
    const parts = String(imageRepo || '').replace(/^[a-z]+:\/\//i, '').split('/').filter(Boolean);
    if (parts.length < 2) return [];
    const registry = parts[0].toLowerCase();
    const path = parts.slice(1);
    if (registry === 'docker.io' || registry === 'index.docker.io') {
      const page = path[0] === 'library' ? '_/' + path.slice(1).join('/') : 'r/' + path.join('/');
      return [{ label: 'Registry', href: 'https://hub.docker.com/' + page + '/tags' }];
    }
    if (registry === 'ghcr.io' && path.length >= 2) {
      return [
        { label: 'Releases', href: 'https://github.com/' + path[0] + '/' + path[1] + '/releases' },
        { label: 'Registry', href: 'https://ghcr.io/' + path.join('/') },
      ];
    }
    if (registry === 'lscr.io' && path[0] === 'linuxserver' && path[1]) {
      return [{ label: 'Releases', href: 'https://github.com/linuxserver/docker-' + path[1] + '/releases' }];
    }
    if (registry === 'quay.io') {
      return [{ label: 'Registry', href: 'https://quay.io/repository/' + path.join('/') + '?tab=tags' }];
    }
    return [];
  }

  function chartLinks(item) {
    const chart = String(item && item.chart || '').trim();
    return chart ? [{ label: 'Registry', href: 'https://artifacthub.io/packages/search?ts_query_web=' + encodeURIComponent(chart) + '&sort=relevance' }] : [];
  }

  // A code search for the line that pins this version, so the change is one
  // click from its manifest.
  function gitSearchLink(item, kind, repository) {
    const repo = githubRepo(repository);
    if (!repo) return null;
    let query = '';
    if (kind === 'chart') {
      if (item && item.chart) query = '"chart: ' + item.chart + '"';
    } else {
      const parts = String(item && (item.imageRepo || item.image) || '').split('@')[0].split('/').filter(Boolean);
      const path = parts.length > 1 && /[.:]/.test(parts[0]) ? parts.slice(1) : parts;
      const name = (path[0] === 'library' ? path.slice(1) : path).join('/').replace(/:[^/]*$/, '');
      if (name) query = '"' + name + '"';
    }
    return query ? { label: 'Git', href: 'https://github.com/' + repo + '/search?q=' + encodeURIComponent(query) + '&type=code' } : null;
  }

  /* --------------------------------------------------------------- lanes */

  const LANES = [
    { id: 'action', title: 'Needs action' },
    { id: 'flight', title: 'In flight' },
    { id: 'held', title: 'Held' },
  ];

  // Where an update stands, in a word; the reason rides along as a tooltip.
  function stateFor(workflow, context) {
    const renovate = context.renovate || {};
    const run = renovate.activeRun || null;
    const links = [];
    switch (workflow.kind) {
      case 'open-pr':
        if (workflow.url) links.push({ label: '#' + String(workflow.label).replace(/\D+/g, ''), href: workflow.url, primary: true });
        return { lane: 'action', tone: 'warning', label: 'Review PR', why: workflow.detail || 'Renovate PR is open.', links };
      case 'queued':
        if (renovate.dashboardIssueUrl) links.push({ label: 'Dashboard', href: renovate.dashboardIssueUrl });
        return { lane: 'flight', tone: 'pending', label: 'Queued', why: 'Deferred by the Renovate PR limit.', links };
      case 'git-ahead':
        return { lane: 'flight', tone: 'pending', label: 'Rolling out', why: workflow.label + ' · Flux has not applied it yet.', links };
      case 'chart-managed':
        return { lane: 'held', tone: 'neutral', label: 'Via chart', why: workflow.detail, links };
      case 'version-policy':
        return { lane: 'held', tone: 'neutral', label: 'Pinned', why: workflow.detail, links };
      default:
        break;
    }
    if (!renovate.configured) return { lane: 'action', tone: 'warning', label: 'Manual', why: 'Renovate is not connected; bump it in Git.', links };
    if (run) {
      if (run.url) links.push({ label: '#' + (run.runNumber || ''), href: run.url });
      return { lane: 'flight', tone: 'pending', label: 'Renovating', why: 'A Renovate run is in progress.', links };
    }
    return {
      lane: 'action',
      tone: 'warning',
      label: workflow.kind === 'new-since-run' ? 'New' : 'No PR',
      why: workflow.kind === 'new-since-run' ? 'Found after the last Renovate run. Run Renovate.' : 'Renovate has not opened a PR. Run Renovate.',
      links,
    };
  }

  function baseRow(item, kind, context) {
    const from = item.currentVersion || '';
    const to = item.latestVersion || '';
    const source = kind === 'chart'
      ? [item.chart, item.repo].filter(Boolean).join(' · ')
      : String(item.imageRepo || item.image || '').replace(/^docker\.io\/(library\/)?/, '');
    const refs = (kind === 'chart' ? chartLinks(item) : imageLinks(item.imageRepo || item.image));
    const git = gitSearchLink(item, kind, context.renovate && context.renovate.repository);
    if (git) refs.push(git);
    return {
      id: kind + ':' + (item.namespace || '') + '/' + (item.name || item.id || ''),
      kind,
      name: String(item.name || item.id || (kind === 'chart' ? 'release' : 'workload')),
      namespace: String(item.namespace || ''),
      source,
      from,
      to,
      bump: bump(from, to),
      toDigest: shortDigest(item.detail),
      detail: String(item.detail || ''),
      statusText: String(item.statusText || ''),
      refs,
    };
  }

  function searchText(row) {
    return [row.name, row.namespace, row.kind, row.source, row.from, row.to, row.detail, row.state && row.state.label, row.area]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function matches(row, filter) {
    if (filter.kind && filter.kind !== 'all' && row.kind !== filter.kind) return false;
    return !filter.query || searchText(row).includes(filter.query);
  }

  // What Renovate and Flux image automation landed in Git, newest first.
  function landedFrom(activity) {
    const events = activity && Array.isArray(activity.events) ? activity.events : [];
    return events
      .filter((event) => event && event.kind === 'commit' && event.actor && ['renovate', 'flux'].includes(event.actor.name))
      .map((event) => {
        const text = String(event.text || '');
        const match = text.match(/^update\s+(?:(?:dependency|helm release)\s+)?(.+?)(?:\s+(?:docker tag|image tag|action))?\s+to\s+(\S+)$/i);
        const image = text.match(/^update\s+(\S+)\s+image$/i);
        const subject = match ? match[1] : image ? image[1] : text;
        const state = (event.tags || []).find(([key]) => key === 'state');
        return {
          id: event.id,
          at: event.at,
          kind: /helm release|chart/i.test(text) ? 'chart' : event.actor.name === 'flux' ? 'image' : /action/i.test(text) ? 'action' : 'image',
          name: subject.split('/').pop(),
          source: subject.includes('/') ? subject : '',
          to: match ? match[2] : '',
          change: image ? String(event.detail || '').split('→').pop().trim() : '',
          by: event.actor.name === 'flux' ? 'image automation' : 'renovate',
          area: String(event.area || ''),
          state: state ? state[1] : '',
          links: Array.isArray(event.links) ? event.links : [],
          title: text,
        };
      });
  }

  function buildModel(input) {
    const options = input || {};
    const policy = options.policy || defaultPolicy;
    const renovate = options.renovate || null;
    const filter = {
      kind: options.kind || 'all',
      query: String(options.query || '').trim().toLowerCase(),
    };
    const context = { renovate };
    const sources = [
      ['image', options.images],
      ['chart', options.charts],
    ];

    const available = [];
    const unchecked = [];
    const current = [];
    const totals = { image: 0, chart: 0 };
    for (const [kind, payload] of sources) {
      const items = payload && Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        if (!item) continue;
        const row = baseRow(item, kind, context);
        if (item.status === 'update') {
          totals[kind] += 1;
          const workflow = kind === 'chart'
            ? policy.classifyHelmUpdate(item, renovate, payload.checkedAt)
            : policy.classifyImageUpdate(item, renovate, payload.checkedAt);
          row.state = stateFor(workflow, context);
          row.lane = row.state.lane;
          available.push(row);
        } else if (item.status === 'current') {
          current.push(row);
        } else {
          row.reason = row.detail || row.statusText || 'unknown';
          unchecked.push(row);
        }
      }
    }

    const order = { major: 0, minor: 1, patch: 2, build: 3, '': 4 };
    available.sort((a, b) => order[a.bump] - order[b.bump] || a.name.localeCompare(b.name));
    current.sort((a, b) => a.name.localeCompare(b.name));
    unchecked.sort((a, b) => a.name.localeCompare(b.name));

    const landed = landedFrom(options.activity);
    const visible = (rows) => rows.filter((row) => matches(row, filter));
    const lanes = LANES.map((lane) => ({ ...lane, rows: visible(available.filter((row) => row.lane === lane.id)) }));
    const laneCount = (id) => available.filter((row) => row.lane === id).length;
    const checkedAt = [options.images, options.charts].map((payload) => payload && payload.checkedAt).filter(Boolean);

    return {
      filter,
      lanes,
      unchecked: visible(unchecked),
      current: visible(current),
      landed: visible(landed),
      counts: {
        available: available.length,
        action: laneCount('action'),
        flight: laneCount('flight'),
        held: laneCount('held'),
        images: totals.image,
        charts: totals.chart,
        unchecked: unchecked.length,
        current: current.length,
        tracked: available.length + unchecked.length + current.length,
        landed: landed.length,
        landedPending: landed.filter((row) => row.state === 'pending').length,
      },
      reportsLoaded: Boolean(options.images && options.charts),
      errors: [['Images', options.images], ['Charts', options.charts]]
        .filter(([, payload]) => payload && payload.error)
        .map(([label, payload]) => label + ': ' + payload.error),
      activityLoaded: Boolean(options.activity),
      activityWindowHours: Number(options.activity && options.activity.windowHours) || 168,
      checkedAt: checkedAt.length ? checkedAt.sort()[0] : null,
    };
  }

  /* -------------------------------------------------------------- markup */

  const ARROW = '<svg class="ext-arrow" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-arrow"/></svg>';

  function linkMarkup(link) {
    if (!link || !link.href) return '';
    return '<a class="ext-link' + (link.primary ? ' is-primary' : '') + '" href="' + escape(link.href) + '" target="_blank" rel="noreferrer"' +
      (link.title ? ' title="' + escape(link.title) + '"' : '') + '>' + escape(link.label) + ARROW + '<span class="sr-only"> (new tab)</span></a>';
  }

  function kindTag(kind) {
    return '<span class="upd-kind" data-kind="' + escape(kind) + '">' + escape(kind) + '</span>';
  }

  function nameMarkup(row, title) {
    return '<div class="upd-what"><div class="upd-name"' + (title ? ' title="' + escape(title) + '"' : '') + '>' + escape(row.name) + kindTag(row.kind) + '</div>' +
      (row.source ? '<div class="upd-source" title="' + escape(row.source) + '">' + escape(row.source) + '</div>' : '') + '</div>';
  }

  function versionMarkup(row) {
    const badge = row.bump ? '<span class="upd-bump" data-bump="' + row.bump + '">' + row.bump + '</span>' : '';
    if (row.bump === 'build') {
      return '<div class="upd-version"><span class="upd-tag">' + escape(row.to || row.from) + '</span>' +
        (row.toDigest ? '<span class="upd-digest" title="' + escape(row.detail) + '">' + escape(row.toDigest) + '</span>' : '') + badge + '</div>';
    }
    return '<div class="upd-version"><span class="upd-from-to">' +
      '<span class="upd-tag is-from">' + escape(row.from || '—') + '</span><span class="upd-arrow" aria-label="to">→</span>' +
      '<span class="upd-tag is-to">' + escape(row.to || '—') + '</span></span>' + badge + '</div>';
  }

  function statusMarkup(tone, label, why) {
    return '<span class="upd-status" data-tone="' + escape(tone) + '"' + (why ? ' title="' + escape(why) + '"' : '') + '>' + escape(label) + '</span>';
  }

  function availableRow(row) {
    return '<li class="upd-row" data-lane="' + escape(row.lane) + '">' +
      nameMarkup(row) +
      versionMarkup(row) +
      '<div class="upd-state">' + statusMarkup(row.state.tone, row.state.label, row.state.why) + row.state.links.map(linkMarkup).join('') + '</div>' +
      '<div class="upd-links">' + row.refs.map(linkMarkup).join('') + '</div>' +
    '</li>';
  }

  function lanesMarkup(model) {
    if (!model.reportsLoaded) return '<p class="upd-empty">Loading…</p>';
    const errors = model.errors.map((error) => '<p class="upd-error">' + escape(error) + '</p>').join('');
    const shown = model.lanes.filter((lane) => lane.rows.length);
    if (!shown.length) return errors + '<p class="upd-empty">' + (model.counts.available ? 'No match.' : model.errors.length ? '' : 'All current.') + '</p>';
    return errors + shown.map((lane) =>
      '<section class="upd-lane" aria-labelledby="updLane-' + lane.id + '">' +
        '<h3 id="updLane-' + lane.id + '" class="upd-lane-title"><span class="upd-lane-mark" data-lane="' + lane.id + '"></span>' + escape(lane.title) + '<span class="upd-count">' + lane.rows.length + '</span></h3>' +
        '<ul class="upd-list">' + lane.rows.map(availableRow).join('') + '</ul>' +
      '</section>'
    ).join('');
  }

  function landedMarkup(model, options) {
    const now = options && options.now;
    const limit = (options && options.landedLimit) || 10;
    if (!model.activityLoaded) return '<p class="upd-empty">Loading…</p>';
    if (!model.landed.length) return '<p class="upd-empty">' + (model.counts.landed ? 'No match.' : 'Nothing this week.') + '</p>';
    const states = { applied: ['ok', 'live'], pending: ['pending', 'rolling out'] };
    const rows = model.landed.slice(0, limit).map((row) => {
      const [tone, label] = states[row.state] || ['neutral', 'in git'];
      const version = row.to
        ? '<span class="upd-tag is-to">' + escape(row.to) + '</span>'
        : row.change ? '<span class="upd-digest">' + escape(row.change) + '</span>' : '';
      return '<li class="upd-landed-row">' +
        '<time class="upd-when" datetime="' + escape(row.at) + '" title="' + escape(row.at) + '">' + escape(ago(row.at, now)) + '</time>' +
        nameMarkup({ name: row.name, kind: row.kind, source: '' }, row.title + ' · ' + row.by) +
        '<div class="upd-version">' + version + '</div>' +
        statusMarkup(tone, label) +
        '<div class="upd-links">' + row.links.map(linkMarkup).join('') + '</div>' +
      '</li>';
    }).join('');
    const more = model.landed.length > limit
      ? '<a class="upd-more" href="#activity">+' + (model.landed.length - limit) + ' in Activity</a>'
      : '';
    return '<ol class="upd-landed">' + rows + '</ol>' + more;
  }

  function compactMarkup(rows, mode) {
    if (!rows.length) return '<p class="upd-empty">No match.</p>';
    return '<ul class="upd-compact">' + rows.map((row) =>
      '<li class="upd-compact-row">' +
        nameMarkup(row) +
        '<span class="upd-tag">' + escape(row.from || '—') + '</span>' +
        (mode === 'unchecked' ? '<span class="upd-reason" title="' + escape(row.reason) + '">' + escape(row.reason) + '</span>' : '<span></span>') +
        '<div class="upd-links">' + row.refs.map(linkMarkup).join('') + '</div>' +
      '</li>'
    ).join('') + '</ul>';
  }

  // Four open figures; each jumps to the list it counts.
  function figuresMarkup(model) {
    const c = model.counts;
    const value = (loaded, n) => (loaded ? String(n) : '—');
    const figure = (target, label, figureValue, tone) =>
      '<button class="upd-figure" type="button" data-updates-jump="' + target + '" data-tone="' + tone + '">' +
        '<span class="upd-figure-label">' + label + '</span><span class="upd-figure-value">' + figureValue + '</span></button>';
    const loaded = model.reportsLoaded;
    return [
      figure('updLane-action', 'Needs action', value(loaded, c.action), loaded && c.action ? 'warning' : 'neutral'),
      figure('updLane-flight', 'In flight', value(loaded, c.flight), 'neutral'),
      figure('updatesLanded', 'Landed · 7d', value(model.activityLoaded, c.landed), 'neutral'),
      figure('updatesUnchecked', 'Unchecked', value(loaded, c.unchecked), loaded && c.unchecked ? 'danger' : 'neutral'),
    ].join('');
  }

  // Renovate as one line of facts and links.
  function renovateMarkup(renovate, now) {
    if (!renovate || !renovate.configured) {
      return '<span class="lamp off"></span><span>Renovate ' + escape(renovate && renovate.error ? 'unavailable' : 'off') + '</span>';
    }
    const run = renovate.activeRun || renovate.lastRun || null;
    let state = 'never run';
    let tone = 'off';
    if (renovate.activeRun) {
      state = 'running ' + ago(run.createdAt || run.updatedAt, now);
      tone = 'pending';
    } else if (run) {
      const ok = run.conclusion === 'success';
      state = (ok ? 'ok' : (run.conclusion || run.status || 'done')) + ' ' + ago(run.updatedAt, now) + ' ago';
      tone = ok ? 'status' : 'danger';
    }
    const repo = githubRepo(renovate.repository);
    const prs = Number(renovate.openPrCount || 0);
    const links = [
      run && run.url ? { label: '#' + (run.runNumber || ''), href: run.url, title: 'Workflow run' } : null,
      repo ? { label: prs + (prs === 1 ? ' PR' : ' PRs'), href: 'https://github.com/' + repo + '/pulls?q=is%3Apr+is%3Aopen+label%3Arenovate' } : null,
      renovate.dashboardIssueUrl ? { label: 'Dashboard', href: renovate.dashboardIssueUrl, title: 'Renovate dependency dashboard' } : null,
    ];
    return '<span class="lamp ' + tone + '"></span><span>Renovate ' + escape(state) + '</span>' + links.map(linkMarkup).join('');
  }

  function sectionHead(id, title) {
    return '<h2 id="' + id + '" class="block-title upd-block-head" tabindex="-1">' + escape(title) + '</h2>';
  }

  function bodyMarkup(model, options) {
    const o = options || {};
    const open = o.open || {};
    const c = model.counts;
    const disclosure = (key, id, title, count, body) =>
      '<details class="disclosure upd-disclosure" data-updates-disclosure="' + key + '"' + (open[key] ? ' open' : '') + '>' +
        '<summary><span id="' + id + '" tabindex="-1">' + escape(title) + '<span class="upd-count">' + count + '</span></span></summary>' + body +
      '</details>';
    return (
      sectionHead('updatesAvailable', 'Available') +
      lanesMarkup(model) +
      sectionHead('updatesLanded', 'Landed') +
      landedMarkup(model, o) +
      '<div class="upd-disclosures">' +
        disclosure('unchecked', 'updatesUnchecked', 'Unchecked', model.reportsLoaded ? c.unchecked : '—', compactMarkup(model.unchecked, 'unchecked')) +
        disclosure('current', 'updatesCurrent', 'Up to date', model.reportsLoaded ? c.current : '—', compactMarkup(model.current, 'current')) +
      '</div>'
    );
  }

  // The Overview digest shows a floating-tag rebuild as a build, not "x → x".
  function changeLabel(item) {
    const from = item && item.currentVersion || '?';
    const to = item && item.latestVersion || '?';
    return bump(from, to) === 'build' ? from + ' · new build' : from + ' → ' + to;
  }

  return {
    LANES,
    ago,
    bump,
    imageLinks,
    chartLinks,
    gitSearchLink,
    landedFrom,
    buildModel,
    figuresMarkup,
    renovateMarkup,
    bodyMarkup,
    changeLabel,
  };
});
