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
      const jobsSummaryEl = document.getElementById('jobsSummary');
      const jobsOverviewStripEl = document.getElementById('jobsOverviewStrip');
      const jobsOverviewMetaEl = document.getElementById('jobsOverviewMeta');
      const jobsOverviewDetailEl = document.getElementById('jobsOverviewDetail');
      const jobsRefreshBtn = document.getElementById('jobsRefreshBtn');
      const jobsMsgEl = document.getElementById('jobsMsg');
      const jobsListEl = document.getElementById('jobsList');
      const siteDeploySummaryEl = document.getElementById('siteDeploySummary');
      const siteDeployOverviewStripEl = document.getElementById('siteDeployOverviewStrip');
      const siteDeployRefreshBtn = document.getElementById('siteDeployRefreshBtn');
      const siteDeployAllBtn = document.getElementById('siteDeployAllBtn');
      const siteDeployListEl = document.getElementById('siteDeployList');
      const siteDeployMsgEl = document.getElementById('siteDeployMsg');
      const exposureMetaEl = document.getElementById('exposureMeta');
      const vpnSectionMetaEl = document.getElementById('vpnSectionMeta');
      const auditMetaEl = document.getElementById('auditMeta');
      const rowsEl = document.getElementById('rows');
      const auditRowsEl = document.getElementById('auditRows');
      const updatesRowsEl = document.getElementById('updatesRows');
      const updatesSearchInputEl = document.getElementById('updatesSearchInput');
      const updatesOnlyAvailableEl = document.getElementById('updatesOnlyAvailable');
      const renovateMetaEl = document.getElementById('renovateMeta');
      const renovateLinksEl = document.getElementById('renovateLinks');
      const vpnMetaEl = document.getElementById('vpnMeta');
      const transmissionPanelEl = document.getElementById('transmissionPanel');
      const msgEl = document.getElementById('msg');
      const vpnMsgEl = document.getElementById('vpnMsg');
      const renovateMsgEl = document.getElementById('renovateMsg');
      const updatesMsgEl = document.getElementById('updatesMsg');
      const updatesMetaEl = document.getElementById('updatesMeta');
      const travelMsgEl = document.getElementById('travelMsg');
      const refreshAllBtn = document.getElementById('refreshAllBtn');
      const emergencyBtn = document.getElementById('emergencyBtn');
      const themeModeButtons = Array.from(document.querySelectorAll('[data-theme-mode]'));
      const vpnSwitch = document.getElementById('vpnSwitch');
      const vpnToggleLabels = Array.from(document.querySelectorAll('[data-vpn-label]'));
      const travelDirectBtn = document.getElementById('travelDirectBtn');
      const travelVpnBtn = document.getElementById('travelVpnBtn');
      const travelDisableSharesBtn = document.getElementById('travelDisableSharesBtn');
      const travelExposureLink = document.getElementById('travelExposureLink');
      const renovateRunBtn = document.getElementById('renovateRunBtn');
      const updatesRefreshBtn = document.getElementById('updatesRefreshBtn');
      const helmUpdatesRowsEl = document.getElementById('helmUpdatesRows');
      const helmUpdatesMsgEl = document.getElementById('helmUpdatesMsg');
      const helmUpdatesMetaEl = document.getElementById('helmUpdatesMeta');
      const helmUpdatesRefreshBtn = document.getElementById('helmUpdatesRefreshBtn');
      const secretsSummaryEl = document.getElementById('secretsSummary');
      const secretsSearchInputEl = document.getElementById('secretsSearchInput');
      const secretsNamespaceFilterEl = document.getElementById('secretsNamespaceFilter');
      const secretsRefreshBtn = document.getElementById('secretsRefreshBtn');
      const secretsListEl = document.getElementById('secretsList');
      const secretsMsgEl = document.getElementById('secretsMsg');
      const newSecretNameEl = document.getElementById('newSecretName');
      const newSecretBtn = document.getElementById('newSecretBtn');
      const secretEditorTitleEl = document.getElementById('secretEditorTitle');
      const secretEditorMetaEl = document.getElementById('secretEditorMeta');
      const secretAddKeyBtn = document.getElementById('secretAddKeyBtn');
      const secretSaveBtn = document.getElementById('secretSaveBtn');
      const secretDeleteBtn = document.getElementById('secretDeleteBtn');
      const secretKeyRowsEl = document.getElementById('secretKeyRows');
      const pageSections = Array.from(document.querySelectorAll('[data-page-section]'));
      const pageLinks = Array.from(document.querySelectorAll('[data-page-link]'));

      let mutationInFlight = 0;
      let pendingExpiryRefresh = false;
      let transmissionVpnState = null;
      let tuningFilterAction = 'all';
      let updatesFilterQuery = '';
      let updatesOnlyAvailable = false;
      let dashboardState = {
        services: [],
        audit: [],
        vpn: null,
        renovate: null,
        updates: null,
        helmUpdates: null,
        travel: null,
        tuning: null,
        jobs: null,
        siteDeployments: null,
        secrets: null,
        selectedSecret: null,
      };
      let activePage = normalizePage(window.location.hash || '#updates');
      let hasLoadedDashboard = false;
      const themeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

      function storedThemeMode() {
        const mode = localStorage.getItem('rp-theme-mode') || 'system';
        return mode === 'light' || mode === 'dark' ? mode : 'system';
      }

      function resolvedThemeMode(mode) {
        if (mode === 'dark' || mode === 'light') return mode;
        return themeMedia && themeMedia.matches ? 'dark' : 'light';
      }

      function applyThemeMode(mode) {
        const nextMode = mode === 'light' || mode === 'dark' ? mode : 'system';
        if (nextMode === 'system') {
          document.documentElement.removeAttribute('data-theme');
          localStorage.removeItem('rp-theme-mode');
        } else {
          document.documentElement.dataset.theme = nextMode;
          localStorage.setItem('rp-theme-mode', nextMode);
        }
        const resolved = resolvedThemeMode(nextMode);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#000000' : '#ffffff');
        themeModeButtons.forEach((button) => {
          const active = button.dataset.themeMode === nextMode;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }

      /* ------------------------------------------------ segmented switches */

      function setupSegSwitch(container) {
        const thumb = container.querySelector('.seg-thumb');
        const buttons = Array.from(container.querySelectorAll('button'));
        if (!thumb || !buttons.length) return;
        let positioned = false;
        function sync() {
          container.classList.toggle('is-busy', buttons.some((b) => b.classList.contains('is-loading')));
          const active = buttons.find((b) => b.classList.contains('active') || b.classList.contains('mode-active')) || null;
          if (!active) {
            container.classList.remove('seg-ready');
            positioned = false;
            return;
          }
          if (!positioned) thumb.style.transition = 'none';
          thumb.style.transform = 'translateX(' + active.offsetLeft + 'px)';
          thumb.style.width = active.offsetWidth + 'px';
          if (!positioned) {
            void thumb.offsetWidth;
            thumb.style.transition = '';
            positioned = true;
          }
          container.classList.add('seg-ready');
        }
        const classObserver = new MutationObserver(sync);
        buttons.forEach((b) => classObserver.observe(b, { attributes: true, attributeFilter: ['class'] }));
        if (window.ResizeObserver) {
          const sizeObserver = new ResizeObserver(sync);
          sizeObserver.observe(container);
          buttons.forEach((b) => sizeObserver.observe(b));
        } else {
          window.addEventListener('resize', sync);
        }
        sync();
      }

      document.querySelectorAll('.seg-switch').forEach((el) => setupSegSwitch(el));

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

      function setRenovateMsg(text, isError) {
        setMessage(renovateMsgEl, text, isError);
      }

      function setUpdatesMsg(text, isError) {
        setMessage(updatesMsgEl, text, isError);
      }

      function setTravelMsg(text, isError) {
        setMessage(travelMsgEl, text, isError);
      }

      function setHelmUpdatesMsg(text, isError) {
        setMessage(helmUpdatesMsgEl, text, isError);
      }

      function setSecretsMsg(text, isError) {
        setMessage(secretsMsgEl, text, isError);
      }

      function setJobsMsg(text, isError) {
        setMessage(jobsMsgEl, text, isError);
      }

      function setSiteDeployMsg(text, isError) {
        setMessage(siteDeployMsgEl, text, isError);
      }

      function normalizePage(value) {
        const candidate = String(value || '').replace(/^#/, '').trim().toLowerCase();
        if (candidate === 'overview' || candidate === 'audit' || candidate === 'transmission') return 'exposure';
        const knownPages = new Set(['updates', 'deploy', 'travel', 'exposure', 'tuning', 'jobs', 'secrets']);
        if (knownPages.has(candidate)) return candidate;
        return 'updates';
      }

      function setActivePage(page, options) {
        const requestedPage = String(page || '').replace(/^#/, '').trim().toLowerCase();
        const nextPage = normalizePage(page);
        const replace = Boolean(options && options.replace);
        activePage = nextPage;
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
        } else {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
        if (nextPage === 'secrets' && hasLoadedDashboard && !dashboardState.secrets) {
          secretsListEl.innerHTML = skeletonTableRows(1, 5);
          loadSecrets();
        }
        if (nextPage === 'jobs' && hasLoadedDashboard && !dashboardState.jobs) {
          jobsOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
          jobsListEl.innerHTML = '<div class="table-shell"><table><tbody>' + skeletonTableRows(4, 3) + '</tbody></table></div>';
          loadJobs();
        }
        if (nextPage === 'deploy' && hasLoadedDashboard && !dashboardState.siteDeployments) {
          siteDeployOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
          siteDeployListEl.innerHTML = '<div class="table-shell"><table><tbody>' + skeletonTableRows(4, 3) + '</tbody></table></div>';
          loadSiteDeployments();
        }
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
              await refreshServicesOnly();
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

      function attrText(value) {
        return escapeHtml(value).replace(/\n/g, '&#10;');
      }

      function normalizeMatchToken(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      }

      function normalizeRepoName(value) {
        return String(value || '').replace(/\.git$/i, '').trim();
      }

      function prMatchScore(pr, item, mode) {
        const haystack = normalizeMatchToken(String(pr && pr.title || '') + ' ' + String(pr && pr.headRefName || ''));
        if (!haystack) return 0;

        const candidates = mode === 'image'
          ? [item && item.imageRepo, item && item.name, item && item.id]
          : [item && item.chart, item && item.name, item && item.id];

        let best = 0;
        candidates.forEach((candidate) => {
          const normalized = normalizeMatchToken(candidate);
          if (!normalized || normalized.length < 4) return;
          if (haystack.includes(normalized)) best = Math.max(best, normalized.length);
        });
        return best;
      }

      function findMatchingRenovatePr(item, mode) {
        const prs = dashboardState.renovate && Array.isArray(dashboardState.renovate.openPrs)
          ? dashboardState.renovate.openPrs
          : [];
        let best = null;
        let bestScore = 0;
        prs.forEach((pr) => {
          const score = prMatchScore(pr, item, mode);
          if (score > bestScore) {
            best = pr;
            bestScore = score;
          }
        });
        return bestScore > 0 ? best : null;
      }

      function updateItemSearchText(item) {
        return [
          item && item.name,
          item && item.id,
          item && item.namespace,
          item && item.imageRepo,
          item && item.image,
          item && item.currentVersion,
          item && item.latestVersion,
          item && item.statusText,
          item && item.detail,
          item && item.pod,
        ].filter(Boolean).join(' ').toLowerCase();
      }

      function filteredUpdateItems(items) {
        const query = String(updatesSearchInputEl ? updatesSearchInputEl.value : updatesFilterQuery).trim().toLowerCase();
        const onlyAvailable = updatesOnlyAvailableEl ? updatesOnlyAvailableEl.checked : updatesOnlyAvailable;
        return items.filter((item) => {
          if (!item) return false;
          if (onlyAvailable && item.status !== 'update') return false;
          if (query && !updateItemSearchText(item).includes(query)) return false;
          return true;
        });
      }

      function versionTagHtml(value, className) {
        const text = value || '—';
        return '<span class="version-tag ' + className + '" title="' + attrText(text) + '" data-version-tooltip="' + attrText(text) + '">' + escapeHtml(text) + '</span>';
      }

      function versionDiffHtml(currentVersion, latestVersion, status) {
        const current = currentVersion || '—';
        const latest = latestVersion || '—';
        const hasUpdate = status === 'update' && current !== latest;
        const tooltip = hasUpdate ? current + ' → ' + latest : (latest !== '—' ? latest : current);
        if (!hasUpdate) {
          return (
            '<div class="updates-version-diff is-current" title="' + attrText(tooltip) + '" data-version-tooltip="' + attrText(tooltip) + '">' +
              versionTagHtml(latest !== '—' ? latest : current, 'version-single') +
            '</div>'
          );
        }
        return (
          '<div class="updates-version-diff is-update" title="' + attrText(tooltip) + '" data-version-tooltip="' + attrText(tooltip) + '">' +
            versionTagHtml(current, 'version-current') +
            '<span class="version-arrow">→</span>' +
            versionTagHtml(latest, 'version-latest') +
          '</div>'
        );
      }

      function setBtnLoading(btn, on) {
        if (!btn) return;
        btn.disabled = Boolean(on);
        btn.classList.toggle('is-loading', Boolean(on));
      }

      function skeletonLine(width, height) {
        return '<span class="skeleton-line" style="width:' + (width || '80%') + ';height:' + (height || '13px') + '"></span>';
      }

      function skeletonOverviewStrip(count) {
        let html = '';
        for (let i = 0; i < (count || 6); i++) {
          html +=
            '<section class="overview-segment">' +
              '<div class="overview-segment-head">' + skeletonLine('64px', '10px') + '</div>' +
              '<div class="overview-value" style="margin-top:18px">' + skeletonLine('52px', '36px') + '</div>' +
              '<div class="overview-subtitle" style="margin-top:12px">' + skeletonLine('110px', '10px') + '</div>' +
              '<div class="overview-meter" style="margin-top:28px"><span class="overview-meter-fill" style="width:0%"></span></div>' +
            '</section>';
        }
        return html;
      }

      function skeletonTableRows(cols, count) {
        let html = '';
        for (let i = 0; i < (count || 4); i++) {
          const tds = [];
          for (let c = 0; c < cols; c++) {
            const w = c === 0 ? '70%' : (c % 2 === 0 ? '50%' : '60%');
            tds.push('<td>' + skeletonLine(w) + '</td>');
          }
          html += '<tr>' + tds.join('') + '</tr>';
        }
        return html;
      }

      function renderRenovateStatus(payload) {
        const renovate = payload || null;
        dashboardState.renovate = renovate;
        renovateLinksEl.innerHTML = '';

        if (!renovate || !renovate.configured) {
          renovateMetaEl.textContent = renovate && renovate.error ? renovate.error : 'Renovate is not configured.';
          renovateRunBtn.disabled = true;
          return;
        }

        const meta = [];
        const activeRun = renovate.activeRun || null;
        const lastRun = activeRun || renovate.lastRun || null;
        meta.push('Run: ' + (lastRun ? (lastRun.status === 'completed' ? (lastRun.conclusion || 'completed') : lastRun.status) : 'idle'));
        if (lastRun && lastRun.updatedAt) meta.push('Updated: ' + fmtDateTime(lastRun.updatedAt));
        meta.push('Open PRs: ' + String(renovate.openPrCount || 0));
        renovateMetaEl.textContent = meta.join(' | ');
        renovateRunBtn.disabled = Boolean(activeRun);

        const links = [];
        if (renovate.dashboardIssueUrl) {
          links.push('<a href="' + escapeHtml(renovate.dashboardIssueUrl) + '" target="_blank" rel="noreferrer">Dependency Dashboard</a>');
        }
        if (lastRun && lastRun.url) {
          links.push('<a href="' + escapeHtml(lastRun.url) + '" target="_blank" rel="noreferrer">Latest Run</a>');
        }
        if (renovate.repository) {
          links.push('<a href="https://github.com/' + escapeHtml(normalizeRepoName(renovate.repository)) + '/pulls?q=is%3Apr+is%3Aopen+label%3Arenovate" target="_blank" rel="noreferrer">Open PRs</a>');
        }
        renovateLinksEl.innerHTML = links.join(' · ');
        if (dashboardState.updates) renderUpdates(dashboardState.updates);
        if (dashboardState.helmUpdates) renderHelmUpdates(dashboardState.helmUpdates);
      }

      async function loadRenovateStatus(options) {
        const force = Boolean(options && options.force);
        try {
          const path = force ? '/api/renovate?force=1' : '/api/renovate';
          renderRenovateStatus(await request(path, 'GET'));
          if (force) {
            const activeRun = dashboardState.renovate && dashboardState.renovate.activeRun;
            setRenovateMsg(activeRun ? 'Renovate workflow is running.' : 'Renovate status refreshed.');
          }
        } catch (err) {
          renderRenovateStatus({ configured: false, error: err.message });
          if (force) setRenovateMsg(err.message, true);
        }
      }

      async function runRenovate() {
        setBtnLoading(renovateRunBtn, true);
        setRenovateMsg('Dispatching Renovate workflow...');
        try {
          const payload = await request('/api/renovate/run', 'POST', {});
          setRenovateMsg(payload.message || 'Renovate workflow dispatched.');
          await loadRenovateStatus({ force: true });
          setTimeout(() => {
            loadRenovateStatus({ force: true }).catch(() => {});
          }, 5000);
        } catch (err) {
          setRenovateMsg(err.message, true);
        } finally {
          renovateRunBtn.classList.remove('is-loading');
          renovateRunBtn.disabled = Boolean(dashboardState.renovate && dashboardState.renovate.activeRun);
        }
      }

      async function runRenovateScan(label) {
        const targetLabel = String(label || '').trim();
        if (targetLabel) {
          setRenovateMsg('Dispatching Renovate workflow for ' + targetLabel + '...');
        }
        await runRenovate();
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
        const helmUpdates = dashboardState.helmUpdates || null;
        const travel = dashboardState.travel || null;
        const tuning = dashboardState.tuning || null;
        const vpn = dashboardState.vpn || null;
        const activeExposures = services.filter((svc) => svc.enabled).length;
        const updateItems = updates && Array.isArray(updates.items) ? updates.items : [];
        const updatesAvailable = updateItems.filter((item) => item && item.status === 'update').length;
        const helmUpdateItems = helmUpdates && Array.isArray(helmUpdates.items) ? helmUpdates.items : [];
        const helmUpdatesAvailable = helmUpdateItems.filter((item) => item && item.status === 'update').length;
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
          overviewSegment('chart updates', String(helmUpdatesAvailable), helmUpdateItems.length ? helmUpdateItems.length + ' helm releases' : 'cached report unavailable', {
            eyebrow: 'updates available',
            barPct: helmUpdateItems.length ? helmUpdatesAvailable / helmUpdateItems.length * 100 : 0,
            tone: helmUpdatesAvailable > 0 ? 'warning' : 'status',
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
        if (updates && updates.checkedAt) meta.push('<span>images checked ' + fmtDateTime(updates.checkedAt) + '</span>');
        if (helmUpdates && helmUpdates.checkedAt) meta.push('<span>charts checked ' + fmtDateTime(helmUpdates.checkedAt) + '</span>');
        if (vpn) meta.push('<span>transmission desired ' + desiredMode + '</span>');
        if (travel && travel.checkedAt) meta.push('<span>travel checked ' + fmtDateTime(travel.checkedAt) + '</span>');
        overviewMetaEl.innerHTML = meta.join('');
        overviewDetailEl.textContent = fetchDetail;
        exposureMetaEl.textContent = activeExposures + ' active exposure' + (activeExposures === 1 ? '' : 's');
        vpnSectionMetaEl.textContent = vpn ? ('desired ' + desiredMode + ' · running ' + runningMode) : 'status unavailable';
        auditMetaEl.textContent = (dashboardState.audit || []).length + ' recent entries';
      }

      function jobTone(status) {
        const value = String(status || '').toLowerCase();
        if (value === 'succeeded') return 'ok';
        if (value === 'running') return 'warning';
        if (value === 'failed') return 'excluded';
        return 'neutral';
      }

      function renderJobs(payload) {
        const data = payload || { items: [], summary: {} };
        const items = Array.isArray(data.items) ? data.items : [];
        const summary = data.summary || {};
        const totalRuns = items.reduce((sum, item) => sum + (Array.isArray(item.recentRuns) ? item.recentRuns.length : 0), 0);
        const failedRuns = items.reduce((sum, item) => sum + (Array.isArray(item.recentRuns) ? item.recentRuns.filter((run) => run.status === 'failed').length : 0), 0);
        const running = Number(summary.running || 0);
        const suspended = Number(summary.suspended || 0);

        dashboardState.jobs = data;
        jobsSummaryEl.textContent = String(summary.found || 0) + '/' + String(summary.total || items.length) + ' managed job' + ((summary.total || items.length) === 1 ? '' : 's') + ' found';
        jobsOverviewStripEl.innerHTML =
          overviewSegment('managed jobs', String(summary.total || items.length), String(summary.found || 0) + ' found in cluster', {
            eyebrow: 'inventory',
            barPct: summary.total ? Number(summary.found || 0) / Number(summary.total || 1) * 100 : 0,
            tone: Number(summary.found || 0) === Number(summary.total || 0) ? 'status' : 'danger',
          }) +
          overviewSegment('active runs', String(running), 'currently running pods from managed CronJobs', {
            eyebrow: 'runtime',
            barPct: running ? 100 : 0,
            tone: running ? 'warning' : 'status',
          }) +
          overviewSegment('suspended', String(suspended), 'CronJobs paused from schedule', {
            eyebrow: 'configuration',
            barPct: items.length ? suspended / items.length * 100 : 0,
            tone: suspended ? 'warning' : 'status',
          }) +
          overviewSegment('recent failures', String(failedRuns), String(totalRuns) + ' recent run' + (totalRuns === 1 ? '' : 's') + ' loaded', {
            eyebrow: 'logs',
            barPct: totalRuns ? failedRuns / totalRuns * 100 : 0,
            tone: failedRuns ? 'danger' : 'status',
          });
        jobsOverviewMetaEl.innerHTML =
          '<span>checked ' + fmtDateTime(data.checkedAt) + '</span>' +
          '<span>' + String(totalRuns) + ' run log tail' + (totalRuns === 1 ? '' : 's') + '</span>';
        jobsOverviewDetailEl.textContent = items.length ? 'managed CronJob inventory loaded' : 'no managed jobs configured';

        if (!items.length) {
          jobsListEl.innerHTML = '<div class="empty-state">No managed jobs configured.</div>';
          return;
        }

        jobsListEl.innerHTML = items.map((job) => {
          const status = job.status || {};
          const runs = Array.isArray(job.recentRuns) ? job.recentRuns : [];
          const latest = runs[0] || null;
          const scheduleValue = escapeHtml(status.schedule || '');
          const timeZoneValue = escapeHtml(status.timeZone || '');
          const runRows = runs.length
            ? runs.map((run) =>
              '<tr>' +
                '<td><div class="svc-name">' + escapeHtml(run.name || 'run') + '</div><div class="svc-id">' + escapeHtml((run.podNames || []).join(', ') || 'no pod yet') + '</div></td>' +
                '<td><span class="stat-pill ' + jobTone(run.status) + '"><strong>' + escapeHtml(run.status || 'unknown') + '</strong></span></td>' +
                '<td>' + fmtDateTime(run.startedAt) + '</td>' +
                '<td>' + (run.completedAt ? fmtDateTime(run.completedAt) : 'n/a') + '</td>' +
                '<td>' + (run.durationSeconds == null ? 'n/a' : String(run.durationSeconds) + 's') + '</td>' +
                '<td><button class="updates-action-btn" type="button" data-job-log="' + escapeHtml(job.id) + '" data-job-run="' + escapeHtml(run.name || '') + '">Logs</button></td>' +
              '</tr>'
            ).join('')
            : '<tr><td colspan="6" class="empty-state">No recent runs found.</td></tr>';
          const logText = latest && latest.logs ? escapeHtml(latest.logs) : 'No logs loaded for the latest run.';
          return (
            '<article class="job-card" data-job-card="' + escapeHtml(job.id) + '">' +
              '<div class="job-card-head">' +
                '<div><div class="job-title">' + escapeHtml(job.title || job.id) + '</div><div class="job-meta">' + escapeHtml(job.namespace || '') + '/' + escapeHtml(job.cronJob || '') + ' · ' + escapeHtml(job.repoPath || '') + '</div></div>' +
                '<div class="job-status-cluster">' +
                  '<span class="stat-pill ' + (job.found ? 'ok' : 'excluded') + '"><strong>' + (job.found ? 'found' : 'missing') + '</strong></span>' +
                  '<span class="stat-pill ' + (status.suspend ? 'guarded' : 'ok') + '"><strong>' + (status.suspend ? 'suspended' : 'scheduled') + '</strong></span>' +
                '</div>' +
              '</div>' +
              '<p class="support-copy">' + escapeHtml(job.description || '') + '</p>' +
              '<div class="job-config-grid">' +
                '<label><span>schedule</span><input class="job-input" data-job-schedule="' + escapeHtml(job.id) + '" type="text" value="' + scheduleValue + '" /></label>' +
                '<label><span>timezone</span><input class="job-input" data-job-timezone="' + escapeHtml(job.id) + '" type="text" value="' + timeZoneValue + '" /></label>' +
                '<label class="job-checkbox"><input data-job-suspend="' + escapeHtml(job.id) + '" type="checkbox" ' + (status.suspend ? 'checked' : '') + ' /><span>suspend</span></label>' +
                '<div class="job-actions">' +
                  '<button type="button" data-job-save="' + escapeHtml(job.id) + '">Save config</button>' +
                  '<button type="button" data-job-run="' + escapeHtml(job.id) + '">Run now</button>' +
                '</div>' +
              '</div>' +
              '<div class="job-runtime-line">' +
                '<span>last schedule ' + fmtDateTime(status.lastScheduleTime) + '</span>' +
                '<span>last success ' + fmtDateTime(status.lastSuccessfulTime) + '</span>' +
                '<span>policy ' + escapeHtml(status.concurrencyPolicy || 'Allow') + '</span>' +
              '</div>' +
              '<div class="table-shell job-runs-shell"><table><thead><tr><th>run</th><th>status</th><th>started</th><th>completed</th><th>duration</th><th>logs</th></tr></thead><tbody>' + runRows + '</tbody></table></div>' +
              '<div class="terminal-shell job-log-shell"><pre data-job-log-output="' + escapeHtml(job.id) + '">' + logText + '</pre></div>' +
            '</article>'
          );
        }).join('');
      }

      async function loadJobs(options) {
        const force = Boolean(options && options.force);
        if (force) {
          setBtnLoading(jobsRefreshBtn, true);
          setJobsMsg('Refreshing managed jobs...');
        }
        try {
          const payload = await request('/api/jobs', 'GET');
          renderJobs(payload);
          if (force) setJobsMsg('Managed jobs refreshed.');
        } catch (err) {
          jobsSummaryEl.textContent = 'Managed jobs unavailable';
          jobsListEl.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
          setJobsMsg(err.message, true);
        } finally {
          if (force) setBtnLoading(jobsRefreshBtn, false);
        }
      }

      function conditionLabel(condition) {
        if (!condition) return 'unknown';
        if (condition.status === 'True') return 'ready';
        if (condition.status === 'False') return condition.reason || 'not ready';
        return condition.reason || 'unknown';
      }

      function shortHash(value) {
        const text = String(value || '');
        if (!text || text === 'n/a') return 'n/a';
        if (text.length <= 22) return text;
        return text.slice(0, 13) + '…' + text.slice(-7);
      }

      function deployTag(label, value) {
        const full = String(value || 'n/a');
        return '<span class="site-deploy-tag"><span>' + escapeHtml(label) + '</span><strong title="' + escapeHtml(full) + '">' + escapeHtml(shortHash(full)) + '</strong></span>';
      }

      function renderSiteDeployments(payload) {
        const data = payload || { items: [] };
        const items = Array.isArray(data.items) ? data.items : [];
        dashboardState.siteDeployments = data;
        const readyCount = items.filter((item) => item && item.ready).length;
        const errorCount = items.filter((item) => item && item.errors && item.errors.length).length;
        siteDeploySummaryEl.textContent = String(items.length) + ' target' + (items.length === 1 ? '' : 's') + ' · ' + String(readyCount) + ' ready';
        siteDeployOverviewStripEl.innerHTML =
          overviewSegment('targets', String(items.length), 'Flux image-automated sites', { eyebrow: 'static deploys', barPct: 100, tone: 'neutral' }) +
          overviewSegment('ready', String(readyCount), 'kustomization and helm ready', { eyebrow: 'runtime state', barPct: items.length ? readyCount / items.length * 100 : 0, tone: readyCount === items.length ? 'status' : 'warning' }) +
          overviewSegment('errors', String(errorCount), errorCount ? 'some Flux objects unavailable' : 'inventory clean', { eyebrow: 'api inventory', barPct: errorCount ? Math.min(100, errorCount * 25) : 0, tone: errorCount ? 'danger' : 'status' }) +
          overviewSegment('checked', data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : 'n/a', 'latest control-panel snapshot', { eyebrow: 'snapshot', barPct: 100, tone: 'neutral' });

        if (!items.length) {
          siteDeployListEl.innerHTML = '<div class="empty-state">No site deploy targets configured.</div>';
          return;
        }
        siteDeployListEl.innerHTML = items.map((item) => {
          const ready = item.ready;
          const latest = item.latestTag || 'n/a';
          const current = item.currentTag || 'n/a';
          const buttonText = 'Deploy this';
          const link = item.url ? '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer">open site</a>' : '<span class="muted">cluster-internal</span>';
          const errorText = item.errors && item.errors.length ? '<div class="site-deploy-errors">' + escapeHtml(item.errors.join(' · ')) + '</div>' : '';
          return (
            '<article class="support-card site-deploy-card">' +
              '<div class="site-deploy-card-head">' +
                '<div class="support-card-title">' + escapeHtml(item.title || item.id) + '</div>' +
                '<span class="status-chip ' + (ready ? 'ok' : 'warning') + '">' + (ready ? 'ready' : 'check') + '</span>' +
              '</div>' +
              '<div class="site-deploy-meta">' +
                deployTag('current', current) +
                deployTag('policy', latest) +
                '<span>scan ' + escapeHtml(fmtDateTime(item.lastScanTime)) + '</span>' +
                '<span>kustomization ' + escapeHtml(conditionLabel(item.kustomizationReady)) + '</span>' +
                '<span>helm ' + escapeHtml(conditionLabel(item.helmReleaseReady)) + '</span>' +
              '</div>' +
              errorText +
              '<div class="site-deploy-actions">' +
                link +
                '<button type="button" data-site-deploy-run="' + escapeHtml(item.id) + '">' + buttonText + '</button>' +
              '</div>' +
            '</article>'
          );
        }).join('');
      }

      async function loadSiteDeployments(options) {
        const force = Boolean(options && options.force);
        if (force) {
          setBtnLoading(siteDeployRefreshBtn, true);
          setSiteDeployMsg('Refreshing deploy targets...');
        }
        try {
          const payload = await request('/api/site-deployments', 'GET');
          renderSiteDeployments(payload);
          if (force) setSiteDeployMsg('Deploy targets refreshed.');
        } catch (err) {
          siteDeploySummaryEl.textContent = 'Site deploys unavailable';
          siteDeployOverviewStripEl.innerHTML = '';
          siteDeployListEl.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
          setSiteDeployMsg(err.message, true);
        } finally {
          if (force) setBtnLoading(siteDeployRefreshBtn, false);
        }
      }

      async function runSiteDeployment(siteId, button) {
        setBtnLoading(button, true);
        setSiteDeployMsg('Reconciling only ' + siteId + ' through its Flux image automation...');
        try {
          const payload = await request('/api/site-deployments/' + encodeURIComponent(siteId) + '/run', 'POST', {});
          const handled = (payload.steps || []).filter((step) => step.handled).length;
          const total = (payload.steps || []).length;
          setSiteDeployMsg((payload.message || 'Deploy reconcile requested.') + ' ' + handled + '/' + total + ' controller(s) acknowledged the request.');
          await loadSiteDeployments();
        } catch (err) {
          setSiteDeployMsg(err.message, true);
        } finally {
          setBtnLoading(button, false);
        }
      }

      async function runAllSiteDeployments(button) {
        setBtnLoading(button, true);
        setSiteDeployMsg('Reconciling all static sites through their Flux image automations...');
        try {
          const payload = await request('/api/site-deployments/run', 'POST', {});
          const steps = (payload.results || []).flatMap((result) => result.steps || []);
          const handled = steps.filter((step) => step.handled).length;
          const total = steps.length;
          setSiteDeployMsg((payload.message || 'Deploy reconcile requested for all static sites.') + ' ' + handled + '/' + total + ' controller(s) acknowledged the request.');
          await loadSiteDeployments();
        } catch (err) {
          setSiteDeployMsg(err.message, true);
        } finally {
          setBtnLoading(button, false);
        }
      }

      async function saveJobConfig(jobId, button) {
        const scheduleEl = jobsListEl.querySelector('[data-job-schedule="' + CSS.escape(jobId) + '"]');
        const timeZoneEl = jobsListEl.querySelector('[data-job-timezone="' + CSS.escape(jobId) + '"]');
        const suspendEl = jobsListEl.querySelector('[data-job-suspend="' + CSS.escape(jobId) + '"]');
        setBtnLoading(button, true);
        setJobsMsg('Saving ' + jobId + '...');
        try {
          const payload = await request('/api/jobs/' + encodeURIComponent(jobId), 'PATCH', {
            schedule: scheduleEl ? scheduleEl.value : undefined,
            timeZone: timeZoneEl ? timeZoneEl.value : undefined,
            suspend: suspendEl ? suspendEl.checked : false,
          });
          setJobsMsg(payload.gitops && payload.gitops.changed ? 'Committed ' + jobId + ' config and requested Flux reconcile.' : 'No config change for ' + jobId + '.');
          await loadJobs();
        } catch (err) {
          setJobsMsg(err.message, true);
        } finally {
          setBtnLoading(button, false);
        }
      }

      async function runJobNow(jobId, button) {
        if (!confirm('Run ' + jobId + ' now?')) return;
        setBtnLoading(button, true);
        setJobsMsg('Creating manual run for ' + jobId + '...');
        try {
          const payload = await request('/api/jobs/' + encodeURIComponent(jobId) + '/run', 'POST', {});
          setJobsMsg('Created ' + (payload.jobName || 'manual job') + '.');
          await loadJobs();
        } catch (err) {
          setJobsMsg(err.message, true);
        } finally {
          setBtnLoading(button, false);
        }
      }

      async function loadJobLogs(jobId, jobName, button) {
        const output = jobsListEl.querySelector('[data-job-log-output="' + CSS.escape(jobId) + '"]');
        setBtnLoading(button, true);
        if (output) output.textContent = 'Loading logs for ' + jobName + '...';
        try {
          const payload = await request('/api/jobs/' + encodeURIComponent(jobId) + '/runs/' + encodeURIComponent(jobName) + '/logs', 'GET');
          if (output) output.textContent = payload.logs || 'No logs available for ' + jobName + '.';
          setJobsMsg('Loaded logs for ' + jobName + '.');
        } catch (err) {
          if (output) output.textContent = err.message;
          setJobsMsg(err.message, true);
        } finally {
          setBtnLoading(button, false);
        }
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
          vpnSwitch.disabled = true;
          vpnSwitch.classList.remove('on');
          vpnSwitch.setAttribute('aria-checked', 'false');
          vpnToggleLabels.forEach((label) => label.classList.remove('active'));
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
        const vpnOn = desiredMode === 'vpn';
        vpnSwitch.disabled = mutationInFlight > 0;
        vpnSwitch.classList.toggle('on', vpnOn);
        vpnSwitch.setAttribute('aria-checked', vpnOn ? 'true' : 'false');
        vpnToggleLabels.forEach((label) => label.classList.toggle('active', (label.dataset.vpnLabel === 'vpn') === vpnOn));
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
          statusBadge.className = 'update-chip ' + (svc.enabled ? 'current' : 'not-installed');
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
              setBtnLoading(enableBtn, true);
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
              setBtnLoading(disableBtn, true);
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
        const visibleItems = filteredUpdateItems(items);
        const renovateConfigured = Boolean(dashboardState.renovate && dashboardState.renovate.configured);
        const renovateActiveRun = Boolean(dashboardState.renovate && dashboardState.renovate.activeRun);
        updatesRowsEl.innerHTML = '';
        if (!items.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="5" class="empty-state">No update rows available.</td>';
          updatesRowsEl.appendChild(tr);
        } else if (!visibleItems.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="5" class="empty-state">No update rows match the current filter.</td>';
          updatesRowsEl.appendChild(tr);
        } else {
          visibleItems.forEach((item) => {
            const tr = document.createElement('tr');
            const nsPrefix = item.namespace ? item.namespace + '/' : '';
            const imageLabel = item.imageRepo || item.image || '—';
            const imageDetail = [item.detail, item.pod ? 'pod/' + item.pod : ''].filter(Boolean).join(' · ');
            const imageTitle = [imageLabel, imageDetail].filter(Boolean).join('\n');
            const matchingPr = findMatchingRenovatePr(item, 'image');
            let actionHtml = '<span class="updates-action-note">—</span>';
            if (matchingPr) {
              actionHtml = '<a class="updates-action-link" href="' + escapeHtml(matchingPr.url) + '" target="_blank" rel="noreferrer">Open PR #' + matchingPr.number + '</a>';
            } else if (item.status === 'update') {
              if (!renovateConfigured) {
                actionHtml = '<span class="updates-action-note">Renovate off</span>';
              } else if (renovateActiveRun) {
                actionHtml = '<span class="updates-action-note">Scan running</span>';
              } else {
                actionHtml = '<button class="updates-action-btn" type="button" data-renovate-scan="image" data-item-label="' + escapeHtml(item.name || item.id || 'service') + '">Run scan</button>';
              }
            }
            tr.innerHTML =
              '<td><div class="svc-name">' + escapeHtml(item.name || item.id || '') + '</div><div class="svc-id">' + escapeHtml(nsPrefix + (item.id || '')) + '</div></td>' +
              '<td class="updates-version-cell">' + versionDiffHtml(item.currentVersion, item.latestVersion, item.status) + '</td>' +
              '<td class="updates-status-cell"><span class="update-chip ' + (item.status || 'unknown') + '">' + String(item.statusText || 'unknown').toLowerCase() + '</span></td>' +
              '<td class="updates-context-cell" title="' + attrText(imageTitle) + '"><div class="updates-version truncate-text">' + escapeHtml(imageLabel) + '</div><div class="updates-sub truncate-text">' + escapeHtml(imageDetail) + '</div></td>' +
              '<td class="updates-cell-center updates-action-cell">' + actionHtml + '</td>';
            updatesRowsEl.appendChild(tr);
          });
        }
        const checkedAt = payload && payload.checkedAt ? fmtDateTime(payload.checkedAt) : 'not checked yet';
        const nextCheckAt = payload && payload.nextCheckAt ? fmtDateTime(payload.nextCheckAt) : 'unknown';
        const source = payload && payload.source ? payload.source : 'unknown';
        const staleText = payload && payload.stale ? ' · stale cache' : '';
        const refreshingText = payload && payload.refreshInProgress ? ' · background refresh running' : '';
        const filterText = items.length && visibleItems.length !== items.length ? ' | Showing: ' + visibleItems.length + '/' + items.length : '';
        updatesMetaEl.textContent = 'Checked: ' + checkedAt + ' | Next check: ' + nextCheckAt + ' | Source: ' + source + staleText + refreshingText + filterText;
      }

      async function loadUpdates(options) {
        const force = Boolean(options && options.force);
        if (force) {
          setBtnLoading(updatesRefreshBtn, true);
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
          if (force) setBtnLoading(updatesRefreshBtn, false);
        }
      }

      function renderHelmUpdates(payload) {
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        const renovateConfigured = Boolean(dashboardState.renovate && dashboardState.renovate.configured);
        const renovateActiveRun = Boolean(dashboardState.renovate && dashboardState.renovate.activeRun);
        helmUpdatesRowsEl.innerHTML = '';
        if (!items.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="6" class="empty-state">No helm chart rows available.</td>';
          helmUpdatesRowsEl.appendChild(tr);
        } else {
          items.forEach((item) => {
            const tr = document.createElement('tr');
            const nsPrefix = item.namespace ? item.namespace + '/' : '';
            const matchingPr = findMatchingRenovatePr(item, 'helm');
            let actionHtml = '<span class="updates-action-note">—</span>';
            if (matchingPr) {
              actionHtml = '<a class="updates-action-link" href="' + escapeHtml(matchingPr.url) + '" target="_blank" rel="noreferrer">Open PR #' + matchingPr.number + '</a>';
            } else if (item.status === 'update') {
              if (!renovateConfigured) {
                actionHtml = '<span class="updates-action-note">Renovate off</span>';
              } else if (renovateActiveRun) {
                actionHtml = '<span class="updates-action-note">Scan running</span>';
              } else {
                actionHtml = '<button class="updates-action-btn" type="button" data-renovate-scan="helm" data-item-label="' + escapeHtml(item.name || item.id || 'chart') + '">Run scan</button>';
              }
            }
            tr.innerHTML =
              '<td><div class="svc-name">' + (item.name || item.id || '') + '</div><div class="svc-id">' + nsPrefix + (item.id || '') + '</div></td>' +
              '<td class="updates-version updates-cell-center">' + (item.currentVersion || '—') + '</td>' +
              '<td class="updates-version updates-cell-center">' + (item.latestVersion || '—') + '</td>' +
              '<td class="updates-cell-center"><span class="update-chip ' + (item.status || 'unknown') + '">' + String(item.statusText || 'unknown').toLowerCase() + '</span></td>' +
              '<td class="updates-context-cell"><div class="updates-version">' + (item.chart || '—') + '</div><div class="updates-sub">' + (item.repo || '—') + (item.detail ? ' · ' + item.detail : '') + '</div></td>' +
              '<td class="updates-cell-center updates-action-cell">' + actionHtml + '</td>';
            helmUpdatesRowsEl.appendChild(tr);
          });
        }
        const checkedAt = payload && payload.checkedAt ? fmtDateTime(payload.checkedAt) : 'not checked yet';
        const nextCheckAt = payload && payload.nextCheckAt ? fmtDateTime(payload.nextCheckAt) : 'unknown';
        const source = payload && payload.source ? payload.source : 'unknown';
        const staleText = payload && payload.stale ? ' · stale cache' : '';
        const refreshingText = payload && payload.refreshInProgress ? ' · background refresh running' : '';
        helmUpdatesMetaEl.textContent = 'Checked: ' + checkedAt + ' | Next check: ' + nextCheckAt + ' | Source: ' + source + staleText + refreshingText;
      }

      async function loadHelmUpdates(options) {
        const force = Boolean(options && options.force);
        if (force) {
          setBtnLoading(helmUpdatesRefreshBtn, true);
          setHelmUpdatesMsg('Checking helm chart repos...');
        }
        try {
          const path = force ? '/api/helm-updates?force=1' : '/api/helm-updates';
          const payload = await request(path, 'GET');
          dashboardState.helmUpdates = payload;
          renderHelmUpdates(payload);
          renderOverview();
          if (payload.stale) {
            setHelmUpdatesMsg('Showing cached data while background refresh runs.');
          } else {
            setHelmUpdatesMsg('Helm chart report loaded.');
          }
        } catch (err) {
          setHelmUpdatesMsg(err.message, true);
        } finally {
          if (force) setBtnLoading(helmUpdatesRefreshBtn, false);
        }
      }

      function secretId(namespace, name) {
        return String(namespace || '') + '/' + String(name || '');
      }

      function selectedSecretId() {
        const selected = dashboardState.selectedSecret;
        return selected ? secretId(selected.namespace, selected.name) : '';
      }

      function secretFilterText(item) {
        return [
          item.namespace,
          item.name,
          item.repoPath,
          secretAppName(item),
          Array.isArray(item.keys) ? item.keys.join(' ') : '',
        ].join(' ').toLowerCase();
      }

      function secretAppName(item) {
        const name = String(item && item.name || '');
        const namespace = String(item && item.namespace || '');
        const platformNames = {
          'cloudflare-api-token': namespace === 'cert-manager' ? 'cert-manager' : 'external-dns',
          'ghcr-pull-secret': namespace === 'flux-system' ? 'image automation' : 'registry auth',
          'truenas-credentials': 'storage',
          'resource-advisor-github': 'resource-advisor',
          'cloudflared-tunnel-token': 'public-edge',
          'operator-oauth': 'tailscale',
        };
        if (platformNames[name]) return platformNames[name];
        return name
          .replace(/-(secret|app-secret|db-secret|github|credentials|token)$/i, '')
          .replace(/-postgres$/i, '')
          .replace(/-tracker$/i, '')
          .replace(/-gluetun-control$/i, '')
          .replace(/-vpn$/i, '');
      }

      function groupSecretsByApp(items) {
        const groups = (items || []).reduce((acc, item) => {
          const appName = secretAppName(item);
          const current = acc[appName] || [];
          return { ...acc, [appName]: current.concat(item) };
        }, {});
        return Object.entries(groups)
          .map(([appName, secrets]) => ({
            appName,
            secrets: secrets.slice().sort((left, right) => left.name.localeCompare(right.name)),
          }))
          .sort((left, right) => left.appName.localeCompare(right.appName));
      }

      function renderSecretNamespaceOptions(namespaces) {
        const current = secretsNamespaceFilterEl.value || 'all';
        const options = ['all'].concat(namespaces || []);
        secretsNamespaceFilterEl.innerHTML = options
          .map((namespace) => '<option value="' + escapeHtml(namespace) + '">' + escapeHtml(namespace === 'all' ? 'all namespaces' : namespace) + '</option>')
          .join('');
        secretsNamespaceFilterEl.value = options.includes(current) ? current : 'all';
      }

      function renderSecretsList(payload) {
        const data = payload || { configured: false, items: [], namespaces: [] };
        dashboardState.secrets = data;
        renderSecretNamespaceOptions(data.namespaces || []);
        const items = Array.isArray(data.items) ? data.items : [];
        const query = String(secretsSearchInputEl.value || '').trim().toLowerCase();
        const namespaceFilter = secretsNamespaceFilterEl.value || 'all';
        const visible = items.filter((item) =>
          (namespaceFilter === 'all' || item.namespace === namespaceFilter) &&
          (!query || secretFilterText(item).includes(query))
        );
        secretsSummaryEl.textContent = data.configured
          ? String(items.length) + ' managed secret' + (items.length === 1 ? '' : 's') + ' · branch ' + (data.branch || 'master')
          : (data.reason || 'Secret editor is not configured.');
        if (!visible.length) {
          secretsListEl.innerHTML = '<div class="empty-state">No managed secrets match.</div>';
          secretsListEl.classList.remove('is-filtering');
          return;
        }
        const current = selectedSecretId();
        secretsListEl.innerHTML = groupSecretsByApp(visible).map((group) => {
          const count = group.secrets.length;
          const totalKeys = group.secrets.reduce((sum, item) => sum + Number(item.keyCount || 0), 0);
          const children = group.secrets.map((item) => {
            const id = secretId(item.namespace, item.name);
            return (
              '<button class="secret-list-item ' + (id === current ? 'active' : '') + '" type="button" data-secret-namespace="' + escapeHtml(item.namespace) + '" data-secret-name="' + escapeHtml(item.name) + '">' +
                '<span class="secret-list-name">' + escapeHtml(item.name) + '</span>' +
                '<span class="secret-list-meta">' + escapeHtml(item.namespace) + ' · ' + String(item.keyCount || 0) + ' key(s)' + (item.existsLive ? '' : ' · not live') + '</span>' +
              '</button>'
            );
          }).join('');
          return (
            '<section class="secret-app-group">' +
              '<div class="secret-app-head">' +
                '<span class="secret-app-name">' + escapeHtml(group.appName) + '</span>' +
                '<span class="secret-app-meta">' + count + ' secret' + (count === 1 ? '' : 's') + ' · ' + totalKeys + ' key' + (totalKeys === 1 ? '' : 's') + '</span>' +
              '</div>' +
              '<div class="secret-app-children">' + children + '</div>' +
            '</section>'
          );
        }).join('');
        window.setTimeout(() => secretsListEl.classList.remove('is-filtering'), 180);
      }

      function renderSecretEditor(secret) {
        dashboardState.selectedSecret = secret || null;
        const hasSecret = Boolean(secret);
        secretAddKeyBtn.disabled = !hasSecret;
        secretSaveBtn.disabled = !hasSecret;
        secretDeleteBtn.disabled = !hasSecret;
        if (!hasSecret) {
          secretEditorTitleEl.textContent = 'Select a secret';
          secretEditorMetaEl.textContent = 'Values stay hidden until a Secret is opened.';
          secretKeyRowsEl.innerHTML = '<div class="empty-state">No secret selected.</div>';
          renderSecretsList(dashboardState.secrets);
          return;
        }
        const entries = Object.entries(secret.stringData || {}).sort((left, right) => left[0].localeCompare(right[0]));
        secretEditorTitleEl.textContent = secret.namespace + '/' + secret.name;
        secretEditorMetaEl.textContent = (secret.repoPath || '') + ' · type ' + (secret.type || 'Opaque');
        secretKeyRowsEl.innerHTML = entries.length
          ? entries.map(([key, value]) => secretKeyRowHtml(key, value)).join('')
          : '<div class="empty-state">This Secret has no keys yet.</div>';
        renderSecretsList(dashboardState.secrets);
      }

      function secretKeyRowHtml(key, value) {
        return (
          '<div class="secret-key-row">' +
            '<input class="secret-key-name" type="text" value="' + escapeHtml(key) + '" placeholder="KEY_NAME" autocomplete="off" />' +
            '<input class="secret-key-value" type="password" value="' + escapeHtml(value) + '" placeholder="value" autocomplete="off" />' +
            '<button class="secret-reveal-btn" type="button" title="Reveal or hide value">Reveal</button>' +
            '<button class="secret-remove-key-btn danger" type="button" title="Remove key">Remove</button>' +
          '</div>'
        );
      }

      function readSecretEditorForm() {
        const rows = Array.from(secretKeyRowsEl.querySelectorAll('.secret-key-row'));
        return rows.reduce((acc, row) => {
          const key = row.querySelector('.secret-key-name').value.trim();
          const value = row.querySelector('.secret-key-value').value;
          if (!key) return acc;
          if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('Unsupported key name: ' + key);
          return { ...acc, [key]: value };
        }, {});
      }

      async function loadSecrets(options) {
        const force = Boolean(options && options.force);
        if (force) {
          setBtnLoading(secretsRefreshBtn, true);
          setSecretsMsg('Refreshing managed secret inventory...');
        }
        try {
          const payload = await request(force ? '/api/secrets?force=1' : '/api/secrets', 'GET');
          renderSecretsList(payload);
          if (force) setSecretsMsg('Secret inventory refreshed.');
        } catch (err) {
          setSecretsMsg(err.message, true);
        } finally {
          if (force) setBtnLoading(secretsRefreshBtn, false);
        }
      }

      async function openSecret(namespace, name) {
        setSecretsMsg('Loading ' + namespace + '/' + name + '...');
        try {
          const secret = await request('/api/secrets/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(name), 'GET');
          renderSecretEditor(secret);
          setSecretsMsg('Secret loaded.');
        } catch (err) {
          setSecretsMsg(err.message, true);
        }
      }

      async function saveSelectedSecret() {
        const secret = dashboardState.selectedSecret;
        if (!secret) return;
        if (!confirm('Commit encrypted changes for ' + secret.namespace + '/' + secret.name + '?')) return;
        try {
          mutationInFlight += 1;
          setBtnLoading(secretSaveBtn, true);
          setSecretsMsg('Encrypting, committing, pushing, and requesting Flux reconcile...');
          await request('/api/secrets/' + encodeURIComponent(secret.namespace) + '/' + encodeURIComponent(secret.name), 'PUT', {
            type: secret.type || 'Opaque',
            stringData: readSecretEditorForm(),
          });
          await loadSecrets({ force: true });
          await openSecret(secret.namespace, secret.name);
          setSecretsMsg('Secret change committed and Flux reconcile requested.');
        } catch (err) {
          setSecretsMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          setBtnLoading(secretSaveBtn, false);
        }
      }

      async function createSecret() {
        const selectedNamespace = secretsNamespaceFilterEl.value || 'all';
        const namespace = selectedNamespace === 'all' ? 'default' : selectedNamespace;
        const name = String(newSecretNameEl.value || '').trim();
        if (!namespace || !name) {
          setSecretsMsg('Namespace and secret name are required.', true);
          return;
        }
        if (!confirm('Create ' + namespace + '/' + name + ' in Git?')) return;
        try {
          mutationInFlight += 1;
          setBtnLoading(newSecretBtn, true);
          setSecretsMsg('Creating encrypted Secret file...');
          await request('/api/secrets', 'POST', {
            namespace,
            name,
            type: 'Opaque',
            stringData: {},
          });
          newSecretNameEl.value = '';
          await loadSecrets({ force: true });
          renderSecretEditor({
            namespace,
            name,
            repoPath: 'infrastructure/secrets/' + namespace + '/' + name + '.yaml',
            type: 'Opaque',
            stringData: {},
          });
          setSecretsMsg('Secret file created and Flux reconcile requested.');
        } catch (err) {
          setSecretsMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          setBtnLoading(newSecretBtn, false);
        }
      }

      async function deleteSelectedSecret() {
        const secret = dashboardState.selectedSecret;
        if (!secret) return;
        if (!confirm('Delete ' + secret.namespace + '/' + secret.name + ' from Git and let Flux prune it?')) return;
        try {
          mutationInFlight += 1;
          setBtnLoading(secretDeleteBtn, true);
          setSecretsMsg('Removing Secret file and requesting Flux prune...');
          await request('/api/secrets/' + encodeURIComponent(secret.namespace) + '/' + encodeURIComponent(secret.name), 'DELETE');
          renderSecretEditor(null);
          await loadSecrets({ force: true });
          setSecretsMsg('Secret removal committed and Flux reconcile requested.');
        } catch (err) {
          setSecretsMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          setBtnLoading(secretDeleteBtn, false);
        }
      }

      async function refreshServicesOnly() {
        const payload = await request('/api/services', 'GET');
        dashboardState.services = payload.services || [];
        renderRows(dashboardState.services);
        renderOverview();
        setLoadState('Exposure state refreshed ' + new Date().toLocaleTimeString());
      }

      async function loadDashboard(options) {
        const silent = Boolean(options && options.silent);
        if (!silent) {
          setLoadState('Refreshing dashboard...');
          setMsg('Refreshing...');
          setVpnMsg('Refreshing Transmission VPN status...');
          setUpdatesMsg('Loading cached update report...');
          setTravelMsg('Refreshing travel readiness...');
          setBtnLoading(refreshAllBtn, true);
          overviewStripEl.innerHTML = skeletonOverviewStrip(7);
          travelOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
          tuningOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
          jobsOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
          siteDeployOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
          rowsEl.innerHTML = skeletonTableRows(6, 4);
          auditRowsEl.innerHTML = skeletonTableRows(4, 3);
          updatesRowsEl.innerHTML = skeletonTableRows(5, 4);
          helmUpdatesRowsEl.innerHTML = skeletonTableRows(6, 4);
          tuningRowsEl.innerHTML = skeletonTableRows(8, 5);
          if (activePage === 'jobs') jobsListEl.innerHTML = '<div class="table-shell"><table><tbody>' + skeletonTableRows(4, 3) + '</tbody></table></div>';
          if (activePage === 'deploy') siteDeployListEl.innerHTML = '<div class="table-shell"><table><tbody>' + skeletonTableRows(4, 3) + '</tbody></table></div>';
          if (activePage === 'secrets') secretsListEl.innerHTML = skeletonTableRows(1, 5);
        }

        try {
          const includeSecrets = activePage === 'secrets';
          const includeJobs = activePage === 'jobs';
          const includeSiteDeployments = activePage === 'deploy';
          const [svcData, auditData, vpnData, tuningData, updatesData, helmUpdatesData, renovateData, travelData, jobsData, siteDeployData, secretsData] = await Promise.allSettled([
            request('/api/services', 'GET'),
            request('/api/audit', 'GET'),
            request('/api/transmission-vpn', 'GET'),
            request('/api/tuning', 'GET'),
            request('/api/image-updates', 'GET'),
            request('/api/helm-updates', 'GET'),
            request('/api/renovate', 'GET'),
            request('/api/travel', 'GET'),
            includeJobs ? request('/api/jobs', 'GET') : Promise.resolve(null),
            includeSiteDeployments ? request('/api/site-deployments', 'GET') : Promise.resolve(null),
            includeSecrets ? request('/api/secrets', 'GET') : Promise.resolve(null),
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
          if (helmUpdatesData.status === 'fulfilled') {
            dashboardState.helmUpdates = helmUpdatesData.value;
            renderHelmUpdates(dashboardState.helmUpdates);
            if (!silent) setHelmUpdatesMsg('Helm chart report loaded.');
          } else {
            dashboardState.helmUpdates = null;
            renderHelmUpdates({ items: [] });
            setHelmUpdatesMsg(helmUpdatesData.reason.message, true);
          }
          if (renovateData.status === 'fulfilled') {
            renderRenovateStatus(renovateData.value);
            if (!silent) setRenovateMsg('');
          } else {
            renderRenovateStatus({ configured: false, error: renovateData.reason.message });
            if (!silent) setRenovateMsg(renovateData.reason.message, true);
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
          if (includeJobs) {
            if (jobsData && jobsData.status === 'fulfilled') {
              renderJobs(jobsData.value);
              if (!silent) setJobsMsg('');
            } else {
              dashboardState.jobs = null;
              jobsSummaryEl.textContent = 'Managed jobs unavailable';
              jobsListEl.innerHTML = '<div class="empty-state">' + escapeHtml(jobsData ? jobsData.reason.message : 'Managed jobs unavailable.') + '</div>';
              if (jobsData && !silent) setJobsMsg(jobsData.reason.message, true);
            }
          } else if (!dashboardState.jobs) {
            jobsSummaryEl.textContent = 'Managed job inventory loads only when this page is opened.';
            jobsOverviewStripEl.innerHTML = '';
            jobsOverviewMetaEl.innerHTML = '';
            jobsOverviewDetailEl.textContent = 'open jobs to load cron state';
            jobsListEl.innerHTML = '<div class="empty-state">Open the jobs page to load managed CronJob state.</div>';
          }
          if (includeSiteDeployments) {
            if (siteDeployData && siteDeployData.status === 'fulfilled') {
              renderSiteDeployments(siteDeployData.value);
              if (!silent) setSiteDeployMsg('');
            } else {
              dashboardState.siteDeployments = null;
              siteDeploySummaryEl.textContent = 'Site deploys unavailable';
              siteDeployOverviewStripEl.innerHTML = '';
              siteDeployListEl.innerHTML = '<div class="empty-state">' + escapeHtml(siteDeployData ? siteDeployData.reason.message : 'Site deploys unavailable.') + '</div>';
              if (siteDeployData && !silent) setSiteDeployMsg(siteDeployData.reason.message, true);
            }
          } else if (!dashboardState.siteDeployments) {
            siteDeploySummaryEl.textContent = 'Site deploy inventory loads only when this page is opened.';
            siteDeployOverviewStripEl.innerHTML = '';
            siteDeployListEl.innerHTML = '<div class="empty-state">Open deploy sites to load static-site targets.</div>';
          }
          if (includeSecrets) {
            if (secretsData && secretsData.status === 'fulfilled') {
              renderSecretsList(secretsData.value);
              if (!silent) setSecretsMsg('');
            } else {
              renderSecretsList({ configured: false, items: [], namespaces: [], reason: secretsData ? secretsData.reason.message : 'Secret inventory unavailable.' });
              if (secretsData && !silent) setSecretsMsg(secretsData.reason.message, true);
            }
          } else if (!dashboardState.secrets) {
            secretsSummaryEl.textContent = 'Secret inventory loads only when this page is opened.';
            secretsListEl.innerHTML = '<div class="empty-state">Open the secrets page to load managed secret inventory.</div>';
          }

          renderOverview();
          hasLoadedDashboard = true;
          setLoadState((silent ? 'Last refresh ' : 'Updated ') + new Date().toLocaleTimeString());
          if (!silent) setMsg('Exposure state updated.');
        } catch (err) {
          setLoadState(err.message, true);
          if (!silent) setMsg(err.message, true);
        } finally {
          if (!silent) setBtnLoading(refreshAllBtn, false);
        }
      }

      refreshAllBtn.onclick = () => loadDashboard();
      updatesRefreshBtn.onclick = () => loadUpdates({ force: true });
      updatesSearchInputEl.addEventListener('input', () => {
        updatesFilterQuery = updatesSearchInputEl.value || '';
        renderUpdates(dashboardState.updates || { items: [] });
      });
      updatesOnlyAvailableEl.addEventListener('change', () => {
        updatesOnlyAvailable = updatesOnlyAvailableEl.checked;
        renderUpdates(dashboardState.updates || { items: [] });
      });
      helmUpdatesRefreshBtn.onclick = () => loadHelmUpdates({ force: true });
      renovateRunBtn.onclick = () => runRenovate();
      jobsRefreshBtn.onclick = () => loadJobs({ force: true });
      siteDeployRefreshBtn.onclick = () => loadSiteDeployments({ force: true });
      siteDeployAllBtn.onclick = () => runAllSiteDeployments(siteDeployAllBtn);
      secretsRefreshBtn.onclick = () => loadSecrets({ force: true });
      newSecretBtn.onclick = () => createSecret();
      secretSaveBtn.onclick = () => saveSelectedSecret();
      secretDeleteBtn.onclick = () => deleteSelectedSecret();
      secretAddKeyBtn.onclick = () => {
        if (!dashboardState.selectedSecret) return;
        const empty = secretKeyRowsEl.querySelector('.empty-state');
        if (empty) secretKeyRowsEl.innerHTML = '';
        secretKeyRowsEl.insertAdjacentHTML('beforeend', secretKeyRowHtml('', ''));
      };
      themeModeButtons.forEach((button) => {
        button.addEventListener('click', () => applyThemeMode(button.dataset.themeMode));
      });
      if (themeMedia) {
        themeMedia.addEventListener('change', () => {
          if (storedThemeMode() === 'system') applyThemeMode('system');
        });
      }
      secretsSearchInputEl.addEventListener('input', () => {
        secretsListEl.classList.add('is-filtering');
        renderSecretsList(dashboardState.secrets);
      });
      secretsNamespaceFilterEl.addEventListener('change', () => {
        secretsListEl.classList.add('is-filtering');
        renderSecretsList(dashboardState.secrets);
      });
      secretsListEl.addEventListener('click', (event) => {
        const item = event.target.closest('[data-secret-namespace][data-secret-name]');
        if (!item) return;
        openSecret(item.dataset.secretNamespace, item.dataset.secretName);
      });
      secretKeyRowsEl.addEventListener('click', (event) => {
        const reveal = event.target.closest('.secret-reveal-btn');
        const remove = event.target.closest('.secret-remove-key-btn');
        if (reveal) {
          const input = reveal.closest('.secret-key-row').querySelector('.secret-key-value');
          const visible = input.type === 'text';
          input.type = visible ? 'password' : 'text';
          reveal.textContent = visible ? 'Reveal' : 'Hide';
        }
        if (remove) {
          remove.closest('.secret-key-row').remove();
          if (!secretKeyRowsEl.querySelector('.secret-key-row')) {
            secretKeyRowsEl.innerHTML = '<div class="empty-state">This Secret has no keys yet.</div>';
          }
        }
      });
      updatesRowsEl.onclick = async (event) => {
        const button = event.target.closest('[data-renovate-scan]');
        if (!button) return;
        button.disabled = true;
        try {
          await runRenovateScan(button.dataset.itemLabel || 'service update');
        } finally {
          button.disabled = false;
        }
      };
      helmUpdatesRowsEl.onclick = async (event) => {
        const button = event.target.closest('[data-renovate-scan]');
        if (!button) return;
        button.disabled = true;
        try {
          await runRenovateScan(button.dataset.itemLabel || 'chart update');
        } finally {
          button.disabled = false;
        }
      };
      siteDeployListEl.onclick = async (event) => {
        const runButton = event.target.closest('[data-site-deploy-run]');
        if (runButton) await runSiteDeployment(runButton.dataset.siteDeployRun, runButton);
      };

      jobsListEl.onclick = async (event) => {
        const saveButton = event.target.closest('[data-job-save]');
        const runButton = event.target.closest('[data-job-run]:not([data-job-log])');
        const logButton = event.target.closest('[data-job-log][data-job-run]');
        if (saveButton) {
          await saveJobConfig(saveButton.dataset.jobSave, saveButton);
          return;
        }
        if (runButton) {
          await runJobNow(runButton.dataset.jobRun, runButton);
          return;
        }
        if (logButton) {
          await loadJobLogs(logButton.dataset.jobLog, logButton.dataset.jobRun, logButton);
        }
      };

      emergencyBtn.onclick = async () => {
        if (!confirm('Disable ALL temporary exposures?')) return;
        try {
          mutationInFlight += 1;
          setBtnLoading(emergencyBtn, true);
          await request('/api/admin/disable-all', 'POST');
          setMsg('All exposures disabled');
          await loadDashboard({ silent: true });
        } catch (err) {
          setMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          setBtnLoading(emergencyBtn, false);
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
          setBtnLoading(vpnSwitch, true);
          setVpnMsg('Applying ' + nextMode + ' mode...');
          const payload = await request('/api/transmission-vpn', 'POST', { mode: nextMode });
          renderTransmissionVpn(payload);
          setVpnMsg('Transmission desired route set to ' + nextMode + '. Flux will roll the pod if needed.');
          await loadDashboard({ silent: true });
        } catch (err) {
          setVpnMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          vpnSwitch.classList.remove('is-loading');
          if (transmissionVpnState) renderTransmissionVpn(transmissionVpnState);
        }
      }

      vpnSwitch.onclick = () => setTransmissionVpnMode(vpnSwitch.classList.contains('on') ? 'direct' : 'vpn');
      vpnToggleLabels.forEach((label) => {
        label.addEventListener('click', () => {
          if (vpnSwitch.disabled) return;
          const mode = label.dataset.vpnLabel === 'vpn' ? 'vpn' : 'direct';
          if ((mode === 'vpn') === vpnSwitch.classList.contains('on')) return;
          setTransmissionVpnMode(mode);
        });
      });
      if (travelDirectBtn) travelDirectBtn.onclick = () => setTransmissionVpnMode('direct');
      if (travelVpnBtn) travelVpnBtn.onclick = () => setTransmissionVpnMode('vpn');

      if (travelDisableSharesBtn) {
        travelDisableSharesBtn.onclick = async () => {
          if (!confirm('Disable ALL temporary exposures?')) return;
          try {
            mutationInFlight += 1;
            setBtnLoading(travelDisableSharesBtn, true);
            setBtnLoading(emergencyBtn, true);
            await request('/api/admin/disable-all', 'POST');
            setTravelMsg('All exposures disabled');
            setMsg('All exposures disabled');
            await loadDashboard({ silent: true });
          } catch (err) {
            setTravelMsg(err.message, true);
          } finally {
            mutationInFlight = Math.max(0, mutationInFlight - 1);
            setBtnLoading(travelDisableSharesBtn, false);
            setBtnLoading(emergencyBtn, false);
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
      applyThemeMode(storedThemeMode());
      setActivePage(window.location.hash || '#updates', { replace: true });
      loadDashboard();
