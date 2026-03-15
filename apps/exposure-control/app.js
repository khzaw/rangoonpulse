      const loadStateEl = document.getElementById('loadState');
      const overviewStripEl = document.getElementById('overviewStrip');
      const overviewMetaEl = document.getElementById('overviewMeta');
      const overviewDetailEl = document.getElementById('overviewDetail');
      const travelSummaryEl = document.getElementById('travelSummary');
      const travelOverviewStripEl = document.getElementById('travelOverviewStrip');
      const travelOverviewMetaEl = document.getElementById('travelOverviewMeta');
      const travelOverviewDetailEl = document.getElementById('travelOverviewDetail');
      const travelBundlesMetaEl = document.getElementById('travelBundlesMeta');
      const travelBundlesEl = document.getElementById('travelBundles');
      const travelActionStateEl = document.getElementById('travelActionState');
      const travelNotesMetaEl = document.getElementById('travelNotesMeta');
      const travelSharesEl = document.getElementById('travelShares');
      const travelNotesEl = document.getElementById('travelNotes');
      const tuningSummaryEl = document.getElementById('tuningSummary');
      const tuningOverviewStripEl = document.getElementById('tuningOverviewStrip');
      const tuningOverviewMetaEl = document.getElementById('tuningOverviewMeta');
      const tuningOverviewDetailEl = document.getElementById('tuningOverviewDetail');
      const plannerMetaEl = document.getElementById('plannerMeta');
      const plannerGridEl = document.getElementById('plannerGrid');
      const tuningFocusMetaEl = document.getElementById('tuningFocusMeta');
      const tuningFocusGridEl = document.getElementById('tuningFocusGrid');
      const tuningControlMetaEl = document.getElementById('tuningControlMeta');
      const tuningControlGridEl = document.getElementById('tuningControlGrid');
      const tuningTableMetaEl = document.getElementById('tuningTableMeta');
      const noteFilterEl = document.getElementById('noteFilter');
      const searchInputEl = document.getElementById('searchInput');
      const tuningCountEl = document.getElementById('tuningCount');
      const tuningRowsEl = document.getElementById('tuningRows');
      const tuningEmptyEl = document.getElementById('tuningEmpty');
      const runtimeLinesEl = document.getElementById('runtimeLines');
      const tuningRuntimeMetaEl = document.getElementById('tuningRuntimeMeta');
      const exposureMetaEl = document.getElementById('exposureMeta');
      const vpnSectionMetaEl = document.getElementById('vpnSectionMeta');
      const auditMetaEl = document.getElementById('auditMeta');
      const rowsEl = document.getElementById('rows');
      const auditRowsEl = document.getElementById('auditRows');
      const updatesRowsEl = document.getElementById('updatesRows');
      const vpnMetaEl = document.getElementById('vpnMeta');
      const transmissionPanelEl = document.getElementById('transmissionPanel');
      const msgEl = document.getElementById('msg');
      const vpnMsgEl = document.getElementById('vpnMsg');
      const updatesMsgEl = document.getElementById('updatesMsg');
      const updatesMetaEl = document.getElementById('updatesMeta');
      const travelMsgEl = document.getElementById('travelMsg');
      const refreshAllBtn = document.getElementById('refreshAllBtn');
      const emergencyBtn = document.getElementById('emergencyBtn');
      const vpnDirectBtn = document.getElementById('vpnDirectBtn');
      const vpnEnableBtn = document.getElementById('vpnEnableBtn');
      const travelDirectBtn = document.getElementById('travelDirectBtn');
      const travelVpnBtn = document.getElementById('travelVpnBtn');
      const travelDisableSharesBtn = document.getElementById('travelDisableSharesBtn');
      const travelExposureLink = document.getElementById('travelExposureLink');
      const updatesRefreshBtn = document.getElementById('updatesRefreshBtn');
      const pageSections = Array.from(document.querySelectorAll('[data-page-section]'));
      const pageLinks = Array.from(document.querySelectorAll('[data-page-link]'));

      let mutationInFlight = 0;
      let pendingExpiryRefresh = false;
      let transmissionVpnState = null;
      let tuningFilterAction = 'all';
      let dashboardState = {
        services: [],
        audit: [],
        vpn: null,
        updates: null,
        travel: null,
        tuning: null,
      };

      function setMessage(target, text, isError) {
        target.textContent = text || '';
        target.style.color = isError ? 'var(--red)' : 'var(--text-3)';
      }

      function setLoadState(text, isError) {
        setMessage(loadStateEl, text, isError);
      }

      function setMsg(text, isError) {
        setMessage(msgEl, text, isError);
      }

      function setVpnMsg(text, isError) {
        setMessage(vpnMsgEl, text, isError);
      }

      function setUpdatesMsg(text, isError) {
        setMessage(updatesMsgEl, text, isError);
      }

      function setTravelMsg(text, isError) {
        setMessage(travelMsgEl, text, isError);
      }

      function normalizePage(value) {
        const candidate = String(value || '').replace(/^#/, '').trim().toLowerCase();
        if (candidate === 'overview' || candidate === 'audit' || candidate === 'transmission') return 'exposure';
        const knownPages = new Set(['updates', 'travel', 'exposure', 'tuning']);
        if (knownPages.has(candidate)) return candidate;
        return 'updates';
      }

      function setActivePage(page, options) {
        const requestedPage = String(page || '').replace(/^#/, '').trim().toLowerCase();
        const nextPage = normalizePage(page);
        const replace = Boolean(options && options.replace);
        pageSections.forEach((section) => {
          section.hidden = section.id !== nextPage;
          section.classList.toggle('page-active', section.id === nextPage);
        });
        pageLinks.forEach((link) => {
          const target = normalizePage(link.getAttribute('href'));
          link.classList.toggle('active', target === nextPage);
        });
        const nextHash = '#' + nextPage;
        if (replace) {
          history.replaceState(null, '', nextHash);
        } else if (window.location.hash !== nextHash) {
          history.pushState(null, '', nextHash);
        }
        if (requestedPage === 'transmission' && nextPage === 'exposure' && transmissionPanelEl) {
          transmissionPanelEl.scrollIntoView({ block: 'start', behavior: 'auto' });
          return;
        }
        window.scrollTo({ top: 0, behavior: 'auto' });
      }

      function fmtDateTime(value) {
        if (!value) return 'n/a';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return 'n/a';
        return d.toLocaleString();
      }

      function fmtExpiry(value) {
        if (!value) return { text: '—', state: 'none' };
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return { text: 'invalid', state: 'invalid' };
        const diff = d.getTime() - Date.now();
        if (diff <= 0) return { text: 'expired', state: 'expired' };
        const totalSeconds = Math.ceil(diff / 1000);
        if (totalSeconds < 60) return { text: totalSeconds + 's remaining', state: 'urgent' };
        const mins = Math.ceil(totalSeconds / 60);
        if (mins < 60) return { text: mins + 'm remaining', state: mins <= 10 ? 'urgent' : 'active' };
        const hrs = Math.floor(mins / 60);
        const rm = mins % 60;
        return { text: rm ? hrs + 'h ' + rm + 'm remaining' : hrs + 'h remaining', state: mins <= 120 ? 'urgent' : 'active' };
      }

      function updateExpiryNode(node) {
        const next = fmtExpiry(node.dataset.expiresAt || '');
        node.textContent = next.text;
        node.classList.toggle('urgent', next.state === 'urgent');
        node.classList.toggle('expired', next.state === 'expired');
        return next.state;
      }

      function tickExpiryCountdowns() {
        let shouldRefresh = false;
        rowsEl.querySelectorAll('.expiry[data-expires-at]').forEach((node) => {
          const state = updateExpiryNode(node);
          if (node.dataset.enabled === '1' && state === 'expired') shouldRefresh = true;
        });
        if (shouldRefresh && mutationInFlight === 0 && !pendingExpiryRefresh) {
          pendingExpiryRefresh = true;
          setTimeout(async () => {
            try {
              await loadDashboard({ silent: true });
            } finally {
              pendingExpiryRefresh = false;
            }
          }, 300);
        }
      }

      async function request(path, method, body) {
        const res = await fetch(path, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'request failed');
        return data;
      }

      function withUnitSpace(value) {
        const text = String(value || '');
        const match = text.match(/^([+-]?\\d+(?:\\.\\d+)?)([A-Za-z]+)$/);
        if (!match) return text || '\\u2014';
        return match[1] + ' ' + match[2];
      }

      function escapeHtml(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function renderInlineMarkdown(value) {
        return escapeHtml(value)
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      }

      function isMarkdownTableDelimiter(line) {
        return /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(String(line || '').trim());
      }

      function parseMarkdownTableRow(line) {
        const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map((cell) => renderInlineMarkdown(cell.trim()));
      }

      function renderRuntimeMarkdown(markdown) {
        const source = String(markdown || '').replace(/\r\n/g, '\n').trim();
        if (!source) return '<p class="md-paragraph">no advisor markdown available.</p>';

        const lines = source.split('\n');
        const blocks = [];

        for (let index = 0; index < lines.length; ) {
          const line = lines[index];
          const trimmed = line.trim();

          if (!trimmed) {
            index += 1;
            continue;
          }

          const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
          if (headingMatch) {
            const level = headingMatch[1].length;
            blocks.push('<h4 class="md-heading level-' + level + '">' + renderInlineMarkdown(headingMatch[2]) + '</h4>');
            index += 1;
            continue;
          }

          if (/^- /.test(trimmed)) {
            const items = [];
            while (index < lines.length && /^- /.test(lines[index].trim())) {
              items.push('<li>' + renderInlineMarkdown(lines[index].trim().slice(2)) + '</li>');
              index += 1;
            }
            blocks.push('<ul class="md-list">' + items.join('') + '</ul>');
            continue;
          }

          if (trimmed.includes('|') && index + 1 < lines.length && isMarkdownTableDelimiter(lines[index + 1])) {
            const header = parseMarkdownTableRow(trimmed);
            const rows = [];
            index += 2;
            while (index < lines.length) {
              const rowLine = lines[index].trim();
              if (!rowLine || !rowLine.includes('|')) break;
              rows.push(parseMarkdownTableRow(rowLine));
              index += 1;
            }
            blocks.push(
              '<div class="md-table-shell"><table class="md-table"><thead><tr>' +
                header.map((cell) => '<th>' + cell + '</th>').join('') +
              '</tr></thead><tbody>' +
                rows.map((cells) => '<tr>' + cells.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('') +
              '</tbody></table></div>'
            );
            continue;
          }

          const paragraphLines = [];
          while (index < lines.length) {
            const current = lines[index].trim();
            const next = index + 1 < lines.length ? lines[index + 1].trim() : '';
            if (!current) break;
            if (/^(#{1,3})\s+/.test(current)) break;
            if (/^- /.test(current)) break;
            if (current.includes('|') && next && isMarkdownTableDelimiter(next)) break;
            paragraphLines.push(current);
            index += 1;
          }
          blocks.push('<p class="md-paragraph">' + renderInlineMarkdown(paragraphLines.join(' ')) + '</p>');
        }

        return blocks.join('');
      }

      function fmtSigned(value, suffix, digits) {
        const number = Number(value || 0);
        const fixed = number.toFixed(Number.isFinite(digits) ? digits : 1).replace(/\\.0+$/, '').replace(/(\\.\\d*?)0+$/, '$1');
        return (number > 0 ? '+' : '') + fixed + suffix;
      }

      function parseCpuToM(value) {
        const text = String(value || '0').trim().toLowerCase();
        if (!text) return 0;
        if (text.endsWith('m')) return Number(text.slice(0, -1)) || 0;
        return (Number(text) || 0) * 1000;
      }

      function parseMemToMi(value) {
        const text = String(value || '0').trim();
        const match = text.match(/^([+-]?\\d+(?:\\.\\d+)?)([A-Za-z]+)?$/);
        if (!match) return 0;
        const amount = Number(match[1]) || 0;
        const unit = String(match[2] || 'Mi');
        const scale = {
          Ki: 1 / 1024,
          Mi: 1,
          Gi: 1024,
          Ti: 1024 * 1024,
        };
        return amount * (scale[unit] || 1);
      }

      function noteTone(note) {
        const value = String(note || '').toLowerCase();
        if (value.includes('excluded')) return 'excluded';
        if (value.includes('guard')) return 'guarded';
        return 'neutral';
      }

      function statPill(label, value, tone) {
        return '<span class="stat-pill ' + (tone || 'neutral') + '"><span>' + label + '</span><strong>' + value + '</strong></span>';
      }

      function tokenPill(label, value) {
        return '<span class="token"><span>' + label + '</span><strong>' + value + '</strong></span>';
      }

      function buildFocusCard(title, subtitle, items) {
        const rows = Array.isArray(items) && items.length
          ? items.map((item) => '<li>' + item + '</li>').join('')
          : '<li><span class="muted">no items in the current snapshot.</span></li>';
        return (
          '<article class="focus-card"><div class="focus-card-body">' +
            '<div class="focus-card-title">' + title + '</div>' +
            '<div class="focus-subtitle">' + subtitle + '</div>' +
            '<ul class="focus-list">' + rows + '</ul>' +
          '</div></article>'
        );
      }

      function overviewSegment(label, value, subtitle, options) {
        const eyebrow = options && options.eyebrow ? '<span class="overview-eyebrow">' + options.eyebrow + '</span>' : '';
        const barPct = Math.max(0, Math.min(100, Number(options && options.barPct || 0)));
        const tone = options && options.tone ? options.tone : 'neutral';
        return (
          '<section class="overview-segment">' +
            '<div class="overview-segment-head"><span class="overview-label">' + label + '</span>' + eyebrow + '</div>' +
            '<div class="overview-value">' + value + '</div>' +
            '<div class="overview-subtitle">' + subtitle + '</div>' +
            '<div class="overview-meter"><span class="overview-meter-fill ' + tone + '" style="width:' + barPct.toFixed(1) + '%"></span></div>' +
          '</section>'
        );
      }

      function travelTone(state) {
        const normalized = String(state || '').toLowerCase();
        if (normalized === 'ready') return 'status';
        if (normalized === 'degraded') return 'warning';
        if (normalized === 'blocked') return 'danger';
        return 'neutral';
      }

      function travelStateLabel(state) {
        const normalized = String(state || '').toLowerCase();
        if (!normalized) return 'unknown';
        return normalized;
      }

      function travelStatusPill(state) {
        return '<span class="travel-state-pill ' + escapeHtml(travelTone(state)) + '">' + escapeHtml(travelStateLabel(state)) + '</span>';
      }

      function renderOverview() {
        const services = dashboardState.services || [];
        const updates = dashboardState.updates || null;
        const travel = dashboardState.travel || null;
        const tuning = dashboardState.tuning || null;
        const vpn = dashboardState.vpn || null;
        const activeExposures = services.filter((svc) => svc.enabled).length;
        const updateItems = updates && Array.isArray(updates.items) ? updates.items : [];
        const updatesAvailable = updateItems.filter((item) => item && item.status === 'update').length;
        const selectedNow = tuning && tuning.applyPreflight ? Number(tuning.applyPreflight.selectedCount || 0) : 0;
        const recommendations = tuning && tuning.report ? Number(tuning.report.recommendationCount || 0) : 0;
        const hardFitOk = tuning && tuning.applyPreflight ? Boolean(tuning.applyPreflight.hardFitOk) : false;
        const fetchState = tuning && tuning.fetch ? tuning.fetch.state : 'degraded';
        const fetchDetail = tuning && tuning.fetch ? tuning.fetch.detail : 'resource-advisor unavailable';
        const desiredMode = vpn && vpn.desiredMode ? vpn.desiredMode : 'unknown';
        const runningMode = vpn && vpn.effectiveMode ? vpn.effectiveMode : 'unknown';
        const travelState = travel && travel.summary ? travel.summary.state : 'unknown';
        const travelHeadline = travel && travel.summary ? travel.summary.headline : 'travel snapshot unavailable';

        overviewStripEl.innerHTML =
          overviewSegment('exposures', String(activeExposures), services.length + ' configured share targets', {
            eyebrow: 'temporary public',
            barPct: services.length ? activeExposures / services.length * 100 : 0,
            tone: activeExposures > 0 ? 'warning' : 'status',
          }) +
          overviewSegment('transmission', desiredMode, 'running ' + runningMode, {
            eyebrow: 'desired route',
            barPct: desiredMode === 'vpn' ? 100 : 35,
            tone: desiredMode === 'vpn' ? 'warning' : 'status',
          }) +
          overviewSegment('planner', String(selectedNow), recommendations + ' recommendations in current report', {
            eyebrow: 'selected now',
            barPct: recommendations ? selectedNow / recommendations * 100 : 0,
            tone: hardFitOk ? 'status' : 'warning',
          }) +
          overviewSegment('image updates', String(updatesAvailable), updateItems.length ? updateItems.length + ' tracked workloads' : 'cached report unavailable', {
            eyebrow: 'updates available',
            barPct: updateItems.length ? updatesAvailable / updateItems.length * 100 : 0,
            tone: updatesAvailable > 0 ? 'warning' : 'status',
          }) +
          overviewSegment('travel', travelState, travelHeadline, {
            eyebrow: 'remote posture',
            barPct: travelState === 'ready' ? 100 : travelState === 'degraded' ? 55 : travelState === 'blocked' ? 15 : 30,
            tone: travelTone(travelState),
          }) +
          overviewSegment('advisor fetch', fetchState, fetchDetail, {
            eyebrow: 'resource-advisor',
            barPct: fetchState === 'live' ? 100 : 25,
            tone: fetchState === 'live' ? 'status' : 'danger',
          });

        const meta = [];
        if (tuning && tuning.fetch) {
          meta.push('<span>advisor run ' + fmtDateTime(tuning.fetch.lastRunAt) + '</span>');
          meta.push('<span>advisor mode ' + (tuning.fetch.mode || 'n/a') + '</span>');
        }
        if (updates && updates.checkedAt) meta.push('<span>updates checked ' + fmtDateTime(updates.checkedAt) + '</span>');
        if (vpn) meta.push('<span>transmission desired ' + desiredMode + '</span>');
        if (travel && travel.checkedAt) meta.push('<span>travel checked ' + fmtDateTime(travel.checkedAt) + '</span>');
        overviewMetaEl.innerHTML = meta.join('');
        overviewDetailEl.textContent = fetchDetail;
        exposureMetaEl.textContent = activeExposures + ' active exposure' + (activeExposures === 1 ? '' : 's');
        vpnSectionMetaEl.textContent = vpn ? ('desired ' + desiredMode + ' · running ' + runningMode) : 'status unavailable';
        auditMetaEl.textContent = (dashboardState.audit || []).length + ' recent entries';
      }

      function renderTravel(travel) {
        const travelData = travel || null;
        const activeServices = (dashboardState.services || []).filter((svc) => svc.enabled);
        if (!travelData) {
          travelSummaryEl.textContent = 'Travel data unavailable';
          travelOverviewStripEl.innerHTML = '';
          travelOverviewMetaEl.innerHTML = '';
          travelOverviewDetailEl.textContent = 'travel snapshot unavailable';
          travelBundlesMetaEl.textContent = '0 bundles';
          travelBundlesEl.innerHTML =
            '<article class="support-card travel-card"><div class="support-card-title">travel status</div><p class="support-copy">Travel snapshot unavailable from the control panel backend.</p></article>';
          travelActionStateEl.textContent = 'status unavailable';
          travelNotesMetaEl.textContent = '0 notes';
          travelSharesEl.innerHTML = '<p class="support-copy">No travel share data available.</p>';
          travelNotesEl.innerHTML = '<p class="support-copy">Travel notes unavailable.</p>';
          if (travelDirectBtn) travelDirectBtn.disabled = true;
          if (travelVpnBtn) travelVpnBtn.disabled = true;
          if (travelDisableSharesBtn) travelDisableSharesBtn.disabled = true;
          return;
        }

        const connector = travelData.connector || {};
        const privateAccess = travelData.privateAccess || {};
        const exitNode = travelData.exitNode || {};
        const transmission = travelData.transmission || {};
        const exposures = travelData.exposures || { activeCount: 0, items: [] };
        const bundles = Array.isArray(travelData.bundles) ? travelData.bundles : [];
        const notes = Array.isArray(travelData.notes) ? travelData.notes : [];
        const activeShareCount = Number(exposures.activeCount || 0);

        travelSummaryEl.textContent = travelData.summary && travelData.summary.headline
          ? travelData.summary.headline
          : 'Travel snapshot loaded.';
        travelOverviewStripEl.innerHTML =
          overviewSegment('private path', travelStateLabel(privateAccess.state), String(privateAccess.ready || 0) + ' ready · ' + String(privateAccess.degraded || 0) + ' degraded', {
            eyebrow: 'tailnet/private',
            barPct: privateAccess.state === 'ready' ? 100 : privateAccess.state === 'degraded' ? 55 : privateAccess.state === 'blocked' ? 15 : 30,
            tone: travelTone(privateAccess.state),
          }) +
          overviewSegment('exit node', travelStateLabel(exitNode.state), connector.name || 'connector', {
            eyebrow: 'home egress',
            barPct: exitNode.state === 'ready' ? 100 : exitNode.state === 'degraded' ? 55 : exitNode.state === 'blocked' ? 15 : 30,
            tone: travelTone(exitNode.state),
          }) +
          overviewSegment('transmission', transmission.desiredMode || 'unknown', 'running ' + (transmission.effectiveMode || 'unknown'), {
            eyebrow: transmission.placeholderConfig ? 'placeholder vpn config' : 'download path',
            barPct: transmission.desiredMode === 'vpn' ? 100 : 42,
            tone: transmission.rolloutPending ? 'warning' : transmission.desiredMode === 'vpn' ? 'warning' : 'status',
          }) +
          overviewSegment('public shares', String(activeShareCount), activeShareCount ? 'disable if not needed' : 'private-only posture', {
            eyebrow: 'share hosts',
            barPct: activeShareCount > 0 ? Math.min(100, activeShareCount * 18) : 0,
            tone: activeShareCount > 0 ? 'warning' : 'status',
          });
        travelOverviewMetaEl.innerHTML =
          '<span>checked ' + fmtDateTime(travelData.checkedAt) + '</span>' +
          '<span>connector ' + escapeHtml(connector.name || 'n/a') + '</span>' +
          '<span>' + String((connector.advertisedRoutes || []).length) + ' advertised route(s)</span>';
        travelOverviewDetailEl.textContent = connector.detail || 'travel snapshot loaded';
        travelBundlesMetaEl.textContent = bundles.length + ' bundle' + (bundles.length === 1 ? '' : 's');
        travelBundlesEl.innerHTML = bundles.map((bundle) => {
          const targets = Array.isArray(bundle.targets) ? bundle.targets : [];
          const items = targets.length
            ? targets.map((target) =>
              '<li class="travel-target-item">' +
                '<div class="travel-target-head">' +
                  '<a href="' + escapeHtml(target.url || '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(target.name || target.id || 'target') + '</a>' +
                  travelStatusPill(target.state) +
                '</div>' +
                '<div class="travel-target-meta">' + escapeHtml(String(target.access || 'tailnet-private').replace(/-/g, ' ')) + ' · ' + escapeHtml(target.detail || 'no probe detail') + '</div>' +
              '</li>'
            ).join('')
            : '<li class="travel-target-item travel-target-empty"><span class="muted">no targets in this bundle.</span></li>';
          return (
            '<article class="support-card travel-card">' +
              '<div class="travel-card-head"><div class="support-card-title">' + escapeHtml(bundle.name || bundle.id || 'bundle') + '</div>' + travelStatusPill(bundle.state) + '</div>' +
              '<p class="support-copy">' + escapeHtml(bundle.description || 'No description.') + '</p>' +
              '<ul class="travel-target-list">' + items + '</ul>' +
            '</article>'
          );
        }).join('');

        travelActionStateEl.textContent =
          'transmission ' + (transmission.desiredMode || 'unknown') +
          ' · ' + activeShareCount + ' active share' + (activeShareCount === 1 ? '' : 's');
        travelNotesMetaEl.textContent = notes.length + ' note' + (notes.length === 1 ? '' : 's');
        travelSharesEl.innerHTML = activeServices.length
          ? activeServices.map((svc) =>
            '<div class="travel-share-item">' +
              '<a href="' + escapeHtml(svc.publicUrl || '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(svc.name || svc.id || 'service') + '</a>' +
              '<span class="travel-share-meta">' + escapeHtml(svc.authMode || 'none') + ' · ' + escapeHtml(fmtExpiry(svc.expiresAt).text) + '</span>' +
            '</div>'
          ).join('')
          : '<p class="support-copy">No temporary public shares are active.</p>';
        travelNotesEl.innerHTML = notes.length
          ? notes.map((note) =>
            '<div class="travel-note-item">' + travelStatusPill(note.level === 'warn' ? 'degraded' : 'ready') +
              '<span>' + escapeHtml(note.message || '') + '</span></div>'
          ).join('')
          : '<p class="support-copy">No additional travel notes right now.</p>';

        if (travelDirectBtn) {
          travelDirectBtn.disabled = mutationInFlight > 0 || transmission.desiredMode === 'direct';
          travelDirectBtn.classList.toggle('mode-active', transmission.desiredMode === 'direct');
        }
        if (travelVpnBtn) {
          travelVpnBtn.disabled = mutationInFlight > 0 || transmission.desiredMode === 'vpn';
          travelVpnBtn.classList.toggle('mode-active', transmission.desiredMode === 'vpn');
        }
        if (travelDisableSharesBtn) {
          travelDisableSharesBtn.disabled = mutationInFlight > 0 || activeShareCount === 0;
        }
      }

      function renderTransmissionVpn(status) {
        transmissionVpnState = status || null;
        if (!status) {
          vpnMetaEl.textContent = 'Transmission VPN status unavailable.';
          vpnDirectBtn.disabled = true;
          vpnEnableBtn.disabled = true;
          vpnDirectBtn.classList.remove('mode-active');
          vpnEnableBtn.classList.remove('mode-active');
          return;
        }
        const desiredMode = status.desiredMode || 'direct';
        const effectiveMode = status.effectiveMode || 'pending';
        const meta = [
          'desired: ' + desiredMode,
          'running: ' + effectiveMode,
          'default: ' + (status.defaultMode || 'direct'),
          'provider: ' + (status.provider || 'custom') + '/' + (status.vpnType || 'wireguard'),
        ];
        if (status.podName) meta.push('pod/' + status.podName);
        if (status.rolloutPending) meta.push('rollout pending');
        if (status.placeholderConfig) meta.push('placeholder credentials scaffolded');
        vpnMetaEl.textContent = meta.join(' | ');
        vpnDirectBtn.disabled = mutationInFlight > 0 || desiredMode === 'direct';
        vpnEnableBtn.disabled = mutationInFlight > 0 || desiredMode === 'vpn';
        vpnDirectBtn.classList.toggle('mode-active', desiredMode === 'direct');
        vpnEnableBtn.classList.toggle('mode-active', desiredMode === 'vpn');
        if (dashboardState.travel && dashboardState.travel.transmission) {
          dashboardState.travel.transmission = { ...dashboardState.travel.transmission, ...status };
          renderTravel(dashboardState.travel);
        }
      }

      function renderPlanner(tuning) {
        if (!tuning || !tuning.applyPreflight || !tuning.report) {
          tuningSummaryEl.textContent = 'Advisor data unavailable';
          tuningOverviewStripEl.innerHTML = '';
          tuningOverviewMetaEl.innerHTML = '';
          tuningOverviewDetailEl.textContent = 'advisor unavailable';
          plannerMetaEl.textContent = 'planner unavailable';
          plannerGridEl.innerHTML = '<article class="support-card"><div class="support-card-title">apply preflight</div><p class="support-copy">resource-advisor data is unavailable from the exporter.</p></article>';
          tuningFocusMetaEl.textContent = 'advisor unavailable';
          tuningFocusGridEl.innerHTML = buildFocusCard('largest memory shifts', 'absolute request-memory deltas across all recommendations.', []);
          tuningControlMetaEl.textContent = 'advisor unavailable';
          tuningControlGridEl.innerHTML =
            '<article class="support-card"><div class="support-card-title">policy guardrails</div><p class="support-copy">no policy data available.</p></article>' +
            '<article class="support-card"><div class="support-card-title">common notes</div><p class="support-copy">no note data available.</p></article>';
          tuningTableMetaEl.textContent = '0 recommendations';
          tuningRuntimeMetaEl.textContent = 'advisor unavailable';
          runtimeLinesEl.innerHTML = renderRuntimeMarkdown('');
          noteFilterEl.innerHTML = '<option value="all">all notes</option>';
          tuningRowsEl.innerHTML = '';
          tuningEmptyEl.hidden = false;
          tuningCountEl.textContent = '0 visible rows';
          return;
        }

        const report = tuning.report;
        const apply = tuning.applyPreflight;
        const summary = report.summary || {};
        const selected = Array.isArray(apply.selected) ? apply.selected : [];
        const skipSummary = Array.isArray(apply.skipSummary) ? apply.skipSummary : [];
        const budgets = apply.budgets || {};
        const current = apply.currentRequests || {};
        const projected = apply.projectedRequestsAfterSelected || {};
        const noteOptions = Array.isArray(report.topNotes) ? report.topNotes : [];
        const policy = report.policy || {};
        const budget = report.budget || {};
        const currentPct = budget.current_requests_percent_of_allocatable || {};
        const allocatable = budget.allocatable || {};
        const coverageDays = Number(report.metricsCoverageDaysEstimate || 0);
        const metricsWindow = report.metricsWindow || 'advisor window';
        const selectedCount = Number(apply.selectedCount || 0);
        const recommendationCount = Number(report.recommendationCount || 0);
        const summaryWindowLabel = metricsWindow.replace(/^\\s+|\\s+$/g, '');
        const summaryData = report.summary || {};
        const currentCpuM = Number(summaryData.total_current_requests_cpu_m || 0);
        const recommendedCpuM = Number(summaryData.total_recommended_requests_cpu_m || 0);
        const currentMemMi = Number(summaryData.total_current_requests_memory_mi || 0);
        const recommendedMemMi = Number(summaryData.total_recommended_requests_memory_mi || 0);

        tuningSummaryEl.textContent = String(recommendationCount) + ' recommendations · ' + String(selectedCount) + ' selected now';
        tuningOverviewStripEl.innerHTML =
          overviewSegment('recommendations', String(recommendationCount), String(summary.upsize_count || 0) + ' upsize, ' + String(summary.downsize_count || 0) + ' downsize, ' + String(summary.no_change_count || 0) + ' steady', {
            eyebrow: String(summary.containers_with_metrics || 0) + '/' + String(summary.containers_analyzed || 0) + ' with metrics',
            barPct: Number(summary.containers_analyzed || 0) ? Number(summary.containers_with_metrics || 0) / Number(summary.containers_analyzed || 0) * 100 : 0,
            tone: 'neutral',
          }) +
          overviewSegment('cpu request posture', withUnitSpace(String(Math.round(currentCpuM)) + 'm'), String(currentPct.cpu || 0).replace(/\\.0$/, '') + '% of ' + withUnitSpace(String(allocatable.cpu || 'n/a')) + ' allocatable', {
            eyebrow: withUnitSpace(fmtSigned(recommendedCpuM - currentCpuM, 'm', 0)),
            barPct: Number(currentPct.cpu || 0),
            tone: 'warning',
          }) +
          overviewSegment('memory request posture', withUnitSpace(String(Math.round(currentMemMi)) + 'Mi'), String(currentPct.memory || 0).replace(/\\.0$/, '') + '% of ' + withUnitSpace(String(allocatable.memory || 'n/a')) + ' allocatable', {
            eyebrow: withUnitSpace(fmtSigned(recommendedMemMi - currentMemMi, 'Mi', 0)),
            barPct: Number(currentPct.memory || 0),
            tone: 'danger',
          }) +
          overviewSegment('planner', selectedCount + ' selected', 'hard fit ' + (apply.hardFitOk ? 'ok' : 'blocked') + ' · cpu pressure ' + (apply.advisoryPressure && apply.advisoryPressure.cpu ? 'on' : 'off'), {
            eyebrow: 'apply preflight',
            barPct: recommendationCount ? selectedCount / recommendationCount * 100 : 0,
            tone: apply.hardFitOk ? 'status' : 'warning',
          });
        tuningOverviewMetaEl.innerHTML =
          '<span>last run ' + fmtDateTime(tuning.fetch && tuning.fetch.lastRunAt) + '</span>' +
          '<span>browser tz ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '</span>' +
          '<span>mode ' + (tuning.fetch && tuning.fetch.mode ? tuning.fetch.mode : 'n/a') + '</span>' +
          '<span>allocatable <strong>' + withUnitSpace(String(allocatable.cpu || 'n/a')) + '</strong> cpu <strong>' + withUnitSpace(String(allocatable.memory || 'n/a')) + '</strong> memory</span>';
        tuningOverviewDetailEl.textContent = tuning.fetch && tuning.fetch.detail ? tuning.fetch.detail : 'advisor unavailable';
        plannerMetaEl.textContent = String(selectedCount) + ' selected right now';
        tuningFocusMetaEl.textContent = withUnitSpace(String(coverageDays).replace(/\\.0$/, '') + 'd') + ' of metrics coverage';
        tuningControlMetaEl.textContent = String(recommendationCount) + ' total recommendations';
        tuningTableMetaEl.textContent = String(recommendationCount) + ' visible in current report';

        const selectedMarkup = selected.slice(0, 5).map((item) => {
          const currentReq = item && item.current && item.current.requests ? item.current.requests : {};
          const recommendedReq = item && item.recommended && item.recommended.requests ? item.recommended.requests : {};
          return '<li><span class="focus-path">' + (item.release || 'unknown') + '/' + (item.container || 'main') + '</span><span class="focus-inline">cpu ' + withUnitSpace(currentReq.cpu || '0m') + ' → ' + withUnitSpace(recommendedReq.cpu || '0m') + ' · mem ' + withUnitSpace(currentReq.memory || '0Mi') + ' → ' + withUnitSpace(recommendedReq.memory || '0Mi') + ' · ' + String(item.selection_reason || 'selected').replace(/_/g, ' ') + '</span></li>';
        }).join('');

        const postureMarkup = [
          '<li><span class="focus-path">current requests</span><span class="focus-inline">cpu ' + withUnitSpace((current.cpu_m || 0) + 'm') + ' · mem ' + withUnitSpace((current.memory_mi || 0) + 'Mi') + '</span></li>',
          '<li><span class="focus-path">projected after selection</span><span class="focus-inline">cpu ' + withUnitSpace((projected.cpu_m || 0) + 'm') + ' · mem ' + withUnitSpace((projected.memory_mi || 0) + 'Mi') + '</span></li>',
          '<li><span class="focus-path">advisory ceilings</span><span class="focus-inline">cpu ' + withUnitSpace((budgets.cpu_m || 0) + 'm') + ' · mem ' + withUnitSpace((budgets.memory_mi || 0) + 'Mi') + '</span></li>'
        ].join('');

        const skippedMarkup = skipSummary.slice(0, 5).map((item) => {
          return '<li><span class="focus-path">' + String(item.reason || 'unknown').replace(/_/g, ' ') + '</span><span class="focus-inline">' + String(item.count || 0) + ' row(s)</span></li>';
        }).join('');

        plannerGridEl.innerHTML =
          '<article class="support-card"><div class="support-card-title">if apply ran now</div><div class="planner-lead"><div class="policy-grid">' +
            statPill('hard fit', apply.hardFitOk ? 'ok' : 'blocked', apply.hardFitOk ? 'ok' : 'excluded') +
            statPill('cpu pressure', apply.advisoryPressure && apply.advisoryPressure.cpu ? 'on' : 'off', apply.advisoryPressure && apply.advisoryPressure.cpu ? 'guarded' : 'ok') +
            statPill('mem pressure', apply.advisoryPressure && apply.advisoryPressure.memory ? 'on' : 'off', apply.advisoryPressure && apply.advisoryPressure.memory ? 'guarded' : 'ok') +
          '</div></div><ul class="focus-list">' + (selectedMarkup || '<li><span class="muted">no changes would be selected from the current report.</span></li>') + '</ul><p class="support-copy">selection uses per-service tuning signals, hard node-fit blocking, and advisory cluster pressure for ordering only.</p></article>' +
          '<article class="support-card"><div class="support-card-title">planner posture</div><ul class="focus-list">' + postureMarkup + '</ul><p class="support-copy">advisory pressure remains visible, but hard node-fit stays the gate.</p></article>' +
          '<article class="support-card"><div class="support-card-title">skip summary</div><ul class="focus-list">' + (skippedMarkup || '<li><span class="muted">no skipped rows in current snapshot.</span></li>') + '</ul><p class="support-copy">current reasons rows were deferred from the live apply selection order.</p></article>';

        const recommendations = Array.isArray(report.recommendations) ? report.recommendations.slice() : [];
        const biggestMem = recommendations
          .slice()
          .sort((left, right) => {
            const leftCurrent = left.current && left.current.requests ? left.current.requests : {};
            const leftRecommended = left.recommended && left.recommended.requests ? left.recommended.requests : {};
            const rightCurrent = right.current && right.current.requests ? right.current.requests : {};
            const rightRecommended = right.recommended && right.recommended.requests ? right.recommended.requests : {};
            return Math.abs(parseMemToMi(rightRecommended.memory) - parseMemToMi(rightCurrent.memory)) - Math.abs(parseMemToMi(leftRecommended.memory) - parseMemToMi(leftCurrent.memory));
          })
          .slice(0, 4)
          .map((row) => {
            const currentReq = row.current && row.current.requests ? row.current.requests : {};
            const recommendedReq = row.recommended && row.recommended.requests ? row.recommended.requests : {};
            const deltaMem = parseMemToMi(recommendedReq.memory) - parseMemToMi(currentReq.memory);
            return '<span class="focus-path">' + (row.namespace || 'default') + '/' + (row.workload || 'unknown') + '</span><span class="focus-inline">' + (row.container || 'main') + ' · ' + withUnitSpace(fmtSigned(deltaMem, 'Mi', 0)) + ' memory shift</span>';
          });
        const restartGuarded = recommendations
          .filter((row) => Array.isArray(row.notes) && row.notes.includes('restart_guard'))
          .slice(0, 4)
          .map((row) => '<span class="focus-path">' + (row.namespace || 'default') + '/' + (row.workload || 'unknown') + '</span><span class="focus-inline">' + (row.container || 'main') + ' · ' + String(row.restarts_window || 0) + ' historical restarts / ' + summaryWindowLabel + '</span>');
        const highestRestarts = recommendations
          .slice()
          .sort((left, right) => Number(right.restarts_window || 0) - Number(left.restarts_window || 0))
          .slice(0, 4)
          .map((row) => '<span class="focus-path">' + (row.namespace || 'default') + '/' + (row.workload || 'unknown') + '</span><span class="focus-inline">' + (row.container || 'main') + ' · ' + String(row.restarts_window || 0) + ' historical restarts / ' + summaryWindowLabel + '</span>');
        tuningFocusGridEl.innerHTML =
          buildFocusCard('largest memory shifts', 'absolute request-memory deltas across all recommendations.', biggestMem) +
          buildFocusCard('restart-guarded items', 'rows where historical restart activity is directly influencing the advice.', restartGuarded) +
          buildFocusCard('highest restart volume', 'most restart-heavy rows in the historical advisor window.', highestRestarts);

        const noteMarkup = noteOptions.length
          ? noteOptions.map((item) => '<span class="note-pill ' + noteTone(item.note) + '">' + item.note.replace(/_/g, ' ') + ' <strong>' + item.count + '</strong></span>').join('')
          : '<span class="muted">no recurring notes in the current snapshot.</span>';
        tuningControlGridEl.innerHTML =
          '<article class="support-card"><div class="support-card-title">policy guardrails</div><div class="policy-grid">' +
            tokenPill('step', String(policy.max_step_percent || 0).replace(/\\.0$/, '') + '%') +
            tokenPill('req buffer', String(policy.request_buffer_percent || 0).replace(/\\.0$/, '') + '%') +
            tokenPill('limit buffer', String(policy.limit_buffer_percent || 0).replace(/\\.0$/, '') + '%') +
            tokenPill('deadband', String(policy.deadband_percent || 0).replace(/\\.0$/, '') + '%') +
            tokenPill('cpu floor', withUnitSpace(String(policy.deadband_cpu_m || 0) + 'm')) +
            tokenPill('mem floor', withUnitSpace(String(policy.deadband_mem_mi || 0) + 'Mi')) +
          '</div><p class="support-copy">active tuning bounds applied to each report and apply pass.</p></article>' +
          '<article class="support-card"><div class="support-card-title">common notes</div><div class="policy-grid">' + noteMarkup + '</div><p class="support-copy">most common skip reasons and advisory annotations in the current window.</p></article>';

        noteFilterEl.innerHTML = '<option value="all">all notes</option>' + noteOptions.map((item) => '<option value="' + item.note + '">' + item.note + ' (' + item.count + ')</option>').join('');
        tuningRuntimeMetaEl.textContent = 'window ' + (report.metricsWindow || 'n/a') + ' · last run ' + fmtDateTime(tuning.fetch && tuning.fetch.lastRunAt);
        runtimeLinesEl.innerHTML = renderRuntimeMarkdown(tuning.runtime && tuning.runtime.latestMarkdown);
      }

      function renderTuningRows() {
        const tuning = dashboardState.tuning;
        const rows = tuning && tuning.report && Array.isArray(tuning.report.recommendations) ? tuning.report.recommendations : [];
        tuningRowsEl.innerHTML = '';
        const query = (searchInputEl.value || '').trim().toLowerCase();
        const noteValue = noteFilterEl.value || 'all';
        let visible = 0;

        rows.forEach((row) => {
          const notes = Array.isArray(row.notes) ? row.notes : [];
          const action = String(row.action || 'unknown');
          const currentReq = row.current && row.current.requests ? row.current.requests : {};
          const recommendedReq = row.recommended && row.recommended.requests ? row.recommended.requests : {};
          const searchBlob = [row.namespace, row.workload, row.container, row.release, action, notes.join(' '), currentReq.cpu, currentReq.memory, recommendedReq.cpu, recommendedReq.memory].join(' ').toLowerCase();
          const actionMatch = tuningFilterAction === 'all' || action === tuningFilterAction;
          const noteMatch = noteValue === 'all' || notes.includes(noteValue);
          const searchMatch = !query || searchBlob.includes(query);
          if (!actionMatch || !noteMatch || !searchMatch) return;
          visible += 1;

          const currentCpu = String(currentReq.cpu || '0m');
          const currentMem = String(currentReq.memory || '0Mi');
          const recommendedCpu = String(recommendedReq.cpu || '0m');
          const recommendedMem = String(recommendedReq.memory || '0Mi');
          const cpuDelta = Number(String(recommendedCpu).replace(/m$/, '')) - Number(String(currentCpu).replace(/m$/, ''));
          const memDelta = Number(String(recommendedMem).replace(/Mi$/, '')) - Number(String(currentMem).replace(/Mi$/, ''));
          const notesMarkup = notes.length ? notes.map((note) => '<span class="note-pill ' + noteTone(note) + '">' + note.replace(/_/g, ' ') + '</span>').join('') : '<span class="muted">—</span>';

          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td><div class="workload">' + (row.workload || 'unknown') + '</div><div class="workload-meta">' + (row.namespace || 'default') + ' · ' + (row.release || 'n/a') + ' · ' + (row.container || 'main') + '</div></td>' +
            '<td><span class="action ' + action + '">' + action + '</span></td>' +
            '<td><div class="metric-pair"><span>' + withUnitSpace(currentCpu) + '</span><span class="arrow">→</span><span>' + withUnitSpace(recommendedCpu) + '</span></div><div class="metric-delta ' + (cpuDelta > 0 ? 'positive' : cpuDelta < 0 ? 'negative' : 'neutral') + '">' + withUnitSpace(fmtSigned(cpuDelta, 'm', 0)) + '</div></td>' +
            '<td><div class="metric-pair"><span>' + withUnitSpace(currentMem) + '</span><span class="arrow">→</span><span>' + withUnitSpace(recommendedMem) + '</span></div><div class="metric-delta ' + (memDelta > 0 ? 'positive' : memDelta < 0 ? 'negative' : 'neutral') + '">' + withUnitSpace(fmtSigned(memDelta, 'Mi', 0)) + '</div></td>' +
            '<td><div class="usage-line">p95 ' + withUnitSpace(String(row.cpu_p95_m || 0) + 'm') + ' · ' + withUnitSpace(String(row.mem_p95_mi || 0) + 'Mi') + '</div><div class="workload-meta">' + String(row.replicas || 0) + ' replica(s)</div></td>' +
            '<td><div class="usage-line">' + withUnitSpace(String((tuning.report && tuning.report.metricsCoverageDaysEstimate) || 0).replace(/\\.0$/, '') + 'd') + '</div><div class="workload-meta">' + ((tuning.report && tuning.report.metricsWindow) || 'advisor window') + '</div></td>' +
            '<td><div class="usage-line">' + String(row.restarts_window || 0) + ' historical / 14d</div><div class="workload-meta">current live restarts: ' + String(row.current_restarts || 0) + ' on ' + String(row.matched_pods || 0) + ' pod(s)</div></td>' +
            '<td><div class="notes-cell">' + notesMarkup + '</div></td>';
          tuningRowsEl.appendChild(tr);
        });

        tuningCountEl.textContent = visible + ' visible row' + (visible === 1 ? '' : 's');
        tuningEmptyEl.hidden = visible !== 0;
      }

      function renderRows(services) {
        rowsEl.innerHTML = '';
        if (!services.length) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 6;
          td.className = 'empty-state';
          td.textContent = 'No services configured.';
          tr.appendChild(td);
          rowsEl.appendChild(tr);
          return;
        }
        services.forEach((svc) => {
          const tr = document.createElement('tr');
          if (svc.enabled) tr.classList.add('is-enabled');
          const expiry = fmtExpiry(svc.expiresAt);

          const serviceTd = document.createElement('td');
          const serviceName = document.createElement('div');
          serviceName.className = 'svc-name';
          serviceName.textContent = svc.name || 'unknown';
          const serviceId = document.createElement('div');
          serviceId.className = 'svc-id';
          serviceId.textContent = svc.id || 'n/a';
          serviceTd.append(serviceName, serviceId);

          const statusTd = document.createElement('td');
          const statusBadge = document.createElement('span');
          statusBadge.className = 'badge ' + (svc.enabled ? 'on' : 'off');
          statusBadge.textContent = svc.enabled ? 'enabled' : 'disabled';
          statusTd.appendChild(statusBadge);

          const authTd = document.createElement('td');
          const authMode = document.createElement('span');
          authMode.className = 'auth-mode';
          authMode.textContent = svc.authMode === 'cloudflare-access' ? 'cf-access' : String(svc.authMode || 'none');
          authTd.appendChild(authMode);

          const urlTd = document.createElement('td');
          const publicLink = document.createElement('a');
          publicLink.href = String(svc.publicUrl || '#');
          publicLink.target = '_blank';
          publicLink.rel = 'noreferrer';
          publicLink.textContent = String(svc.publicHost || '');
          urlTd.appendChild(publicLink);

          const expiryTd = document.createElement('td');
          const expiryNode = document.createElement('span');
          expiryNode.className = 'expiry ' + expiry.state;
          expiryNode.dataset.expiresAt = String(svc.expiresAt || '');
          expiryNode.dataset.enabled = svc.enabled ? '1' : '0';
          expiryNode.textContent = expiry.text;
          expiryTd.appendChild(expiryNode);

          tr.append(serviceTd, statusTd, authTd, urlTd, expiryTd);

          const controlsTd = document.createElement('td');
          const controls = document.createElement('div');
          controls.className = 'controls';

          const expirySelect = document.createElement('select');
          expirySelect.className = 'control-select';
          [0.25, 0.5, 1, 2, 6, 12, 24].forEach((hours) => {
            const opt = document.createElement('option');
            opt.value = String(hours);
            opt.textContent = hours < 1 ? Math.round(hours * 60) + 'm' : String(hours) + 'h';
            if (hours === Number(svc.defaultExpiryHours || 1)) opt.selected = true;
            expirySelect.appendChild(opt);
          });

          const authSelect = document.createElement('select');
          authSelect.className = 'control-select';
          ['none', 'cloudflare-access'].forEach((mode) => {
            const opt = document.createElement('option');
            opt.value = mode;
            opt.textContent = mode === 'cloudflare-access' ? 'cf-access' : mode;
            if (mode === 'none') opt.selected = true;
            authSelect.appendChild(opt);
          });

          const enableBtn = document.createElement('button');
          enableBtn.textContent = 'Enable';
          enableBtn.onclick = async () => {
            try {
              mutationInFlight += 1;
              enableBtn.disabled = true;
              await request('/api/services/' + svc.id + '/enable', 'POST', {
                hours: Number(expirySelect.value),
                authMode: authSelect.value,
              });
              setMsg('Enabled ' + svc.id);
              await loadDashboard({ silent: true });
            } catch (err) {
              setMsg(err.message, true);
            } finally {
              mutationInFlight = Math.max(0, mutationInFlight - 1);
            }
          };

          const disableBtn = document.createElement('button');
          disableBtn.textContent = 'Disable';
          disableBtn.className = 'danger';
          disableBtn.onclick = async () => {
            try {
              mutationInFlight += 1;
              disableBtn.disabled = true;
              await request('/api/services/' + svc.id + '/disable', 'POST');
              setMsg('Disabled ' + svc.id);
              await loadDashboard({ silent: true });
            } catch (err) {
              setMsg(err.message, true);
            } finally {
              mutationInFlight = Math.max(0, mutationInFlight - 1);
            }
          };

          controls.append(expirySelect, authSelect, enableBtn, disableBtn);
          controlsTd.appendChild(controls);
          tr.appendChild(controlsTd);
          rowsEl.appendChild(tr);
        });
        tickExpiryCountdowns();
      }

      function renderAudit(entries) {
        auditRowsEl.innerHTML = '';
        if (!entries.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="4" class="empty-state">No audit entries yet.</td>';
          auditRowsEl.appendChild(tr);
          return;
        }
        entries.forEach((entry) => {
          const tr = document.createElement('tr');
          const parts = [];
          if (entry.hours) parts.push(entry.hours + 'h');
          if (entry.authMode) parts.push(entry.authMode);
          if (entry.mode) parts.push('mode: ' + entry.mode);
          if (entry.disabled != null) parts.push('disabled: ' + entry.disabled);
          const actionClass = entry.action === 'enable'
            ? 'action-enable'
            : entry.action === 'disable'
              ? 'action-disable'
              : entry.action === 'transmission-vpn-set'
                ? 'action-enable'
                : 'action-emergency';
          tr.innerHTML =
            '<td class="audit-time">' + fmtDateTime(entry.ts) + '</td>' +
            '<td class="audit-action ' + actionClass + '">' + (entry.action || '') + '</td>' +
            '<td>' + (entry.serviceId || '') + '</td>' +
            '<td class="audit-detail">' + parts.join(' · ') + '</td>';
          auditRowsEl.appendChild(tr);
        });
      }

      function renderUpdates(payload) {
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        updatesRowsEl.innerHTML = '';
        if (!items.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="5" class="empty-state">No update rows available.</td>';
          updatesRowsEl.appendChild(tr);
        } else {
          items.forEach((item) => {
            const tr = document.createElement('tr');
            const nsPrefix = item.namespace ? item.namespace + '/' : '';
            tr.innerHTML =
              '<td><div class="svc-name">' + (item.name || item.id || '') + '</div><div class="svc-id">' + nsPrefix + (item.id || '') + '</div></td>' +
              '<td class="updates-version updates-cell-center">' + (item.currentVersion || '—') + '</td>' +
              '<td class="updates-version updates-cell-center">' + (item.latestVersion || '—') + '</td>' +
              '<td class="updates-cell-center"><span class="update-chip ' + (item.status || 'unknown') + '">' + String(item.statusText || 'unknown').toLowerCase() + '</span></td>' +
              '<td><div class="updates-version">' + (item.imageRepo || item.image || '—') + '</div><div class="updates-sub">' + [item.detail, item.pod ? 'pod/' + item.pod : ''].filter(Boolean).join(' · ') + '</div></td>';
            updatesRowsEl.appendChild(tr);
          });
        }
        const checkedAt = payload && payload.checkedAt ? fmtDateTime(payload.checkedAt) : 'not checked yet';
        const nextCheckAt = payload && payload.nextCheckAt ? fmtDateTime(payload.nextCheckAt) : 'unknown';
        const source = payload && payload.source ? payload.source : 'unknown';
        const staleText = payload && payload.stale ? ' · stale cache' : '';
        const refreshingText = payload && payload.refreshInProgress ? ' · background refresh running' : '';
        updatesMetaEl.textContent = 'Checked: ' + checkedAt + ' | Next check: ' + nextCheckAt + ' | Source: ' + source + staleText + refreshingText;
      }

      async function loadUpdates(options) {
        const force = Boolean(options && options.force);
        if (force) {
          updatesRefreshBtn.disabled = true;
          setLoadState('Checking image updates...');
          setMsg('Checking image updates...');
          setUpdatesMsg('Checking registries...');
        }
        try {
          const path = force ? '/api/image-updates?force=1' : '/api/image-updates';
          const payload = await request(path, 'GET');
          dashboardState.updates = payload;
          renderUpdates(payload);
          renderOverview();
          if (payload.stale) {
            setUpdatesMsg('Showing cached data while background refresh runs.');
            if (force) {
              setLoadState('Image update check running in background...');
              setMsg('Image update check started.');
            }
          } else {
            setUpdatesMsg('Update report loaded.');
            if (force) {
              setLoadState('Image updates checked at ' + new Date().toLocaleTimeString());
              setMsg('Image update check complete.');
            }
          }
        } catch (err) {
          setUpdatesMsg(err.message, true);
          if (force) {
            setLoadState(err.message, true);
            setMsg(err.message, true);
          }
        } finally {
          if (force) updatesRefreshBtn.disabled = false;
        }
      }

      async function loadDashboard(options) {
        const silent = Boolean(options && options.silent);
        if (!silent) {
          setLoadState('Refreshing dashboard...');
          setMsg('Refreshing...');
          setVpnMsg('Refreshing Transmission VPN status...');
          setUpdatesMsg('Loading cached update report...');
          setTravelMsg('Refreshing travel readiness...');
        }

        try {
          const [svcData, auditData, vpnData, tuningData, updatesData, travelData] = await Promise.allSettled([
            request('/api/services', 'GET'),
            request('/api/audit', 'GET'),
            request('/api/transmission-vpn', 'GET'),
            request('/api/tuning', 'GET'),
            request('/api/image-updates', 'GET'),
            request('/api/travel', 'GET'),
          ]);

          if (svcData.status !== 'fulfilled') throw svcData.reason;
          dashboardState.services = svcData.value.services || [];
          renderRows(dashboardState.services);
          if (auditData.status === 'fulfilled') {
            dashboardState.audit = auditData.value.entries || [];
            renderAudit(dashboardState.audit);
          }
          if (vpnData.status === 'fulfilled') {
            dashboardState.vpn = vpnData.value;
            renderTransmissionVpn(dashboardState.vpn);
            if (!silent) setVpnMsg('');
          } else {
            dashboardState.vpn = null;
            renderTransmissionVpn(null);
            setVpnMsg(vpnData.reason.message, true);
          }
          if (tuningData.status === 'fulfilled') {
            dashboardState.tuning = tuningData.value;
            renderPlanner(dashboardState.tuning);
            renderTuningRows();
          } else {
            dashboardState.tuning = null;
            renderPlanner(null);
          }
          if (updatesData.status === 'fulfilled') {
            dashboardState.updates = updatesData.value;
            renderUpdates(dashboardState.updates);
            if (!silent) setUpdatesMsg('Update report loaded.');
          } else {
            dashboardState.updates = null;
            renderUpdates({ items: [] });
            setUpdatesMsg(updatesData.reason.message, true);
          }
          if (travelData && travelData.status === 'fulfilled') {
            dashboardState.travel = travelData.value;
            renderTravel(dashboardState.travel);
            if (!silent) setTravelMsg('');
          } else {
            dashboardState.travel = null;
            renderTravel(null);
            if (travelData && !silent) setTravelMsg(travelData.reason.message, true);
          }

          renderOverview();
          setLoadState((silent ? 'Last refresh ' : 'Updated ') + new Date().toLocaleTimeString());
          if (!silent) setMsg('Exposure state updated.');
        } catch (err) {
          setLoadState(err.message, true);
          if (!silent) setMsg(err.message, true);
        }
      }

      refreshAllBtn.onclick = () => loadDashboard();
      updatesRefreshBtn.onclick = () => loadUpdates({ force: true });

      emergencyBtn.onclick = async () => {
        if (!confirm('Disable ALL temporary exposures?')) return;
        try {
          mutationInFlight += 1;
          emergencyBtn.disabled = true;
          await request('/api/admin/disable-all', 'POST');
          setMsg('All exposures disabled');
          await loadDashboard({ silent: true });
        } catch (err) {
          setMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          emergencyBtn.disabled = false;
        }
      };

      async function setTransmissionVpnMode(mode) {
        const nextMode = mode === 'vpn' ? 'vpn' : 'direct';
        const prompt = nextMode === 'vpn'
          ? 'Route Transmission through the VPN sidecar?'
          : 'Route Transmission directly through the normal network path?';
        if (!confirm(prompt)) return;
        try {
          mutationInFlight += 1;
          vpnDirectBtn.disabled = true;
          vpnEnableBtn.disabled = true;
          setVpnMsg('Applying ' + nextMode + ' mode...');
          const payload = await request('/api/transmission-vpn', 'POST', { mode: nextMode });
          renderTransmissionVpn(payload);
          setVpnMsg('Transmission desired route set to ' + nextMode + '. Flux will roll the pod if needed.');
          await loadDashboard({ silent: true });
        } catch (err) {
          setVpnMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          if (transmissionVpnState) renderTransmissionVpn(transmissionVpnState);
        }
      }

      vpnDirectBtn.onclick = () => setTransmissionVpnMode('direct');
      vpnEnableBtn.onclick = () => setTransmissionVpnMode('vpn');
      if (travelDirectBtn) travelDirectBtn.onclick = () => setTransmissionVpnMode('direct');
      if (travelVpnBtn) travelVpnBtn.onclick = () => setTransmissionVpnMode('vpn');

      if (travelDisableSharesBtn) {
        travelDisableSharesBtn.onclick = async () => {
          if (!confirm('Disable ALL temporary exposures?')) return;
          try {
            mutationInFlight += 1;
            travelDisableSharesBtn.disabled = true;
            emergencyBtn.disabled = true;
            await request('/api/admin/disable-all', 'POST');
            setTravelMsg('All exposures disabled');
            setMsg('All exposures disabled');
            await loadDashboard({ silent: true });
          } catch (err) {
            setTravelMsg(err.message, true);
          } finally {
            mutationInFlight = Math.max(0, mutationInFlight - 1);
            emergencyBtn.disabled = false;
          }
        };
      }

      if (travelExposureLink) {
        travelExposureLink.addEventListener('click', (event) => {
          event.preventDefault();
          setActivePage('exposure');
        });
      }

      pageLinks.forEach((link) => {
        link.addEventListener('click', (event) => {
          const target = normalizePage(link.getAttribute('href'));
          if (!target) return;
          event.preventDefault();
          setActivePage(target);
        });
      });

      document.querySelectorAll('[data-filter-action]').forEach((button) => {
        button.addEventListener('click', () => {
          tuningFilterAction = button.dataset.filterAction || 'all';
          document.querySelectorAll('[data-filter-action]').forEach((peer) => {
            peer.classList.toggle('active', peer === button);
          });
          renderTuningRows();
        });
      });
      noteFilterEl.addEventListener('change', renderTuningRows);
      searchInputEl.addEventListener('input', renderTuningRows);
      window.addEventListener('hashchange', () => {
        setActivePage(window.location.hash, { replace: true });
      });

      setInterval(tickExpiryCountdowns, 1000);
      setActivePage(window.location.hash || '#updates', { replace: true });
      loadDashboard();
