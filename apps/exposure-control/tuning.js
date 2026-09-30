/* Read-only projection of advisor evidence. Policy remains server-owned. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tuning = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const identityFields = ['namespace', 'workload', 'container', 'release'];
  const list = (value) => Array.isArray(value) ? value : [];
  const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const dated = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  const identity = (row) => JSON.stringify(identityFields.map((field) => row[field] ?? null));
  const difference = (current, projected) => number(current) !== null && number(projected) !== null ? projected - current : null;
  const humanize = (value) => String(value || 'Unknown').replace(/[_-]+/g, ' ');
  const reasons = {
    not_allowlisted: 'Outside automatic PR scope; manual review only.',
    path_not_mapped: 'No repository resource path is mapped.',
    downscale_excluded: 'Automatic reductions are disabled for this service.',
    insufficient_data_for_upsize: 'More metrics history is needed before increasing resources.',
    insufficient_data_for_downsize: 'More metrics history is needed before reducing resources.',
    upsize_below_apply_floor: 'Increase is below the minimum PR change size.',
    downsize_below_apply_floor: 'Reduction is below the minimum PR change size.',
    restart_guard_blocks_downsize: 'Restart activity prevents automatic reductions.',
    max_changes_reached: 'This run has reached its change limit.',
    node_capacity_block: 'Would exceed node capacity with current placement.',
    downsize_with_mature_data: 'Enough history supports a reduction.',
    upsize_with_node_fit: 'Increase fits current node capacity.',
    upsize_with_node_fit_under_advisory_pressure: 'Increase fits despite advisory pressure.',
    upsize_without_worsening_pressure: 'Increase does not worsen an active pressure dimension.',
  };
  const reasonText = (value) => Object.hasOwn(reasons, value) ? reasons[value] : 'Reported reason: ' + humanize(value) + '.';

  // Parse only for comparison; display the exact quantities from the source.
  function quantity(value, resource) {
    if (value == null || value === '') return null;
    const match = String(value).match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/);
    if (!match) return null;
    const scales = resource === 'cpu' ? { '': 1000, m: 1, u: 0.001, n: 0.000001 }
      : { '': 1 / 1048576, Ki: 1 / 1024, Mi: 1, Gi: 1024, Ti: 1048576,
        k: 1000 / 1048576, M: 1000000 / 1048576, G: 1000000000 / 1048576 };
    return Object.hasOwn(scales, match[2]) ? number(Number(match[1]) * scales[match[2]]) : null;
  }

  function decorateRow(report, proposal, key, skipped, previewAvailable) {
    const source = proposal || report;
    const current = source.current || {};
    const recommended = source.recommended || {};
    const notes = [...new Set([...list(report?.notes), ...list(proposal?.notes)])];
    const waiting = !report || notes.includes('awaiting_metrics') || number(report.cpu_p95_m) === null || number(report.mem_p95_mi) === null;
    const deltas = (kind) => ['cpu', 'memory'].map((resource) =>
      difference(quantity(current[kind]?.[resource], resource), quantity(recommended[kind]?.[resource], resource)));
    const requestDeltas = deltas('requests');
    const limitDeltas = deltas('limits');
    const limitsChanged = limitDeltas.some((value) => value !== null && value !== 0);
    const limitOnly = limitsChanged && requestDeltas.every((value) => value === 0);
    const category = proposal ? 'selected' : !waiting && report.action === 'no-change' ? 'unchanged' : 'deferred';
    const status = proposal ? 'Proposed PR change' : waiting ? 'Awaiting metrics' : category === 'unchanged' ? 'No change' : 'Deferred';
    const reason = proposal ? reasonText(proposal.selection_reason)
      : waiting ? 'Waiting for CPU and memory history; no change queued.'
      : category === 'unchanged' ? 'Below the report’s change threshold; advice may still differ.'
      : !previewAvailable ? 'Preview unavailable; report advice only.'
      : skipped ? reasonText(skipped.reason) : 'Not selected in this preview; no unambiguous reason reported.';
    const allDeltas = [...requestDeltas, ...limitDeltas];
    const action = proposal ? allDeltas.some((value) => value > 0) ? 'upsize'
      : allDeltas.some((value) => value < 0) ? 'downsize' : allDeltas.every((value) => value === 0) ? 'no-change' : 'unknown' : report.action || 'unknown';
    return { key, source, report, proposal, current, recommended, notes, category, status, reason, action, waiting, limitsChanged, limitOnly };
  }

  function buildModel(payload) {
    const data = payload || {};
    const reportAvailable = Array.isArray(data.report?.recommendations);
    const reportRows = reportAvailable ? data.report.recommendations : [];
    const apply = data.applyPreflight || {};
    const selected = list(apply.selected);
    // Exporter fallback has a fresh timestamp and empty selection even when planning fails.
    const planEvidence = typeof apply.nodeFit?.hard_fit_ok === 'boolean' && Array.isArray(apply.nodeFit.nodes) &&
      [apply.currentRequests, apply.projectedRequestsAfterSelected].every((totals) =>
        ['cpu_m', 'memory_mi'].every((key) => number(totals?.[key]) !== null));
    const previewAvailable = reportAvailable && data.fetch?.state === 'live' && data.fetch.lastFetchOk !== false &&
      planEvidence && dated(apply.builtAt) && Array.isArray(apply.selected) &&
      selected.every((row) => identityFields.every((field) => typeof row[field] === 'string' && row[field].length)) &&
      new Set(selected.map(identity)).size === selected.length &&
      (apply.selectedCount == null || apply.selectedCount === selected.length);
    const matched = new Set();
    const rows = reportRows.map((report, index) => {
      const unique = reportRows.filter((row) => identity(row) === identity(report)).length === 1;
      const proposal = previewAvailable && unique ? selected.find((row) => identity(row) === identity(report)) : null;
      if (proposal) matched.add(proposal);
      // A partial skip reason is safe only when it identifies exactly one report row,
      // including no-change/awaiting rows. Never narrow away ambiguity first.
      const skips = list(apply.skipped).filter((skip) => {
        if (!skip.release || !skip.container) return false;
        const matches = (row) => identityFields.every((field) => skip[field] == null || skip[field] === row[field]);
        return matches(report) && reportRows.filter(matches).length === 1;
      });
      return decorateRow(report, proposal, identity(report) + (unique ? '' : ':report:' + index), skips.length === 1 ? skips[0] : null, previewAvailable);
    });
    if (previewAvailable) selected.filter((row) => !matched.has(row)).forEach((proposal) => {
      rows.push(decorateRow(null, proposal, identity(proposal) + ':proposal', null, true));
    });
    const counts = { selected: 0, deferred: 0, unchanged: 0, all: rows.length };
    rows.forEach((row) => counts[row.category]++);
    return { data, rows, counts, previewAvailable, reportAvailable,
      cpuDelta: previewAvailable ? difference(apply.currentRequests?.cpu_m, apply.projectedRequestsAfterSelected?.cpu_m) : null,
      memoryDelta: previewAvailable ? difference(apply.currentRequests?.memory_mi, apply.projectedRequestsAfterSelected?.memory_mi) : null };
  }

  function filterRows(model, filters = {}) {
    const query = String(filters.query || '').trim().toLowerCase();
    return model.rows.filter((row) => {
      const search = [row.source.namespace, row.source.workload, row.source.release, row.source.container,
        row.action, row.status, row.reason, ...row.notes, JSON.stringify(row.current), JSON.stringify(row.recommended)].join(' ').toLowerCase();
      return (!filters.view || filters.view === 'all' || row.category === filters.view) &&
        (!filters.action || filters.action === 'all' || row.action === filters.action) &&
        (!filters.note || filters.note === 'all' || row.notes.includes(filters.note)) && (!query || search.includes(query));
    });
  }

  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const measured = (value, unit = '') => number(value) === null ? 'Not reported' : String(value) + (unit ? ' ' + unit : '');
  const resourceValue = (value) => value == null || value === '' ? 'Not reported' : String(value);
  const pair = (before, after) => '<span class="tuning-pair">' + escape(resourceValue(before)) + ' <span class="tuning-arrow">→</span> <strong>' + escape(resourceValue(after)) + '</strong></span>';
  const field = (label, value) => '<div><dt>' + escape(label) + '</dt><dd>' + value + '</dd></div>';

  function dateText(value, timeZone = 'UTC') {
    if (!dated(value)) return 'Unknown';
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) + ' · ' + timeZone;
    } catch {
      return dateText(value, 'UTC') + ' (schedule timezone unavailable)';
    }
  }

  function prLink(item) {
    try {
      const url = new URL(item.pr_url);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port ||
        !/^\/[^/]+\/[^/]+\/pull\/\d+$/.test(url.pathname)) return '';
      return '<a href="' + escape(url.href) + '" target="_blank" rel="noopener noreferrer">' +
        escape(item.release || 'PR') + ' #' + escape(url.pathname.split('/').pop()) + '</a>';
    } catch { return ''; }
  }

  function executionText(status) {
    const labels = { created_or_updated: 'PRs created or updated', no_selected_changes: 'No changes selected',
      no_repo_changes: 'No repository changes', partial_failure: 'Partially failed', token_missing: 'PR creation unavailable: token missing',
      invalid_repository: 'PR creation failed: invalid repository', branch_prepare_failed: 'Branch preparation failed',
      lookup_failed: 'PR lookup failed', update_failed: 'PR update failed', create_failed: 'PR creation failed' };
    return Object.hasOwn(labels, status) ? labels[status] : 'Recorded result: ' + humanize(status);
  }

  function renderSummary(model) {
    const { data, previewAvailable, counts } = model;
    const apply = data.applyPreflight || {};
    const report = data.report || {};
    const schedule = data.schedule || {};
    const timeZone = schedule.timeZone || 'UTC';
    const last = data.lastApply || {};
    const executionAt = dated(last.runAt) ? last.runAt : last.execution?.executed_at;
    const fit = previewAvailable ? apply.hardFitOk : null;
    const pressure = (resource) => !previewAvailable ? 'unknown' : apply.advisoryPressure?.[resource] === true ? 'above ceiling'
      : apply.advisoryPressure?.[resource] === false ? 'within ceiling' : 'unknown';
    const impact = (name, delta, unit, key) => '<div><span class="tuning-label">' + name + ' requests</span><strong class="tuning-impact-value">' +
      escape(delta === null ? 'Unknown' : (delta > 0 ? '+' : '') + measured(delta, unit)) + '</strong><span class="tuning-subtle">' +
      (previewAvailable ? escape(measured(apply.currentRequests?.[key], unit)) + ' → ' + escape(measured(apply.projectedRequestsAfterSelected?.[key], unit)) : 'Preview required') + '</span></div>';
    const lastRun = dated(executionAt) ? escape(dateText(executionAt, timeZone)) + ' · ' + escape(executionText(last.status || last.execution?.status)) +
      (number(last.prCount) === null ? '' : ' · ' + escape(last.prCount) + ' PR(s) reported') +
      list(last.execution?.pull_requests).map(prLink).filter(Boolean).map((link) => ' · ' + link).join('') : 'No recorded execution';
    return '<div class="tuning-decision"><div><h3>' + (previewAvailable
      ? counts.selected + ' change' + (counts.selected === 1 ? '' : 's') + ' would be proposed'
      : 'Preview unavailable') + '</h3><p class="tuning-subtle">Preview only. The scheduled job opens PRs; browsing applies nothing.</p>' +
      (!previewAvailable ? '<p class="tuning-warning">Selection cannot be confirmed. ' + escape(data.fetch?.detail || 'Report or preflight evidence is unavailable or inconsistent.') + '</p>' : '') +
      '</div><div class="tuning-impact">' + impact('CPU', model.cpuDelta, 'm', 'cpu_m') + impact('Memory', model.memoryDelta, 'Mi', 'memory_mi') + '</div></div>' +
      '<p class="tuning-subtle tuning-scope">Selected-change impact on whole-cluster requests: reservations, not usage savings.</p>' +
      '<div class="tuning-checks"><span><strong>Hard node fit</strong> <span class="' + (fit === false ? 'tuning-warning' : '') + '">' +
      (fit === true ? 'Passes' : fit === false ? 'Blocked' : 'Unknown') + '</span></span><span><strong>Advisory pressure</strong> CPU ' + pressure('cpu') +
      ' · memory ' + pressure('memory') + '. Ordering signal, not a blocking gate.</span></div>' +
      '<div class="tuning-run-lines"><p><strong>Next PR run</strong> ' + escape(schedule.suspended === true ? 'Suspended' : dateText(schedule.nextRunAt, timeZone)) +
      '</p><p><strong>Last actual run</strong> ' + lastRun + '</p><p class="tuning-subtle">Recorded PR results do not confirm merge or deployment.</p></div>' +
      '<p class="tuning-freshness">Report ' + escape(dateText(data.fetch?.lastRunAt, timeZone)) + ' · ' + escape(measured(report.metricsCoverageDaysEstimate, 'days')) +
      ' coverage / ' + escape(report.metricsWindow || 'unknown window') + ' · ' + escape(measured(report.summary?.containers_with_metrics)) + '/' +
      escape(measured(report.summary?.containers_analyzed)) + ' containers with metrics · Preview ' + escape(dateText(apply.builtAt, timeZone)) + '</p>';
  }

  function renderRow(row, model, open = false) {
    const source = row.source;
    const report = row.report || {};
    const { current, recommended } = row;
    const basis = row.proposal ? 'Proposed' : 'Report advice';
    const timeZone = model.data.schedule?.timeZone || 'UTC';
    const changes = ['cpu', 'memory'].map((resource) => '<span class="tuning-resource"><span class="tuning-label">' +
      (resource === 'cpu' ? 'CPU' : 'Memory') + ' request</span>' + pair(current.requests?.[resource], recommended.requests?.[resource]) +
      '<span class="tuning-subtle">' + basis + '</span></span>').join('');
    const provenance = row.proposal ? 'Apply preflight ' + dateText(model.data.applyPreflight?.builtAt, timeZone) +
      '. Adjusted requests and limits selected for a possible PR, not an applied change.'
      : 'Report snapshot ' + dateText(model.data.fetch?.lastRunAt, timeZone) + '. Advice only, not queued for a PR.';
    return '<details class="tuning-row" data-tuning-key="' + escape(row.key) + '"' + (open ? ' open' : '') + '><summary>' +
      '<span class="tuning-identity"><strong>' + escape(source.workload || 'Unknown workload') + '</strong><span class="tuning-subtle">' +
      escape(source.namespace || 'Unknown namespace') + ' · ' + escape(source.container || 'Unknown container') + '</span><span class="tuning-subtle">release ' + escape(source.release || 'Unknown') + '</span></span>' +
      '<span class="tuning-selection"><strong>' + escape(row.status) + '</strong><span class="tuning-subtle">' + escape(row.reason) + '</span>' +
      (row.limitsChanged ? '<span class="tuning-limit-flag">' + (!row.proposal ? 'Limits differ in report advice' : row.limitOnly ? 'Limits only; requests unchanged' : 'Limits also change') + '</span>' : '') + '</span>' + changes +
      '<span class="tuning-details-label">Details <span aria-hidden="true">⌄</span></span></summary>' +
      '<div class="tuning-row-detail"><p>' + escape(provenance) + '</p><dl class="tuning-evidence">' +
      field('CPU limit · current → ' + basis.toLowerCase(), pair(current.limits?.cpu, recommended.limits?.cpu)) +
      field('Memory limit · current → ' + basis.toLowerCase(), pair(current.limits?.memory, recommended.limits?.memory)) +
      field('Observed CPU p95', escape(measured(report.cpu_p95_m, 'm'))) +
      field('Observed memory p95', escape(measured(report.mem_p95_mi, 'Mi'))) +
      field('Historical restarts', escape(measured(report.restarts_window)) + ' · ' + escape(model.data.report?.metricsWindow || 'unknown window')) +
      field('Current live restarts', escape(measured(report.current_restarts)) + ' · ' + escape(measured(report.matched_pods)) + ' matched pod(s)') +
      field('Replicas', escape(measured(source.replicas))) +
      field('Notes', row.notes.length ? row.notes.map((note) => escape(humanize(note))).join(' · ') : 'None reported') +
      field('Source', escape(source.path || (row.proposal ? 'Apply preflight' : 'Advisor report'))) +
      '</dl>' + (!row.report ? '<p class="tuning-warning">No unambiguous matching report row; historical evidence is unavailable.</p>' : '') +
      '</div></details>';
  }

  function renderDiagnostics(model) {
    const apply = model.data.applyPreflight || {};
    const report = model.data.report || {};
    const nodeRows = model.previewAvailable ? list(apply.nodeFit?.nodes) : [];
    const nodes = nodeRows.map((node) => '<div class="tuning-node"><h4>' + escape(node.name) + '</h4><dl class="tuning-evidence">' +
      field('CPU requests · current → projected', pair(measured(node.current_requests?.cpu_m, 'm'), measured(node.projected_requests?.cpu_m, 'm'))) +
      field('Memory requests · current → projected', pair(measured(node.current_requests?.memory_mi, 'Mi'), measured(node.projected_requests?.memory_mi, 'Mi'))) +
      field('Allocatable CPU / memory', escape(measured(node.allocatable?.cpu_m, 'm')) + ' / ' + escape(measured(node.allocatable?.memory_mi, 'Mi'))) +
      field('Advisory CPU / memory ceilings', escape(measured(node.advisory_budget?.cpu_m, 'm')) + ' / ' + escape(measured(node.advisory_budget?.memory_mi, 'Mi'))) + '</dl></div>').join('');
    return '<h4>Capacity basis</h4><p>Whole-cluster live pod requests and current placement, including replicas. This is not the report-wide recommendation total.</p>' +
      '<p>' + escape(model.previewAvailable ? apply.nodeFit?.assumptions || 'Placement assumptions not reported.' : 'Live node-fit evidence unavailable.') + '</p>' +
      (nodes || '<p>No node details available.</p>') +
      '<h4>Report policy</h4><p>These are reported settings, not editable controls. Apply gates may further adjust or defer report advice.</p>' +
      '<pre>' + escape(report.policy ? JSON.stringify(report.policy, null, 2) : 'Policy unavailable.') + '</pre>' +
      '<h4>Preflight skip reasons</h4><ul>' + list(apply.skipSummary).map((item) => '<li>' + escape(reasonText(item.reason)) + ' ' + escape(measured(item.count)) + ' candidate(s)</li>').join('') + '</ul>';
  }

  function createView(root) {
    const get = (id) => root.querySelector('#' + id);
    const rowsEl = get('tuningRows');
    const noteEl = get('noteFilter');
    const actionEl = get('tuningAction');
    const searchEl = get('searchInput');
    const buttons = Array.from(root.querySelectorAll('[data-tuning-view]'));
    const viewLabels = { selected: 'Proposed PR changes', deferred: 'Deferred', unchanged: 'No change', all: 'All workloads' };
    const openRows = new Set();
    let view = 'selected';
    let model = buildModel(null);

    function renderRows() {
      let focusKey = null;
      rowsEl.querySelectorAll('[data-tuning-key]').forEach((detail) => {
        if (detail.open) openRows.add(detail.dataset.tuningKey);
        else openRows.delete(detail.dataset.tuningKey);
        if (detail.contains(root.ownerDocument.activeElement)) focusKey = detail.dataset.tuningKey;
      });
      const rows = filterRows(model, { view, action: actionEl.value, note: noteEl.value, query: searchEl.value });
      rowsEl.innerHTML = rows.map((row) => renderRow(row, model, openRows.has(row.key))).join('');
      if (focusKey) {
        const detail = Array.from(rowsEl.querySelectorAll('[data-tuning-key]')).find((row) => row.dataset.tuningKey === focusKey);
        detail?.querySelector('summary').focus({ preventScroll: true });
      }
      buttons.forEach((button) => {
        const key = button.dataset.tuningView;
        button.setAttribute('aria-pressed', String(key === view));
        // The name remains stable; the visible count is supplementary text.
        button.innerHTML = escape(viewLabels[key]) + ' <span aria-hidden="true">' +
          (key === 'selected' && !model.previewAvailable ? '—' : model.counts[key]) + '</span>';
      });
      get('tuningCount').textContent = rows.length + ' of ' + model.counts[view] + ' containers in this view';
      const empty = get('tuningEmpty');
      empty.hidden = rows.length !== 0;
      empty.textContent = !model.reportAvailable ? 'Report unavailable. Previous rows have been cleared; your filters are preserved.'
        : !model.previewAvailable && view === 'selected' ? 'Preview unavailable. Choose All workloads to inspect report advice; nothing is confirmed for a PR.'
        : view === 'selected' && !model.counts.selected ? 'No changes selected. Choose Deferred for reasons, or All workloads to inspect every container, including those awaiting metrics.'
        : 'No rows match these filters. Try All workloads, all actions, all notes, or clear the search.';
    }

    buttons.forEach((button) => button.addEventListener('click', () => { view = button.dataset.tuningView; renderRows(); }));
    noteEl.addEventListener('change', renderRows);
    actionEl.addEventListener('change', renderRows);
    searchEl.addEventListener('input', renderRows);
    return {
      render(payload) {
        model = buildModel(payload);
        const selectedNote = noteEl.value || 'all';
        const notes = [...new Set(model.rows.flatMap((row) => row.notes))];
        if (selectedNote !== 'all' && !notes.includes(selectedNote)) notes.push(selectedNote);
        noteEl.innerHTML = '<option value="all">All notes</option>' + notes.sort().map((note) =>
          '<option value="' + escape(note) + '">' + escape(humanize(note)) + '</option>').join('');
        noteEl.value = selectedNote;
        get('tuningSummary').innerHTML = renderSummary(model);
        get('tuningDiagnostics').innerHTML = renderDiagnostics(model);
        get('tuningRawReport').textContent = payload?.runtime?.latestMarkdown || 'Report output unavailable.';
        get('tuningRawExecution').textContent = payload?.lastApply?.markdown || 'Execution output unavailable.';
        renderRows();
      },
    };
  }

  return { buildModel, filterRows, renderSummary, renderRow, renderDiagnostics, createView };
});
