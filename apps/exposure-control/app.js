      const loadStateEl = document.getElementById('loadState');
      const overviewMetaEl = document.getElementById('overviewMeta');
      const overviewDigestEl = document.getElementById('overviewDigest');
      const travelSummaryEl = document.getElementById('travelSummary');
      const travelOverviewStripEl = document.getElementById('travelOverviewStrip');
      const travelOverviewMetaEl = document.getElementById('travelOverviewMeta');
      const travelBundlesMetaEl = document.getElementById('travelBundlesMeta');
      const travelBundlesEl = document.getElementById('travelBundles');
      const travelNotesMetaEl = document.getElementById('travelNotesMeta');
      const travelSharesEl = document.getElementById('travelPublic');
      const travelNotesEl = document.getElementById('travelNotes');
      const tuningView = window.Tuning.createView(document.getElementById('tuning'));
      const exposureClient = window.ExposureClient.createExposureClient({ request });
      const jobsSummaryEl = document.getElementById('jobsSummary');
      const jobsRefreshBtn = document.getElementById('jobsRefreshBtn');
      const jobsListEl = document.getElementById('jobsList');
      const siteDeploySummaryEl = document.getElementById('siteDeploySummary');
      const siteDeployRefreshBtn = document.getElementById('siteDeployRefreshBtn');
      const siteDeployAllBtn = document.getElementById('siteDeployAllBtn');
      const siteDeployListEl = document.getElementById('siteDeployList');
      const siteDeployMsgEl = document.getElementById('siteDeployMsg');
      const exposureMetaEl = document.getElementById('exposureMeta');
      const vpnSectionMetaEl = document.getElementById('vpnSectionMeta');
      const auditMetaEl = document.getElementById('auditMeta');
      const rowsEl = document.getElementById('rows');
      const agentAccessEl = document.getElementById('agentAccess');
      const auditRowsEl = document.getElementById('auditRows');
      const updatesBodyEl = document.getElementById('updatesBody');
      const updatesFiguresEl = document.getElementById('updatesFigures');
      const updatesSearchInputEl = document.getElementById('updatesSearchInput');
      const updatesKindButtons = Array.from(document.querySelectorAll('[data-updates-kind]'));
      const renovateStripEl = document.getElementById('renovateStrip');
      const vpnMetaEl = document.getElementById('vpnMeta');
      const transmissionPanelEl = document.getElementById('transmissionPanel');
      const auditPanelEl = document.getElementById('auditPanel');
      const updatesMetaEl = document.getElementById('updatesMeta');
      const refreshAllBtn = document.getElementById('refreshAllBtn');
      const emergencyBtn = document.getElementById('emergencyBtn');
      const controlActivityEl = document.getElementById('controlActivity');
      const controlActivityOrbEl = document.getElementById('controlActivityOrb');
      const controlActivityLabelEl = document.getElementById('controlActivityLabel');
      const themeModeButtons = Array.from(document.querySelectorAll('[data-theme-mode]'));
      const vpnSwitch = document.getElementById('vpnSwitch');
      const vpnToggleLabels = Array.from(document.querySelectorAll('[data-vpn-label]'));
      const travelDirectBtn = document.getElementById('travelDirectBtn');
      const travelVpnBtn = document.getElementById('travelVpnBtn');
      const travelDisableSharesBtn = document.getElementById('travelDisablePublicBtn');
      const travelExposureLink = document.getElementById('travelExposureLink');
      const renovateRunBtn = document.getElementById('renovateRunBtn');
      const updatesRefreshBtn = document.getElementById('updatesRefreshBtn');
      const secretsSummaryEl = document.getElementById('secretsSummary');
      const secretsSearchInputEl = document.getElementById('secretsSearchInput');
      const secretsNamespaceFilterEl = document.getElementById('secretsNamespaceFilter');
      const secretsRefreshBtn = document.getElementById('secretsRefreshBtn');
      const secretsListEl = document.getElementById('secretsList');
      const newSecretNameEl = document.getElementById('newSecretName');
      const newSecretBtn = document.getElementById('newSecretBtn');
      const secretEditorTitleEl = document.getElementById('secretEditorTitle');
      const secretEditorMetaEl = document.getElementById('secretEditorMeta');
      const secretAddKeyBtn = document.getElementById('secretAddKeyBtn');
      const secretSaveBtn = document.getElementById('secretSaveBtn');
      const secretDeleteBtn = document.getElementById('secretDeleteBtn');
      const secretKeyRowsEl = document.getElementById('secretKeyRows');
      const feedHeadlineEl = document.getElementById('feedHeadline');
      const feedEyebrowEl = document.getElementById('feedEyebrow');
      const feedCountersEl = document.getElementById('feedCounters');
      const feedFiltersEl = document.getElementById('feedFilters');
      const feedStatusEl = document.getElementById('feedStatus');
      const feedRefreshBtn = document.getElementById('feedRefreshBtn');
      const feedListEl = document.getElementById('feedList');
      const pageSections = Array.from(document.querySelectorAll('[data-page-section]'));
      const pageLinks = Array.from(document.querySelectorAll('[data-page-link]'));

      const navigation = document.getElementById('navigation');
      const navMenuBtn = document.getElementById('navMenuBtn');
      const mobileNavigation = window.matchMedia('(max-width: 980px)');
      const sharesSearch = document.getElementById('accessSearch');
      const shareViewButtons = Array.from(document.querySelectorAll('[data-share-view]'));
      let shareView = 'all';

      // Native modal semantics provide focus containment, Escape, and restoration.
      function syncNavigation() {
        navigation.close();
        if (!mobileNavigation.matches) navigation.setAttribute('open', '');
        navMenuBtn.setAttribute('aria-expanded', String(!mobileNavigation.matches && !navFolded()));
      }

      // One control: it opens the drawer on narrow screens and folds the rail
      // to icons on wide ones. The fold is remembered per browser.
      function navFolded() {
        return document.documentElement.dataset.nav === 'folded';
      }

      function setNavFolded(folded) {
        if (folded) {
          document.documentElement.dataset.nav = 'folded';
          localStorage.setItem('rp-nav', 'folded');
        } else {
          delete document.documentElement.dataset.nav;
          localStorage.removeItem('rp-nav');
        }
        navMenuBtn.setAttribute('aria-expanded', String(!folded));
        // Charts are drawn to the content width, which the rail just changed.
        window.dispatchEvent(new Event('resize'));
      }

      function toggleNavigation() {
        if (!mobileNavigation.matches) {
          setNavFolded(!navFolded());
          return;
        }
        navigation.showModal();
        navMenuBtn.setAttribute('aria-expanded', 'true');
        navigation.querySelector('[aria-current="page"]')?.focus();
      }
      navMenuBtn.onclick = toggleNavigation;
      document.getElementById('navCloseBtn').onclick = () => navigation.close();
      navigation.addEventListener('close', () => {
        if (mobileNavigation.matches) navMenuBtn.setAttribute('aria-expanded', 'false');
      });
      navigation.addEventListener('click', (event) => {
        if (event.target !== navigation || !mobileNavigation.matches) return;
        const bounds = navigation.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) navigation.close();
      });
      mobileNavigation.addEventListener('change', syncNavigation);
      syncNavigation();
      document.querySelector('.skip-link').onclick = (event) => {
        event.preventDefault();
        document.getElementById('mainContent').focus();
      };
      document.querySelector('.brand-link').onclick = (event) => {
        event.preventDefault();
        setActivePage('overview', { focus: true });
      };

      let mutationInFlight = 0;
      let pendingExpiryRefresh = false;
      let transmissionVpnState = null;
      let activitySequence = 0;
      const requestActivities = new Map();
      const siteDeployOperations = new Map();
      const controlActivityOrb = window.ThinkingOrbs?.create(controlActivityOrbEl, {
        state: 'searching',
        size: 20,
        paused: true,
        'aria-label': 'Control panel activity',
      });
      // Filter and disclosure state outlive a repaint of the Updates page.
      const updatesUi = { query: '', kind: 'all', open: { unchecked: false, current: false }, painted: {} };
      let dashboardState = {
        services: [],
        audit: [],
        vpn: null,
        renovate: null,
        updates: null,
        helmUpdates: null,
        activity: null,
        travel: null,
        dns: null,
        tuning: null,
        jobs: null,
        siteDeployments: null,
        secrets: null,
        selectedSecret: null,
        metrics: {},
      };
      let activePage = normalizePage(window.location.hash || '#overview');
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

      // Transient feedback is one toast per area, updated in place.
      function setMessage(scope, text, isError) {
        window.Fx.toast(scope, text || '', { error: Boolean(isError) });
      }

      function setLoadState(text, isError) {
        loadStateEl.textContent = text || '';
        loadStateEl.classList.toggle('is-error', Boolean(isError));
      }

      function setMsg(text, isError) {
        setMessage('shares', text, isError);
      }

      function setVpnMsg(text, isError) {
        setMessage('route', text, isError);
      }

      function setRenovateMsg(text, isError) {
        setMessage('renovate', text, isError);
      }

      function setUpdatesMsg(text, isError) {
        setMessage('images', text, isError);
      }

      function setTravelMsg(text, isError) {
        setMessage('travel', text, isError);
      }

      function setHelmUpdatesMsg(text, isError) {
        setMessage('charts', text, isError);
      }

      function setSecretsMsg(text, isError) {
        setMessage('secrets', text, isError);
      }

      function setJobsMsg(text, isError) {
        setMessage('jobs', text, isError);
      }

      // Deploys keep an inline line: it carries the pending-reconcile beam.
      function setSiteDeployMsg(text, isError) {
        siteDeployMsgEl.textContent = text || '';
        siteDeployMsgEl.classList.toggle('is-error', Boolean(isError));
      }

      function normalizePage(value) {
        const candidate = String(value || '').replace(/^#/, '').trim().toLowerCase();
        if (candidate === 'audit' || candidate === 'transmission') return 'exposure';
        const knownPages = new Set(['overview', 'pulse', 'activity', 'updates', 'deploy', 'travel', 'exposure', 'tuning', 'jobs', 'secrets']);
        if (knownPages.has(candidate)) return candidate;
        return 'overview';
      }

      function setActivePage(page, options) {
        const requestedPage = String(page || '').replace(/^#/, '').trim().toLowerCase();
        const nextPage = normalizePage(page);
        const replace = Boolean(options && options.replace);
        const previousPage = activePage;
        activePage = nextPage;
        if (nextPage === 'pulse' && previousPage !== 'pulse') loadPulse({ silent: true });
        if ((nextPage === 'activity' || nextPage === 'updates') && previousPage !== nextPage) loadActivity();
        pageSections.forEach((section) => {
          section.hidden = section.id !== nextPage;
          section.classList.toggle('page-active', section.id === nextPage);
        });
        pageLinks.forEach((link) => {
          const target = normalizePage(link.getAttribute('href'));
          link.classList.toggle('active', target === nextPage);
          if (target === nextPage) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        });
        const title = pageLinks.find((link) => link.classList.contains('active'))?.dataset.pageTitle || 'Overview';
        document.getElementById('currentPageName').textContent = title;
        document.title = title + ' · rangoonpulse';
        if (mobileNavigation.matches && navigation.open) navigation.close();
        if (requestedPage === 'audit') document.getElementById('auditDisclosure').open = true;
        if (options?.focus) {
          const heading = document.getElementById(nextPage).querySelector('h1');
          heading?.setAttribute('tabindex', '-1');
          heading?.focus({ preventScroll: true });
        }
        const nextHash = '#' + nextPage;
        if (replace) {
          history.replaceState(null, '', nextHash);
        } else if (window.location.hash !== nextHash) {
          history.pushState(null, '', nextHash);
        }
        if (requestedPage === 'transmission' && nextPage === 'exposure' && transmissionPanelEl) {
          transmissionPanelEl.scrollIntoView({ block: 'start', behavior: 'auto' });
        } else if (requestedPage === 'audit' && nextPage === 'exposure' && auditPanelEl) {
          auditPanelEl.scrollIntoView({ block: 'start', behavior: 'auto' });
        } else {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
        if (nextPage === 'secrets' && hasLoadedDashboard && !dashboardState.secrets) {
          secretsListEl.innerHTML = skeletonTableRows(1, 5);
          loadSecrets();
        }
        if (nextPage === 'jobs' && hasLoadedDashboard && !dashboardState.jobs) {
          jobsListEl.innerHTML = '<div class="table-shell"><table><tbody>' + skeletonTableRows(4, 3) + '</tbody></table></div>';
          loadJobs();
        }
        if (nextPage === 'deploy' && hasLoadedDashboard && !dashboardState.siteDeployments) {
          siteDeployListEl.innerHTML = '<div class="table-shell"><table><tbody>' + skeletonTableRows(4, 3) + '</tbody></table></div>';
          loadSiteDeployments();
        }
      }

      const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      const timeFormatter = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });

      function validDate(value) {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      }

      function fmtDateTime(value) {
        const date = validDate(value);
        return date ? dateTimeFormatter.format(date) : 'n/a';
      }

      function fmtTime(value) {
        const date = validDate(value);
        return date ? timeFormatter.format(date) : 'n/a';
      }

      function fmtAgo(value) {
        const date = validDate(value);
        if (!date) return 'n/a';
        const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'now';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
        return Math.floor(seconds / 86400) + 'd ago';
      }

      function fmtExpiry(value, enabled) {
        if (!value) return enabled
          ? { text: 'no expiry', state: 'active' }
          : { text: '—', state: 'none' };
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return { text: 'invalid', state: 'invalid' };
        const diff = d.getTime() - Date.now();
        if (diff <= 0) return { text: 'expired', state: 'expired' };
        const totalSeconds = Math.ceil(diff / 1000);
        if (totalSeconds < 60) return { text: totalSeconds + 's left', state: 'urgent' };
        const mins = Math.ceil(totalSeconds / 60);
        if (mins < 60) return { text: mins + 'm left', state: mins <= 10 ? 'urgent' : 'active' };
        const hrs = Math.floor(mins / 60);
        const rm = mins % 60;
        return { text: (rm ? hrs + 'h ' + rm + 'm' : hrs + 'h') + ' left', state: 'active' };
      }

      function updateExpiryNode(node) {
        const next = fmtExpiry(
          node.dataset.expiresAt || '',
          node.dataset.enabled === '1',
        );
        node.textContent = next.text;
        node.classList.toggle('urgent', next.state === 'urgent');
        node.classList.toggle('expired', next.state === 'expired');
        return next.state;
      }

      function tickExpiryCountdowns() {
        const expired = new Set();
        document.querySelectorAll('#rows .access-meter:not([hidden])').forEach(updateShareMeter);
        document.querySelectorAll('#rows .expiry[data-expires-at], #agentAccess .expiry[data-expires-at]').forEach((node) => {
          const state = updateExpiryNode(node);
          const owner = node.closest('[data-service-id], [data-agent-id]');
          if (node.dataset.enabled === '1' && state === 'expired' && owner) expired.add(owner.dataset.serviceId || owner.dataset.agentId);
        });
        if (expired.size && mutationInFlight === 0 && !pendingExpiryRefresh) {
          pendingExpiryRefresh = true;
          setTimeout(async () => {
            try {
              await refreshServicesOnly();
              const closed = (dashboardState.services || []).filter((svc) => expired.has(svc.id) && !svc.enabled);
              if (closed.length === 1) {
                window.Fx.toast('shares', (closed[0].name || closed[0].id) + ' expired', { tone: 'info', detail: closed[0].publicHost + ' is private' });
              } else if (closed.length) {
                window.Fx.toast('shares', closed.length + ' shares expired', { tone: 'info', detail: namesOf(closed) });
              }
            } finally {
              pendingExpiryRefresh = false;
            }
          }, 300);
        }
      }

      function describeRequestActivity(path, method) {
        const target = String(path || '');
        const readOnly = /^(GET|HEAD)$/.test(String(method || 'GET').toUpperCase());
        if (readOnly) {
          if (/image-updates|helm-updates|renovate/.test(target)) return { state: 'searching', label: 'Loading update report' };
          if (/site-deployments/.test(target)) return { state: 'searching', label: 'Checking deploy targets' };
          if (/secrets/.test(target)) return { state: 'working', label: 'Loading secrets' };
          if (/jobs/.test(target)) return { state: 'working', label: 'Loading jobs' };
          if (/tuning/.test(target)) return { state: 'working', label: 'Reading resource advisor' };
          if (/activity/.test(target)) return { state: 'searching', label: 'Reading activity' };
          if (/travel/.test(target)) return { state: 'working', label: 'Checking travel readiness' };
          return { state: 'working', label: 'Syncing control plane' };
        }
        if (/secrets/.test(target)) return { state: 'working', label: 'Updating secrets' };
        if (/renovate/.test(target)) return { state: 'working', label: 'Requesting Renovate run' };
        if (/site-deployments/.test(target)) return { state: 'working', label: 'Reconciling deployment' };
        if (/tuning/.test(target)) return { state: 'working', label: 'Applying recommendation' };
        if (/jobs/.test(target)) return { state: 'working', label: 'Starting managed job' };
        return { state: 'working', label: 'Applying control-plane change' };
      }

      function syncControlActivity() {
        if (!controlActivityEl || !controlActivityLabelEl) return;
        const activities = Array.from(requestActivities.values());
        const mutations = activities.filter((activity) => activity.mutation);
        // A background refresh must not replace the user's active operation.
        const candidates = (mutations.length ? mutations : activities).filter((activity) => activity.visible);
        const active = candidates[candidates.length - 1];
        controlActivityEl.hidden = !active;
        controlActivityOrb?.setPaused(!active);
        if (active) {
          controlActivityLabelEl.textContent = active.label;
          controlActivityOrb?.setState(active.state);
        }
      }

      async function request(path, method, body) {
        const activityId = ++activitySequence;
        const activity = {
          ...describeRequestActivity(path, method),
          mutation: !/^(GET|HEAD)$/.test(String(method || 'GET').toUpperCase()),
          visible: false,
        };
        requestActivities.set(activityId, activity);
        const revealTimer = window.setTimeout(() => {
          activity.visible = true;
          syncControlActivity();
        }, 2000);
        syncControlActivity();
        try {
          const res = await fetch(path, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'request failed');
          return data;
        } finally {
          window.clearTimeout(revealTimer);
          requestActivities.delete(activityId);
          syncControlActivity();
        }
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

      function setBtnLoading(btn, on) {
        if (!btn) return;
        btn.disabled = Boolean(on);
        btn.classList.toggle('is-loading', Boolean(on));
      }

      function skeletonLine(width, height) {
        return '<span class="skeleton-line" style="width:' + (width || '80%') + ';height:' + (height || '13px') + '"></span>';
      }

      function skeletonShareRows(count) {
        let html = '';
        for (let i = 0; i < count; i++) {
          html += '<li class="access-row is-skeleton" aria-hidden="true"><div class="access-line"><div class="access-id">' +
            skeletonLine('38%') + skeletonLine('52%', '10px') + '</div></div></li>';
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
        renovateRunBtn.disabled = !renovate || !renovate.configured || Boolean(renovate.activeRun);
        renderUpdatesPage();
      }

      async function loadRenovateStatus(options) {
        const force = Boolean(options && options.force);
        try {
          const path = force ? '/api/renovate?force=1' : '/api/renovate';
          renderRenovateStatus(await request(path, 'GET'));
          if (force && dashboardState.renovate && dashboardState.renovate.activeRun) setRenovateMsg('Renovate running.');
        } catch (err) {
          renderRenovateStatus({ configured: false, error: err.message });
          if (force) setRenovateMsg(err.message, true);
        }
      }

      async function runRenovate() {
        setBtnLoading(renovateRunBtn, true);
        setRenovateMsg('Starting Renovate…');
        try {
          const payload = await request('/api/renovate/run', 'POST', {});
          setRenovateMsg(payload.message || 'Renovate started.');
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

      // One stat tile. State shows as a lamp beside the label; the figure stays
      // ink, and a meter appears only when the value is a share of a whole.
      function overviewSegment(label, value, subtitle, options) {
        const o = options || {};
        const hasBar = o.barPct !== undefined && o.barPct !== null;
        const barPct = hasBar ? Math.max(0, Math.min(100, Number(o.barPct) || 0)) : 0;
        const href = o.href ? escapeHtml(o.href) : '';
        const tag = href ? 'a' : 'section';
        return (
          '<' + tag + ' class="tile"' + (href ? ' href="' + href + '"' : '') + ' data-tone="' + (o.tone || 'neutral') + '">' +
            '<div class="tile-label"><span>' + label + '</span>' + (href ? '<svg class="tile-arrow" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-arrow"/></svg>' : '') + '</div>' +
            '<div class="tile-value" data-roll="' + attrText(value) + '">' + value + '</div>' +
            (o.series ? '<div class="tile-spark">' + window.Pulse.sparkline(o.series, { dot: true, label: label + ', 24 hours' }) + '</div>' : '') +
            (subtitle ? '<div class="tile-sub">' + subtitle + '</div>' : '') +
            (hasBar ? '<div class="tile-meter"><span style="width:' + barPct.toFixed(1) + '%"></span></div>' : '') +
          '</' + tag + '>'
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
        const tone = { status: 'ok', warning: 'warning', danger: 'danger' }[travelTone(state)] || 'neutral';
        return '<span class="pill" data-tone="' + tone + '">' + escapeHtml(travelStateLabel(state)) + '</span>';
      }

      // Targets inside a bundle: a quiet lamp when ready, a pill only when something deviates.
      function travelTargetMark(state) {
        if (String(state || '').toLowerCase() === 'ready') {
          return '<span class="lamp status" title="ready" aria-label="ready"></span>';
        }
        return travelStatusPill(state);
      }

      // Three open columns: what wants updating, what is public, and what
      // tuning proposes. Each leads with its count and lists the items below.
      function renderOverviewDigest(services, updateItems, helmUpdateItems) {
        if (!overviewDigestEl) return;
        const tuning = dashboardState.tuning || null;
        const activeServices = services.filter((svc) => svc.enabled && !isAgent(svc));
        const images = updateItems.filter((item) => item && item.status === 'update');
        const charts = helmUpdateItems.filter((item) => item && item.status === 'update');
        const pending = images.map((item) => ({
          name: item.name || item.id || 'service',
          detail: window.UpdatesView ? window.UpdatesView.changeLabel(item) : (item.currentVersion || '?') + ' → ' + (item.latestVersion || '?'),
        })).concat(charts.map((item) => ({
          name: item.name || item.release || item.id || 'release',
          detail: 'chart ' + (item.currentVersion || '?') + ' → ' + (item.latestVersion || '?'),
        })));
        const reportsAvailable = Boolean(dashboardState.updates && dashboardState.helmUpdates && !dashboardState.updates.error && !dashboardState.helmUpdates.error);
        const preview = tuning && tuning.applyPreflight && Date.parse(tuning.applyPreflight.builtAt) > 0 ? tuning.applyPreflight : null;
        const proposals = preview && Array.isArray(preview.selected) ? preview.selected : [];
        const audit = (dashboardState.audit || []).slice(0, 4);

        function list(items, empty) {
          if (!items.length) return empty ? '<p class="empty-line">' + escapeHtml(empty) + '</p>' : '';
          return '<ul class="rows">' + items.map((item) =>
            '<li class="row"' + (item.title ? ' title="' + attrText(item.title) + '"' : '') + '>' +
              (item.href ? '<a class="row-main" href="' + escapeHtml(item.href) + '" target="_blank" rel="noreferrer">' + escapeHtml(item.name) + '</a>' : '<span class="row-main">' + escapeHtml(item.name) + '</span>') +
              '<span class="row-sub">' + escapeHtml(item.detail) + '</span>' +
            '</li>'
          ).join('') + '</ul>';
        }

        function column(title, href, figure, sub, body) {
          return '<section class="column"><div class="column-head"><h2 class="eyebrow">' + title + '</h2>' +
            '<a class="link" href="' + href + '" aria-label="Open ' + title.toLowerCase() + '"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-arrow"/></svg></a></div>' +
            '<div class="column-figure" data-roll="' + attrText(figure) + '">' + figure + '</div>' +
            '<div class="column-sub">' + sub + '</div>' + body + '</section>';
        }

        // Zero kinds drop out of the breakdown: "4 images", not "4 images · 0 charts".
        const updateParts = [[images.length, 'image'], [charts.length, 'chart']]
          .filter(([count]) => count)
          .map(([count, noun]) => count + ' ' + noun + (count === 1 ? '' : 's'));
        const recent = audit.map((entry) => ({
          name: (entry.action || '') + (entry.serviceId ? ' ' + entry.serviceId : ''),
          detail: fmtAgo(entry.ts),
          title: fmtDateTime(entry.ts),
        }));
        // Rows start on the same line in every column; history only needs a
        // label when live shares are listed above it.
        const accessBody = activeServices.length
          ? list(activeServices.map((svc) => ({
              name: svc.publicHost || svc.name || svc.id,
              href: svc.publicUrl,
              detail: (svc.authMode === 'cloudflare-access' ? 'cf-access' : (svc.authMode || 'none')) + ' · ' + fmtExpiry(svc.expiresAt, svc.enabled).text,
            })), '') + (recent.length ? '<div class="eyebrow column-kicker">Recent</div>' + list(recent, '') : '')
          : list(recent, '');

        overviewDigestEl.innerHTML =
          column('Updates', '#updates',
            reportsAvailable ? String(pending.length) : (pending.length ? pending.length + '+' : '—'),
            !reportsAvailable ? 'partial' : updateParts.length ? updateParts.join(' · ') : 'up to date',
            list(pending.slice(0, 7), '')) +
          column('Public access', '#exposure', String(activeServices.length), activeServices.length ? 'live' : 'all private', accessBody) +
          column('Tuning', '#tuning',
            preview ? String(Number(preview.selectedCount ?? proposals.length)) : '—',
            !preview ? 'no preview' : preview.hardFitOk === false ? 'fit blocked' : 'proposed',
            list(proposals.slice(0, 7).map((row) => {
              const current = (row.current && row.current.requests) || {};
              const next = (row.recommended && row.recommended.requests) || {};
              const resource = current.memory !== next.memory ? 'memory' : 'cpu';
              return { name: row.workload || row.release || 'workload', detail: (current[resource] || '?') + ' → ' + (next[resource] || '?') };
            }), ''));
      }

      // Compact posture under the sidebar nav, visible from every page.
      function renderNavHealth(state) {
        const el = document.getElementById('navHealth');
        if (!el) return;
        function row(label, value, tone) {
          return '<div class="nav-health-row' + (tone ? ' ' + tone : '') + '"><span>' + label + '</span><span>' + escapeHtml(String(value)) + '</span></div>';
        }
        el.innerHTML =
          row('route', state.route, state.route === 'unknown' ? 'warning' : '') +
          row('travel', state.travel, state.travel === 'ready' ? '' : 'warning');
        for (const [page, count] of [['exposure', state.shares], ['updates', state.updates]]) {
          const badge = document.querySelector('[data-nav-count="' + page + '"]');
          badge.textContent = String(count);
          badge.hidden = !count;
        }
      }

      let heroField = null;
      let vitalsAt = 0;

      function primarySeries(name) {
        const primary = pulseMetric('node_role')?.series?.find((series) => series.labels.role === 'control-plane')?.labels.node || 'talos-7nf-osf';
        return pulseMetric(name)?.series?.find((series) => series.labels.node === primary);
      }

      // Four live readings under the hero. The trace behind the headline beats
      // with CPU load and goes flat when the reading is missing.
      function renderVitals() {
        const P = window.Pulse;
        const cpu = primarySeries('node_cpu');
        const cells = [
          ['CPU', cpu, P.fmt.pct],
          ['Memory', primarySeries('node_mem'), P.fmt.pct],
          ['Power', pulseMetric('cluster_watts')?.series?.[0], P.fmt.watts],
          ['Restarts', pulseMetric('restarts_1h')?.series?.[0], (value) => P.number(value, 0)],
        ];
        document.getElementById('overviewVitals').innerHTML = cells.map(([label, series, format]) => {
          const history = P.values(series);
          const value = format(P.last(series));
          return '<a class="vital" href="#pulse" aria-label="' + label + ' ' + attrText(value) + '"><span class="eyebrow">' + label + '</span>' +
            '<span class="vital-value" data-roll="' + attrText(value) + '">' + value + '</span>' +
            '<span class="vital-spark">' + (history.some(P.numeric) ? P.sparkline(history, { dot: true, label: label + ', 24 hours' }) : '') + '</span></a>';
        }).join('');
        const load = P.last(cpu);
        heroField?.setVitals({ load, live: P.numeric(load) });
      }

      // The overview reads a small slice of Pulse telemetry; the server caches
      // each named query for 30 seconds, so faster repeats would add nothing.
      async function loadVitals(force) {
        if (!force && Date.now() - vitalsAt < 30000) return;
        vitalsAt = Date.now();
        try {
          const snapshot = await window.Pulse.fetch(['node_cpu', 'node_mem', 'cluster_watts', 'restarts_1h', 'node_role', 'node_ready'], '24h');
          for (const [name, metric] of Object.entries(snapshot.metrics)) dashboardState.metrics[name + '|24h'] = metric;
        } catch {
          vitalsAt = 0;
        }
        renderVitals();
        if (hasLoadedDashboard) renderOverview();
      }

      function renderOverview() {
        const services = dashboardState.services || [];
        const updates = dashboardState.updates || null;
        const helmUpdates = dashboardState.helmUpdates || null;
        const travel = dashboardState.travel || null;
        const tuning = dashboardState.tuning || null;
        const vpn = dashboardState.vpn || null;
        const activeExposures = services.filter((svc) => svc.enabled && !isAgent(svc)).length;
        const updateItems = updates && Array.isArray(updates.items) ? updates.items : [];
        const helmUpdateItems = helmUpdates && Array.isArray(helmUpdates.items) ? helmUpdates.items : [];
        const updateCount = updateItems.concat(helmUpdateItems).filter((item) => item && item.status === 'update').length;
        const fetchState = tuning && tuning.fetch ? tuning.fetch.state : 'degraded';
        const fetchDetail = tuning && tuning.fetch ? tuning.fetch.detail : 'resource-advisor unavailable';
        const desiredMode = vpn && vpn.desiredMode ? vpn.desiredMode : 'unknown';
        const runningMode = vpn && vpn.effectiveMode ? vpn.effectiveMode : 'unknown';
        const travelState = travel && travel.summary ? travel.summary.state : 'unknown';
        const travelHeadline = travel && travel.summary ? travel.summary.headline : 'travel snapshot unavailable';

        const nodes = pulseMetric('node_ready')?.series || [];
        const nodesReady = nodes.filter((series) => window.Pulse.last(series) === 1).length;
        const travelChipTone = travelState === 'ready' ? 'status' : travelTone(travelState) === 'danger' ? 'danger' : 'warning';
        function chip(label, value, href, tone, detail, external) {
          return '<a class="chip" href="' + escapeHtml(href) + '"' + (external ? ' target="_blank" rel="noreferrer"' : '') + ' data-tone="' + tone + '" title="' + attrText(detail) + '">' + label + ' <strong>' + escapeHtml(value) + '</strong></a>';
        }
        // Cloudflare caps records per zone; amber from 80% of the quota, red from 95%.
        const dns = dashboardState.dns && dashboardState.dns.state !== 'unconfigured' ? dashboardState.dns : null;
        const dnsKnown = Boolean(dns && Number.isInteger(dns.records));
        const dnsShare = dnsKnown && dns.quota ? dns.records / dns.quota : 0;
        const dnsTone = !dnsKnown ? 'warning' : dnsShare >= 0.95 ? 'danger' : dnsShare >= 0.8 ? 'warning' : 'status';
        const dnsDetail = !dns ? '' : dnsKnown
          ? dns.zone + ' · ' + dns.records + ' of ' + (dns.quota || '?') + ' Cloudflare DNS records' + (dns.state === 'stale' ? ' · last refresh failed: ' + dns.detail : '')
          : 'DNS record usage unavailable: ' + (dns.detail || 'unknown');
        document.getElementById('overviewPosture').innerHTML =
          (nodes.length ? chip('Nodes', nodesReady + '/' + nodes.length, '#pulse', nodesReady === nodes.length ? 'status' : 'danger', 'Kubernetes nodes ready') : '') +
          chip('Travel', travelState, '#travel', travelChipTone, travelHeadline) +
          chip('Route', runningMode, '#transmission', runningMode === 'unknown' ? 'warning' : 'status', 'Transmission · desired ' + desiredMode) +
          chip('Advisor', fetchState === 'live' ? 'live' : 'offline', '#tuning', fetchState === 'live' ? 'status' : 'warning', fetchDetail) +
          (dns ? chip('DNS', dnsKnown ? dns.records + (dns.quota ? '/' + dns.quota : '') : 'offline', dns.dashboardUrl || '#overview', dnsTone, dnsDetail, Boolean(dns.dashboardUrl)) : '');

        // The headline counts states that need a look; the chips say which.
        const attention = [nodes.length && nodesReady !== nodes.length, travelState !== 'ready', runningMode === 'unknown', fetchState !== 'live', dns && dnsTone !== 'status'].filter(Boolean).length;
        document.getElementById('overviewHeadline').textContent = attention ? attention + ' to check' : 'All clear';

        const meta = [];
        if (tuning && tuning.fetch) meta.push('<span>advisor ' + fmtAgo(tuning.fetch.lastRunAt) + '</span>');
        if (updates && updates.checkedAt) meta.push('<span>images ' + fmtAgo(updates.checkedAt) + '</span>');
        if (helmUpdates && helmUpdates.checkedAt) meta.push('<span>charts ' + fmtAgo(helmUpdates.checkedAt) + '</span>');
        if (travel && travel.checkedAt) meta.push('<span>travel ' + fmtAgo(travel.checkedAt) + '</span>');
        if (dns && dns.checkedAt) meta.push('<span>dns ' + fmtAgo(dns.checkedAt) + '</span>');
        overviewMetaEl.innerHTML = meta.join('');
        renderOverviewDigest(services, updateItems, helmUpdateItems);
        renderNavHealth({
          shares: activeExposures,
          updates: updateCount,
          route: desiredMode,
          travel: travelState,
        });
        exposureMetaEl.textContent = activeExposures + ' public';
        auditMetaEl.textContent = String((dashboardState.audit || []).length);
      }

      function jobTone(status) {
        const value = String(status || '').toLowerCase();
        if (value === 'succeeded') return 'ok';
        if (value === 'running') return 'warning';
        if (value === 'failed') return 'danger';
        return 'neutral';
      }

      function renderJobs(payload) {
        const data = payload || { items: [], summary: {} };
        const items = Array.isArray(data.items) ? data.items : [];
        const summary = data.summary || {};
        const failedRuns = items.reduce((sum, item) => sum + (Array.isArray(item.recentRuns) ? item.recentRuns.filter((run) => run.status === 'failed').length : 0), 0);
        const running = Number(summary.running || 0);
        const suspended = Number(summary.suspended || 0);
        const total = Number(summary.total || items.length);
        const found = Number(summary.found || 0);
        // A refresh after Save or Run must not fold the row being worked on.
        const openJobs = new Set(Array.from(jobsListEl.querySelectorAll('.job-details[open]'), (node) => node.closest('[data-job-card]')?.dataset.jobCard));

        dashboardState.jobs = data;
        // Only the facts that are not zero earn a place in the summary.
        jobsSummaryEl.textContent = [
          total + (total === 1 ? ' job' : ' jobs'),
          found !== total ? (total - found) + ' missing' : '',
          running ? running + ' running' : '',
          suspended ? suspended + ' suspended' : '',
          failedRuns ? failedRuns + ' failed' : '',
          'checked ' + fmtAgo(data.checkedAt),
        ].filter(Boolean).join(' · ');

        if (!items.length) {
          jobsListEl.innerHTML = '<div class="empty-state">No jobs.</div>';
          return;
        }

        jobsListEl.innerHTML = items.map((job) => {
          const status = job.status || {};
          const runs = Array.isArray(job.recentRuns) ? job.recentRuns : [];
          const latest = runs[0] || null;
          const id = escapeHtml(job.id);
          const recent = runs.slice(0, 12);
          const runRows = runs.length
            ? runs.map((run) =>
              '<tr>' +
                '<td><div class="svc-name">' + escapeHtml(run.name || 'run') + '</div><div class="svc-id">' + escapeHtml((run.podNames || []).join(', ') || 'no pod') + '</div></td>' +
                '<td><span class="pill" data-tone="' + jobTone(run.status) + '">' + escapeHtml(run.status || 'unknown') + '</span></td>' +
                '<td>' + fmtDateTime(run.startedAt) + '</td>' +
                '<td>' + (run.durationSeconds == null ? '—' : String(run.durationSeconds) + 's') + '</td>' +
                '<td class="job-log-cell"><button class="job-log-btn" type="button" data-job-log="' + id + '" data-job-run="' + escapeHtml(run.name || '') + '">Logs</button></td>' +
              '</tr>'
            ).join('')
            : '<tr><td colspan="5" class="empty-state">No runs.</td></tr>';
          return (
            '<article class="job-card" data-job-card="' + id + '">' +
              '<div class="job-head">' +
                '<div><h3 class="card-title">' + escapeHtml(job.title || job.id) + '</h3><div class="meta-line">' + escapeHtml(job.namespace || '') + '/' + escapeHtml(job.cronJob || '') + '</div></div>' +
                '<div class="job-status">' +
                  (!job.found ? '<span class="pill" data-tone="danger">missing</span>' : '') +
                  '<span class="pill" data-tone="' + (status.suspend ? 'warning' : 'ok') + '">' + (status.suspend ? 'suspended' : 'scheduled') + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="job-brief">' +
                '<span>' + escapeHtml(status.schedule || 'no schedule') + ' <span class="muted">' + escapeHtml(status.timeZone || '') + '</span></span>' +
                (recent.length ? '<span class="run-dots" role="img" aria-label="' + attrText('Recent runs, oldest first: ' + recent.map((run) => run.status || 'unknown').reverse().join(', ')) + '">' + recent.map((run) => '<i data-status="' + escapeHtml(run.status || 'unknown') + '"></i>').join('') + '</span>' : '') +
                '<span class="muted">' + (latest ? escapeHtml(latest.status || 'unknown') + ' · ' + fmtAgo(latest.startedAt) : 'no runs') + '</span>' +
                '<button type="button" data-job-run="' + id + '">Run</button>' +
              '</div>' +
              '<details class="job-details"' + (openJobs.has(job.id) ? ' open' : '') + '><summary>Schedule &amp; history</summary>' +
                '<div class="job-config-grid">' +
                  '<label><span class="eyebrow">Schedule</span><input class="job-input" data-job-schedule="' + id + '" type="text" value="' + escapeHtml(status.schedule || '') + '" /></label>' +
                  '<label><span class="eyebrow">Timezone</span><input class="job-input" data-job-timezone="' + id + '" type="text" value="' + escapeHtml(status.timeZone || '') + '" /></label>' +
                  '<label class="check-chip"><input data-job-suspend="' + id + '" type="checkbox" ' + (status.suspend ? 'checked' : '') + ' /><span>Suspend</span></label>' +
                  '<button type="button" data-job-save="' + id + '">Save</button>' +
                '</div>' +
                '<div class="meta-line">' +
                  '<span>scheduled ' + fmtAgo(status.lastScheduleTime) + '</span>' +
                  '<span>succeeded ' + fmtAgo(status.lastSuccessfulTime) + '</span>' +
                  '<span>policy ' + escapeHtml(status.concurrencyPolicy || 'Allow') + '</span>' +
                '</div>' +
                '<div class="table-shell job-runs-shell"><table><thead><tr><th>Run</th><th>State</th><th>Started</th><th>Duration</th><th><span class="sr-only">Logs</span></th></tr></thead><tbody>' + runRows + '</tbody></table></div>' +
                '<div class="job-log-shell"><pre data-job-log-output="' + id + '">' + (latest && latest.logs ? escapeHtml(latest.logs) : 'No logs.') + '</pre></div>' +
              '</details>' +
            '</article>'
          );
        }).join('');
      }

      async function loadJobs(options) {
        const force = Boolean(options && options.force);
        if (force) setBtnLoading(jobsRefreshBtn, true);
        try {
          renderJobs(await request('/api/jobs', 'GET'));
        } catch (err) {
          jobsSummaryEl.textContent = 'unavailable';
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
        const hashTag = text.match(/^(.*?)([a-f0-9]{12,64})$/i);
        if (hashTag) return hashTag[1] + hashTag[2].slice(0, 7);
        return text.length <= 26 ? text : text.slice(0, 25) + '…';
      }

      function deployTag(label, value) {
        const full = String(value || 'n/a');
        return '<span class="site-deploy-tag has-full-tooltip" title="' + attrText(full) + '" data-full-tooltip="' + attrText(full) + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(shortHash(full)) + '</strong></span>';
      }

      function syncSiteDeploymentActivity() {
        const all = siteDeployOperations.get('*');
        const allPending = Boolean(all && all.pending);
        const pendingOperations = Array.from(siteDeployOperations.values()).filter((operation) => operation.pending);
        const beamOperation = allPending ? null : pendingOperations.filter((operation) => operation.beaming).at(-1);
        const anyPending = pendingOperations.length > 0;
        siteDeployAllBtn.disabled = anyPending;
        siteDeployAllBtn.textContent = allPending ? 'Reconciling all…' : 'Deploy all';
        siteDeployMsgEl.classList.toggle('is-deploying', allPending);
        siteDeployMsgEl.classList.toggle('is-beaming', Boolean(allPending && all.beaming));
        siteDeployListEl.querySelectorAll('[data-site-id]').forEach((card) => {
          const operation = siteDeployOperations.get(card.dataset.siteId);
          const pending = Boolean(operation && operation.pending);
          card.classList.toggle('is-deploying', pending);
          card.classList.toggle('is-beaming', Boolean(pending && operation === beamOperation));
          const button = card.querySelector('[data-site-deploy-run]');
          button.disabled = pending || allPending;
          button.textContent = pending ? 'Reconciling…' : 'Deploy';
          const progress = card.querySelector('.deploy-progress');
          progress.textContent = operation ? operation.label : '';
          progress.classList.toggle('is-error', Boolean(operation && operation.error));
          progress.title = operation ? operation.detail || '' : '';
        });
      }

      function beginSiteDeployment(siteId) {
        const allPending = siteDeployOperations.get('*')?.pending;
        const samePending = siteDeployOperations.get(siteId)?.pending;
        const anyPending = Array.from(siteDeployOperations.values()).some((operation) => operation.pending);
        if (allPending || samePending || (siteId === '*' && anyPending)) return null;
        if (siteId === '*') siteDeployOperations.clear();
        const operation = { pending: true, beaming: false, label: 'Requesting Flux reconcile…' };
        // Keep insertion order aligned with request start, including retries.
        siteDeployOperations.delete(siteId);
        siteDeployOperations.set(siteId, operation);
        operation.timer = window.setTimeout(() => {
          operation.beaming = true;
          syncSiteDeploymentActivity();
        }, 3000);
        syncSiteDeploymentActivity();
        return operation;
      }

      function finishSiteDeployment(operation, error, detail) {
        window.clearTimeout(operation.timer);
        operation.pending = false;
        operation.beaming = false;
        operation.error = Boolean(error);
        operation.label = error ? 'Reconcile request failed' : 'Reconcile requested';
        operation.detail = detail || '';
        syncSiteDeploymentActivity();
      }

      function renderSiteDeployments(payload) {
        const data = payload || { items: [] };
        const items = Array.isArray(data.items) ? data.items : [];
        const focusedSite = document.activeElement?.dataset.siteDeployRun;
        dashboardState.siteDeployments = data;
        const readyCount = items.filter((item) => item && item.ready).length;
        const errorCount = items.filter((item) => item && item.errors && item.errors.length).length;
        siteDeploySummaryEl.textContent = readyCount + '/' + items.length + ' ready' + (errorCount ? ' · ' + errorCount + ' with errors' : '') + ' · checked ' + fmtTime(data.checkedAt);

        if (!items.length) {
          siteDeployListEl.innerHTML = '<div class="empty-state">No sites.</div>';
          syncSiteDeploymentActivity();
          return;
        }
        // One ledger row per site; the list's column grid aligns tags and actions.
        siteDeployListEl.innerHTML = items.map((item) => {
          const ready = item.ready;
          const link = item.url ? '<a class="link" href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer">Open<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-arrow"/></svg></a>' : '<span class="muted">internal</span>';
          const errorText = item.errors && item.errors.length ? '<div class="site-deploy-errors">' + escapeHtml(item.errors.join(' · ')) + '</div>' : '';
          const readyDetail = 'Kustomization: ' + conditionLabel(item.kustomizationReady) + ' · Helm: ' + conditionLabel(item.helmReleaseReady);
          return (
            '<article class="deploy-row" data-site-id="' + attrText(item.id) + '">' +
              '<div class="deploy-name">' +
                '<h3 class="card-title">' + escapeHtml(item.title || item.id) + '</h3>' +
                (ready ? '' : '<div class="meta-line">' + escapeHtml(readyDetail) + '</div>') +
                '<div class="deploy-progress" role="status" aria-live="polite"></div>' +
                errorText +
              '</div>' +
              '<span class="pill" data-tone="' + (ready ? 'ok' : 'warning') + '" title="' + attrText(readyDetail) + '">' + (ready ? 'ready' : 'check') + '</span>' +
              deployTag('current', item.currentTag || 'n/a') +
              deployTag('policy', item.latestTag || 'n/a') +
              '<span class="deploy-scanned" title="' + attrText('Scanned ' + fmtDateTime(item.lastScanTime)) + '">' + escapeHtml(fmtTime(item.lastScanTime)) + '</span>' +
              '<div class="deploy-actions">' +
                link +
                '<button type="button" data-site-deploy-run="' + attrText(item.id) + '">Deploy</button>' +
              '</div>' +
            '</article>'
          );
        }).join('');
        syncSiteDeploymentActivity();
        if (focusedSite) {
          siteDeployListEl.querySelector('[data-site-deploy-run="' + CSS.escape(focusedSite) + '"]:not(:disabled)')?.focus({ preventScroll: true });
        }
      }

      async function loadSiteDeployments(options) {
        const force = Boolean(options && options.force);
        const hasPendingOperation = () => Array.from(siteDeployOperations.values()).some((operation) => operation.pending);
        if (force) {
          setBtnLoading(siteDeployRefreshBtn, true);
          if (!hasPendingOperation()) setSiteDeployMsg('Refreshing…');
        }
        try {
          const payload = await request('/api/site-deployments', 'GET');
          renderSiteDeployments(payload);
          if (force && !hasPendingOperation()) setSiteDeployMsg('');
        } catch (err) {
          siteDeploySummaryEl.textContent = 'Deploy snapshot unavailable';
          // Keep existing controls and any in-flight operation visible on a failed refresh.
          if (!dashboardState.siteDeployments) {
            siteDeployListEl.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
          }
          if (!hasPendingOperation()) setSiteDeployMsg('Could not refresh deploy targets: ' + err.message, true);
        } finally {
          if (force) setBtnLoading(siteDeployRefreshBtn, false);
        }
      }

      async function runSiteDeployment(siteId, button) {
        const restoreFocus = document.activeElement === button;
        const operation = beginSiteDeployment(siteId);
        if (!operation) return;
        setSiteDeployMsg('Reconciling ' + siteId + '…');
        try {
          const payload = await request('/api/site-deployments/' + encodeURIComponent(siteId) + '/run', 'POST', {});
          const handled = (payload.steps || []).filter((step) => step.handled).length;
          const total = (payload.steps || []).length;
          const acknowledgment = handled + '/' + total + ' controllers acknowledged.';
          finishSiteDeployment(operation, false, acknowledgment);
          setSiteDeployMsg(siteId + ' · ' + acknowledgment);
          await loadSiteDeployments();
        } catch (err) {
          finishSiteDeployment(operation, true, err.message);
          setSiteDeployMsg(err.message, true);
        } finally {
          if (restoreFocus && activePage === 'deploy' && document.activeElement === document.body) {
            siteDeployListEl.querySelector('[data-site-deploy-run="' + CSS.escape(siteId) + '"]:not(:disabled)')?.focus({ preventScroll: true });
          }
        }
      }

      async function runAllSiteDeployments(button) {
        const operation = beginSiteDeployment('*');
        if (!operation) return;
        setSiteDeployMsg('Reconciling all…');
        try {
          const payload = await request('/api/site-deployments/run', 'POST', {});
          const steps = (payload.results || []).flatMap((result) => result.steps || []);
          const handled = steps.filter((step) => step.handled).length;
          const total = steps.length;
          const acknowledgment = handled + '/' + total + ' controllers acknowledged.';
          finishSiteDeployment(operation, false, acknowledgment);
          setSiteDeployMsg('all · ' + acknowledgment);
          await loadSiteDeployments();
        } catch (err) {
          finishSiteDeployment(operation, true, err.message);
          setSiteDeployMsg(err.message, true);
        }
      }

      async function saveJobConfig(jobId, button) {
        const scheduleEl = jobsListEl.querySelector('[data-job-schedule="' + CSS.escape(jobId) + '"]');
        const timeZoneEl = jobsListEl.querySelector('[data-job-timezone="' + CSS.escape(jobId) + '"]');
        const suspendEl = jobsListEl.querySelector('[data-job-suspend="' + CSS.escape(jobId) + '"]');
        setBtnLoading(button, true);
        setJobsMsg('Saving ' + jobId + '…');
        try {
          const payload = await request('/api/jobs/' + encodeURIComponent(jobId), 'PATCH', {
            schedule: scheduleEl ? scheduleEl.value : undefined,
            timeZone: timeZoneEl ? timeZoneEl.value : undefined,
            suspend: suspendEl ? suspendEl.checked : false,
          });
          setJobsMsg(payload.gitops && payload.gitops.changed ? 'Saved ' + jobId + '.' : 'No change.');
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
        setJobsMsg('Starting ' + jobId + '…');
        try {
          const payload = await request('/api/jobs/' + encodeURIComponent(jobId) + '/run', 'POST', {});
          setJobsMsg('Started ' + (payload.jobName || jobId) + '.');
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
        if (output) output.textContent = 'Loading…';
        try {
          const payload = await request('/api/jobs/' + encodeURIComponent(jobId) + '/runs/' + encodeURIComponent(jobName) + '/logs', 'GET');
          if (output) output.textContent = payload.logs || 'No logs.';
          output?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (err) {
          if (output) output.textContent = err.message;
          setJobsMsg(err.message, true);
        } finally {
          setBtnLoading(button, false);
        }
      }

      function renderTravel(travel) {
        const travelData = travel || null;
        const activeServices = (dashboardState.services || []).filter((svc) => svc.enabled && !isAgent(svc));
        if (!travelData) {
          travelSummaryEl.textContent = 'unavailable';
          travelSummaryEl.title = '';
          travelOverviewStripEl.innerHTML = '';
          travelOverviewMetaEl.innerHTML = '';
          travelBundlesMetaEl.textContent = '';
          travelBundlesEl.innerHTML = '<div class="empty-state">Travel data unavailable.</div>';
          travelNotesMetaEl.textContent = '';
          travelSharesEl.innerHTML = '<p class="empty-line">—</p>';
          travelNotesEl.innerHTML = '<p class="empty-line">—</p>';
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

        // An open fact: label, a lamp with its reading, and one line of detail.
        function fact(label, value, detail, tone) {
          return '<div class="fact"><div class="eyebrow">' + label + '</div>' +
            '<div class="fact-value">' + (tone && tone !== 'neutral' ? '<span class="lamp ' + tone + '"></span>' : '') + escapeHtml(value) + '</div>' +
            '<div class="fact-sub">' + escapeHtml(detail) + '</div></div>';
        }

        travelSummaryEl.innerHTML = travelStatusPill(travelData.summary ? travelData.summary.state : '');
        travelSummaryEl.title = travelData.summary && travelData.summary.headline ? travelData.summary.headline : '';
        travelOverviewStripEl.innerHTML =
          fact('Private path', travelStateLabel(privateAccess.state), String(privateAccess.ready || 0) + ' ready · ' + String(privateAccess.degraded || 0) + ' degraded', travelTone(privateAccess.state)) +
          fact('Exit node', travelStateLabel(exitNode.state), connector.name || 'connector', travelTone(exitNode.state)) +
          fact('Transmission', transmission.desiredMode || 'unknown', 'running ' + (transmission.effectiveMode || 'unknown') + (transmission.placeholderConfig ? ' · placeholder config' : ''), transmission.rolloutPending || transmission.desiredMode === 'vpn' ? 'warning' : 'status') +
          fact('Public access', String(activeShareCount), activeShareCount ? 'public now' : 'all private', activeShareCount > 0 ? 'warning' : 'status');
        travelOverviewMetaEl.innerHTML =
          '<span>checked ' + fmtAgo(travelData.checkedAt) + '</span>' +
          '<span>' + String((connector.advertisedRoutes || []).length) + ' routes</span>';
        travelBundlesMetaEl.textContent = '';
        travelBundlesEl.innerHTML = bundles.map((bundle) => {
          const targets = Array.isArray(bundle.targets) ? bundle.targets : [];
          const items = targets.length
            ? targets.map((target) =>
              '<li class="row">' +
                '<a class="row-main" href="' + escapeHtml(target.url || '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(target.name || target.id || 'target') + '</a>' +
                travelTargetMark(target.state) +
                (target.state !== 'ready' ? '<div class="travel-target-meta">' + escapeHtml(target.detail || 'Probe unavailable') + '</div>' : '') +
              '</li>'
            ).join('')
            : '<li class="row"><span class="muted">Empty</span></li>';
          return (
            '<section class="column travel-card">' +
              '<div class="column-head"><h3 class="card-title">' + escapeHtml(bundle.name || bundle.id || 'bundle') + '</h3>' + travelStatusPill(bundle.state) + '</div>' +
              '<ul class="rows">' + items + '</ul>' +
            '</section>'
          );
        }).join('');

        travelNotesMetaEl.textContent = '';
        travelSharesEl.innerHTML = activeServices.length
          ? '<ul class="rows">' + activeServices.map((svc) =>
            '<li class="row">' +
              '<a class="row-main" href="' + escapeHtml(svc.publicUrl || '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(svc.name || svc.id || 'service') + '</a>' +
              '<span class="row-sub">' + escapeHtml(svc.authMode || 'none') + ' · ' + escapeHtml(fmtExpiry(svc.expiresAt, svc.enabled).text) + '</span>' +
            '</li>'
          ).join('') + '</ul>'
          : '<p class="empty-line">All private</p>';
        travelNotesEl.innerHTML = notes.length
          ? notes.map((note) =>
            '<div class="travel-note-item"><span class="lamp ' + (note.level === 'warn' ? 'warning' : 'status') + '"></span>' +
              '<span>' + escapeHtml(note.message || '') + '</span></div>'
          ).join('')
          : '<p class="empty-line">None</p>';

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
          vpnMetaEl.textContent = '';
          vpnSectionMetaEl.textContent = 'unavailable';
          vpnSwitch.disabled = true;
          vpnSwitch.classList.remove('on');
          vpnSwitch.setAttribute('aria-checked', 'false');
          vpnToggleLabels.forEach((label) => label.classList.remove('active'));
          return;
        }
        const desiredMode = status.desiredMode || 'direct';
        const effectiveMode = status.effectiveMode || 'pending';
        const meta = [(status.provider || 'custom') + '/' + (status.vpnType || 'wireguard')];
        if (desiredMode !== effectiveMode) meta.unshift('desired ' + desiredMode);
        if (status.rolloutPending) meta.push('rollout pending');
        if (status.placeholderConfig) meta.push('placeholder config');
        vpnMetaEl.innerHTML = meta.map((item) => '<span>' + escapeHtml(item) + '</span>').join('');
        vpnSectionMetaEl.textContent = effectiveMode;
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
        tuningView.render(tuning);
      }

      function shareMatches(query, view, service) {
        const text = [service.name, service.id, service.publicHost].join(' ').toLowerCase();
        return (view !== 'active' || Boolean(service.enabled)) && text.includes(query.trim().toLowerCase());
      }

      // Agent hosts are standing endpoints for machine clients, not temporary
      // shares: they live in their own block and stay out of share counts.
      function isAgent(service) {
        return Boolean(service) && service.kind === 'agent';
      }

      function filterShares() {
        let visible = 0;
        const services = (dashboardState.services || []).filter((service) => !isAgent(service));
        rowsEl.querySelectorAll('[data-service-id]').forEach((row) => {
          const service = services.find((item) => item.id === row.dataset.serviceId);
          row.hidden = !service || !shareMatches(sharesSearch.value, shareView, service);
          if (!row.hidden) visible += 1;
        });
        const empty = rowsEl.querySelector('[data-share-empty]');
        if (empty) empty.hidden = visible > 0;
        document.getElementById('accessCount').textContent = visible + ' / ' + services.length;
        shareViewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.shareView === shareView)));
      }
      sharesSearch.addEventListener('input', filterShares);
      shareViewButtons.forEach((button) => {
        button.onclick = () => { shareView = button.dataset.shareView; filterShares(); };
      });

      const SHARE_HOURS = [0.25, 0.5, 1, 2, 6, 12, 24, null];
      // A live share gains time in these steps, or takes them as a fresh
      // expiry when it has none.
      const EXTEND_HOURS = [0.25, 1, 6, 24];
      const ACCESS_CHOICES = [['none', 'Anyone with link'], ['cloudflare-access', 'Cloudflare login']];
      // The share being set up, kept across re-renders: { id, hours, authMode }.
      let shareDraft = null;
      // The one row whose panel is open.
      let openShareId = null;

      function fmtShareHours(hours) {
        if (hours === null) return 'never';
        return hours < 1 ? Math.round(hours * 60) + 'm' : hours + 'h';
      }

      function accessLabel(mode) {
        return mode === 'cloudflare-access' ? 'cf login' : 'anyone';
      }

      const untilFormatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
      const untilDayFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

      function fmtUntil(value) {
        const date = validDate(value);
        if (!date) return '';
        const today = date.toDateString() === new Date().toDateString();
        return 'until ' + (today ? untilFormatter : untilDayFormatter).format(date);
      }

      function serviceById(id) {
        return (dashboardState.services || []).find((service) => service.id === id) || null;
      }

      function shareRow(id) {
        return Array.from(rowsEl.children).find((row) => row.dataset.serviceId === id) || null;
      }

      // Every exposure action reports through one toast: busy while the
      // request runs, then the outcome at the moment the page shows it.
      const MIN_BUSY_MS = 450;

      function shareTerms(service) {
        const expiry = service.expiresAt ? fmtExpiry(service.expiresAt, true).text : 'no expiry';
        return expiry + ' · ' + accessLabel(service.authMode);
      }

      function namesOf(services) {
        const names = services.map((service) => service.name || service.id);
        return names.length > 3 ? names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more' : names.join(', ');
      }

      // Snapshots returned by the API update the page at once; the rest of
      // the dashboard refreshes in the background.
      function applyServiceSnapshots(result) {
        const snapshots = (result && (result.services || (result.service ? [result.service] : []))) || [];
        const byId = new Map(snapshots.filter((service) => service && service.id).map((service) => [service.id, service]));
        if (!byId.size) return;
        dashboardState.services = (dashboardState.services || []).map((service) => byId.get(service.id) || service);
        renderRows(dashboardState.services);
        renderOverview();
      }

      async function runExposure(task) {
        const { btn, busy, request, done, fail } = task;
        const started = Date.now();
        window.Fx.toast('shares', busy.text, { tone: 'busy', detail: busy.detail });
        try {
          mutationInFlight += 1;
          if (btn) setBtnLoading(btn, true);
          const result = await request();
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_BUSY_MS - (Date.now() - started))));
          applyServiceSnapshots(result);
          const outcome = done(result || {});
          window.Fx.toast('shares', outcome.text, { tone: outcome.tone || 'done', detail: outcome.detail, action: outcome.action });
          void loadDashboard({ silent: true });
          return result || {};
        } catch (err) {
          window.Fx.toast('shares', fail, {
            tone: 'danger',
            detail: err.message,
            action: { label: 'Retry', run: () => runExposure({ ...task, btn: null }) },
          });
          return null;
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          if (btn) setBtnLoading(btn, false);
        }
      }

      async function copyShareLink(service) {
        try {
          await navigator.clipboard.writeText(service.publicUrl);
          window.Fx.toast('shares', 'Link copied', { detail: service.publicUrl });
        } catch {
          window.Fx.toast('shares', 'Clipboard blocked', { tone: 'danger', detail: service.publicUrl });
        }
      }

      function shareOpened(label, service) {
        return { text: label + ' is public', detail: shareTerms(service), action: { label: 'Copy link', run: () => copyShareLink(service) } };
      }

      // Undo puts back whatever time was left, rounded up to the API's
      // 15-minute steps; more than a day left cannot be expressed.
      function remainingTerms(previous) {
        if (!previous.expiresAt) return { hours: null };
        const left = (Date.parse(previous.expiresAt) - Date.now()) / 3600000;
        if (!(left > 0) || left > 24) return null;
        return { hours: Math.min(24, Math.max(0.25, Math.ceil(left * 4) / 4)) };
      }

      function reopenShare(previous) {
        const label = previous.name || previous.id;
        const terms = remainingTerms(previous) || { hours: 24 };
        return runExposure({
          busy: { text: 'Reopening ' + label + '…', detail: previous.publicHost },
          request: () => exposureClient.enable(previous.id, { ...terms, authMode: previous.authMode === 'cloudflare-access' ? 'cloudflare-access' : 'none' }),
          done: ({ service }) => shareOpened(label, service || previous),
          fail: 'Couldn\'t reopen ' + label,
        });
      }

      function stopShare(id, btn) {
        const svc = serviceById(id);
        if (!svc || mutationInFlight > 0) return null;
        const label = svc.name || svc.id;
        if (openShareId === id) closeSharePanel();
        return runExposure({
          btn,
          busy: { text: 'Closing ' + label + '…', detail: svc.publicHost },
          request: () => exposureClient.disable(id),
          done: () => ({ text: label + ' is private', detail: svc.publicHost, action: { label: 'Undo', run: () => reopenShare(svc) } }),
          fail: 'Couldn\'t close ' + label,
        });
      }

      // Edits a live share in place: more time, a fresh expiry, or new access.
      // The server refuses a share that has closed meanwhile.
      async function editShare(id, change, btn) {
        const svc = serviceById(id);
        if (!svc || !svc.enabled || mutationInFlight > 0) return null;
        const label = svc.name || svc.id;
        const accessOnly = change.authMode !== undefined && change.hours === undefined && change.extendHours === undefined;
        const busy = change.extendHours ? 'Extending ' + label + '…'
          : accessOnly ? 'Changing access to ' + label + '…' : 'Changing expiry of ' + label + '…';
        const result = await runExposure({
          btn,
          busy: { text: busy, detail: svc.publicHost },
          request: () => exposureClient.update(id, change),
          done: ({ service }) => {
            const next = service || svc;
            const text = change.extendHours ? label + ' extended'
              : accessOnly ? (next.authMode === 'cloudflare-access' ? label + ' needs a login' : label + ' is open to anyone')
                : next.expiresAt ? label + ' expiry changed' : label + ' has no expiry';
            const undo = accessOnly ? { authMode: svc.authMode === 'cloudflare-access' ? 'cloudflare-access' : 'none' } : remainingTerms(svc);
            return { text, detail: shareTerms(next), action: undo ? { label: 'Undo', run: () => editShare(id, undo) } : undefined };
          },
          fail: 'Couldn\'t change ' + label,
        });
        // A refused edit leaves the page on the last known state.
        if (!result && openShareId === id) {
          const row = shareRow(id);
          const current = serviceById(id);
          if (row && current) renderSharePanel(row, current);
        }
        return result;
      }

      // One segmented choice; the shared glide thumb follows the pressed option.
      function segmented(label, options, current, onPick, key) {
        const group = document.createElement('div');
        group.className = 'view-switch access-switch';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', label);
        const thumb = document.createElement('span');
        thumb.className = 'glide-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        group.appendChild(thumb);
        options.forEach(([value, text]) => {
          const option = document.createElement('button');
          option.type = 'button';
          option.textContent = text;
          option.dataset.focusKey = key + ':' + String(value);
          option.setAttribute('aria-pressed', String(value === current));
          option.onclick = () => {
            if (option.getAttribute('aria-pressed') === 'true') return;
            group.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === option)));
            onPick(value);
          };
          group.appendChild(option);
        });
        window.Fx.glide(group, thumb, '[aria-pressed="true"]', 'x');
        return group;
      }

      function panelField(label, ...content) {
        const field = document.createElement('div');
        field.className = 'access-field';
        const caption = document.createElement('span');
        caption.className = 'eyebrow';
        caption.textContent = label;
        const value = document.createElement('div');
        value.className = 'access-field-value';
        value.append(...content);
        field.append(caption, value);
        return field;
      }

      function panelButton(text, className, onClick, focusKey) {
        const button = document.createElement('button');
        button.type = 'button';
        if (className) button.className = className;
        button.textContent = text;
        if (focusKey) button.dataset.focusKey = focusKey;
        button.onclick = () => onClick(button);
        return button;
      }

      function panelActions(...buttons) {
        const actions = document.createElement('div');
        actions.className = 'access-panel-actions';
        actions.append(...buttons);
        return actions;
      }

      // A private service: pick how long and for whom, then one button that
      // says exactly what it will do.
      function composeBody(svc) {
        if (!shareDraft || shareDraft.id !== svc.id) {
          const defaultHours = Number(svc.defaultExpiryHours || 1);
          shareDraft = {
            id: svc.id,
            hours: SHARE_HOURS.includes(defaultHours) ? defaultHours : 1,
            authMode: svc.authMode === 'cloudflare-access' ? 'cloudflare-access' : 'none',
          };
        }
        const draft = shareDraft;
        const label = svc.name || svc.id;
        const body = document.createElement('div');
        body.className = 'access-panel-body';
        const go = panelButton('', 'primary access-go', (button) => runExposure({
          btn: button,
          busy: { text: 'Opening ' + label + '…', detail: svc.publicHost },
          request: () => exposureClient.enable(svc.id, { hours: draft.hours, authMode: draft.authMode }),
          done: ({ service }) => {
            if (shareDraft === draft) shareDraft = null;
            return shareOpened(label, service || svc);
          },
          fail: 'Couldn\'t open ' + label,
        }), 'go');
        const name = () => { go.textContent = draft.hours === null ? 'Share until stopped' : 'Share for ' + fmtShareHours(draft.hours); };
        name();
        const expiry = segmented('Expires', SHARE_HOURS.map((hours) => [hours, fmtShareHours(hours)]), draft.hours, (hours) => {
          draft.hours = hours;
          name();
        }, 'hours');
        expiry.querySelector('[aria-pressed="true"]').dataset.autofocus = '';
        const access = segmented('Access', ACCESS_CHOICES, draft.authMode, (mode) => { draft.authMode = mode; }, 'access');
        body.append(
          panelField('Expires', expiry),
          panelField('Access', access),
          panelActions(panelButton('Cancel', 'ghost', () => closeSharePanel({ focus: true })), go),
        );
        return body;
      }

      // A live share: its link, more time, who can open it, and a way out.
      function manageBody(svc) {
        const id = svc.id;
        const body = document.createElement('div');
        body.className = 'access-panel-body';

        const link = document.createElement('a');
        link.className = 'access-url';
        link.href = String(svc.publicUrl || '#');
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.innerHTML = escapeHtml(svc.publicHost || '') + '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-arrow"/></svg>';
        const copy = panelButton('Copy link', '', () => copyShareLink(serviceById(id) || svc), 'copy');
        copy.dataset.autofocus = '';

        const timed = Boolean(svc.expiresAt);
        const now = document.createElement('span');
        now.className = 'access-until';
        if (timed) {
          const expiry = fmtExpiry(svc.expiresAt, true);
          now.innerHTML = '<span class="expiry ' + expiry.state + '" data-expires-at="' + escapeHtml(svc.expiresAt) + '" data-enabled="1">' +
            escapeHtml(expiry.text) + '</span><span>' + escapeHtml(fmtUntil(svc.expiresAt)) + '</span>';
        } else {
          now.textContent = 'no expiry';
        }
        const chips = document.createElement('div');
        chips.className = 'chip-row';
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-label', timed ? 'Extend' : 'Expire in');
        EXTEND_HOURS.forEach((hours) => {
          const text = timed ? '+' + fmtShareHours(hours) : fmtShareHours(hours);
          const chip = panelButton(text, 'time-chip', (button) => editShare(id, timed ? { extendHours: hours } : { hours }, button), 'time:' + hours);
          chip.setAttribute('aria-label', (timed ? 'Extend by ' : 'Expire in ') + fmtShareHours(hours));
          chips.appendChild(chip);
        });
        if (timed) {
          const divider = document.createElement('span');
          divider.className = 'chip-divider';
          divider.setAttribute('aria-hidden', 'true');
          chips.append(divider, panelButton('No expiry', 'time-chip', (button) => editShare(id, { hours: null }, button), 'time:never'));
        }
        const timeValue = [now, chips];
        if (!timed) {
          const caption = document.createElement('span');
          caption.className = 'access-caption';
          caption.textContent = 'expire in';
          timeValue.splice(1, 0, caption);
        }

        const access = segmented('Access', ACCESS_CHOICES, svc.authMode === 'cloudflare-access' ? 'cloudflare-access' : 'none',
          (mode) => editShare(id, { authMode: mode }), 'access');

        body.append(
          panelField('Link', link, copy),
          panelField('Expires', ...timeValue),
          panelField('Access', access),
          panelActions(
            panelButton('Done', 'ghost', () => closeSharePanel({ focus: true })),
            panelButton('Stop sharing', 'danger', (button) => stopShare(id, button), 'stop'),
          ),
        );
        return body;
      }

      function sharePanelOf(row) {
        return Array.from(row.children).find((node) => node.classList.contains('access-panel') && !node.classList.contains('is-closing')) || null;
      }

      // Repaints an open panel for the share's current state. When a share
      // goes public from its panel, the panel turns into its editor in place.
      function renderSharePanel(row, svc, options) {
        const panel = sharePanelOf(row);
        if (!panel) return;
        const inner = panel.firstElementChild;
        const live = Boolean(svc.enabled);
        panel.setAttribute('aria-label', (live ? 'Edit ' : 'Share ') + (svc.name || svc.id));
        // A pressed button is disabled while its request runs, which drops
        // focus to the page; the panel remembers it and puts it back.
        const active = document.activeElement;
        const lost = !active || active === document.body;
        const focusKey = active && panel.contains(active) ? active.dataset.focusKey : lost ? panel.dataset.focusKey : null;
        const morph = Boolean(options && options.morph) && panel.classList.contains('is-settled');
        const from = morph ? inner.offsetHeight : 0;
        const body = live ? manageBody(svc) : composeBody(svc);
        inner.replaceChildren(body);
        if (morph) {
          body.classList.add('is-entering');
          const to = inner.offsetHeight;
          if (from && to && from !== to) {
            inner.style.overflow = 'hidden';
            inner.style.height = from + 'px';
            void inner.offsetHeight;
            inner.style.transition = 'height 240ms var(--ease-out)';
            inner.style.height = to + 'px';
            setTimeout(() => { inner.style.height = ''; inner.style.transition = ''; inner.style.overflow = ''; }, 260);
          }
        }
        const target = (!morph && focusKey && body.querySelector('[data-focus-key="' + focusKey + '"]')) ||
          (morph && (lost || panel.contains(active)) ? body.querySelector('[data-autofocus]') : null);
        if (target) target.focus({ preventScroll: true });
      }

      function closeSharePanel(options) {
        const id = openShareId;
        openShareId = null;
        if (!id) return;
        if (shareDraft && shareDraft.id === id) shareDraft = null;
        const row = shareRow(id);
        if (!row) return;
        row.classList.remove('is-open');
        const toggle = row.querySelector('.access-toggle');
        if (toggle) {
          toggle.setAttribute('aria-expanded', 'false');
          if (options && options.focus) toggle.focus({ preventScroll: true });
        }
        const panel = sharePanelOf(row);
        if (!panel) return;
        panel.classList.add('is-closing');
        panel.classList.remove('is-open', 'is-settled');
        // Reduced motion has no transition to wait for; the timer covers both.
        setTimeout(() => panel.remove(), 260);
      }

      // The panel opens under its row, so no column ever changes width.
      function openSharePanel(id) {
        const svc = serviceById(id);
        const row = shareRow(id);
        if (!svc || !row) return;
        if (openShareId) closeSharePanel();
        openShareId = id;
        row.classList.add('is-open');
        const toggle = row.querySelector('.access-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
        const panel = document.createElement('div');
        panel.className = 'access-panel';
        panel.id = 'access-panel-' + id;
        panel.setAttribute('role', 'region');
        panel.innerHTML = '<div class="access-panel-inner"></div>';
        panel.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          closeSharePanel({ focus: true });
        });
        panel.addEventListener('focusin', (event) => {
          panel.dataset.focusKey = event.target.dataset.focusKey || '';
        });
        row.appendChild(panel);
        renderSharePanel(row, svc);
        void panel.offsetHeight;
        panel.classList.add('is-open');
        const first = panel.querySelector('[data-autofocus]');
        if (first) first.focus({ preventScroll: true });
        // Once open, stop clipping so focus rings show; then keep it in view.
        setTimeout(() => {
          if (!panel.isConnected || panel.classList.contains('is-closing')) return;
          panel.classList.add('is-settled');
          panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 260);
      }

      function toggleSharePanel(id) {
        if (openShareId === id) closeSharePanel({ focus: true });
        else openSharePanel(id);
      }

      function updateShareMeter(meter) {
        const end = Date.parse(meter.dataset.expiresAt);
        const span = end - Date.parse(meter.dataset.openedAt);
        const left = Number.isFinite(span) && span > 0 ? Math.min(1, Math.max(0, (end - Date.now()) / span)) : 0;
        meter.style.setProperty('--left', left.toFixed(4));
        meter.classList.toggle('is-low', left < 0.15);
      }

      function buildShareRow(svc) {
        const row = document.createElement('li');
        row.className = 'access-row';
        row.dataset.serviceId = svc.id;
        row.innerHTML =
          '<div class="access-line">' +
            '<div class="access-id"><span class="access-name"></span><span class="access-host"></span></div>' +
            '<div class="access-facts">' +
              '<span class="access-state"><span class="lamp off"></span><span data-share-state></span></span>' +
              '<span class="access-who"></span>' +
              '<span class="access-time"><span class="expiry" data-enabled="1"></span><span class="access-meter" aria-hidden="true"><i></i></span></span>' +
            '</div>' +
            '<div class="access-actions"></div>' +
          '</div>';
        // The whole line opens the panel; links and buttons keep their own job.
        row.firstElementChild.addEventListener('click', (event) => {
          if (event.target.closest('a, button')) return;
          if (String(window.getSelection ? window.getSelection() : '')) return;
          toggleSharePanel(row.dataset.serviceId);
        });
        return row;
      }

      function paintShareActions(row, svc) {
        const id = svc.id;
        const label = svc.name || svc.id;
        const actions = row.querySelector('.access-actions');
        const toggle = panelButton(svc.enabled ? 'Edit' : 'Share', 'access-toggle', () => toggleSharePanel(id));
        toggle.setAttribute('aria-label', (svc.enabled ? 'Edit ' : 'Share ') + label);
        toggle.setAttribute('aria-expanded', String(openShareId === id));
        toggle.setAttribute('aria-controls', 'access-panel-' + id);
        const buttons = [toggle];
        if (svc.enabled) {
          const stop = panelButton('Stop', 'danger', (button) => stopShare(id, button));
          stop.setAttribute('aria-label', 'Stop sharing ' + label);
          buttons.push(stop);
        }
        actions.replaceChildren(...buttons);
      }

      // Rows are keyed by service and repainted in place, so a refresh never
      // collapses an open panel, steals focus, or replays motion.
      function paintShareRow(row, svc) {
        const live = Boolean(svc.enabled);
        const key = [live, svc.name, svc.publicHost, svc.publicUrl, svc.authMode, svc.expiresAt, svc.openedAt].join('|');
        if (row.dataset.key === key) return;
        const state = live ? 'public' : 'private';
        const flipped = row.dataset.state !== state;
        const previousExpiry = row.dataset.state === 'public' ? row.dataset.expiresAt : '';
        row.dataset.key = key;
        row.dataset.state = state;
        row.dataset.expiresAt = svc.expiresAt || '';
        row.classList.toggle('is-live', live);
        row.querySelector('.access-name').textContent = svc.name || svc.id;
        const host = row.querySelector('.access-host');
        if (live) {
          host.innerHTML = '<a href="' + escapeHtml(svc.publicUrl || '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(svc.publicHost || '') + '</a>';
        } else {
          host.textContent = svc.publicHost || '';
        }
        row.querySelector('.access-state .lamp').className = 'lamp ' + (live ? 'status' : 'off');
        row.querySelector('[data-share-state]').textContent = state;
        row.querySelector('.access-who').textContent = live ? accessLabel(svc.authMode) : '';
        const time = row.querySelector('.access-time');
        const expiryNode = time.querySelector('.expiry');
        const meter = time.querySelector('.access-meter');
        // Hidden by visibility, not [hidden]: the cell keeps its grid column.
        time.classList.toggle('is-idle', !live);
        expiryNode.dataset.expiresAt = live ? String(svc.expiresAt || '') : '';
        expiryNode.dataset.enabled = live ? '1' : '0';
        updateExpiryNode(expiryNode);
        meter.hidden = !live || !svc.expiresAt;
        meter.dataset.expiresAt = String(svc.expiresAt || '');
        meter.dataset.openedAt = String(svc.openedAt || svc.updatedAt || '');
        if (!meter.hidden) updateShareMeter(meter);
        // More time on a live share flashes its countdown.
        if (live && Date.parse(svc.expiresAt || '') > Date.parse(previousExpiry || '')) {
          time.classList.remove('is-bumped');
          void time.offsetWidth;
          time.classList.add('is-bumped');
        }
        if (flipped || !row.querySelector('.access-actions').childElementCount) paintShareActions(row, svc);
        if (openShareId === svc.id) renderSharePanel(row, svc, { morph: flipped });
      }

      function renderRows(allServices) {
        const services = allServices.filter((svc) => !isAgent(svc));
        renderAgents(allServices);
        if (shareDraft && !services.some((svc) => svc.id === shareDraft.id && !svc.enabled)) shareDraft = null;
        if (openShareId && !services.some((svc) => svc.id === openShareId)) openShareId = null;
        const ids = new Set(services.map((svc) => svc.id));
        const existing = new Map();
        Array.from(rowsEl.children).forEach((node) => {
          if (node.dataset.serviceId && ids.has(node.dataset.serviceId)) existing.set(node.dataset.serviceId, node);
          else node.remove();
        });
        if (!services.length) {
          const empty = document.createElement('li');
          empty.className = 'access-empty';
          empty.textContent = 'No services.';
          rowsEl.appendChild(empty);
          document.getElementById('accessCount').textContent = '0 / 0';
          return;
        }
        // Keep the configured order so rows stay put when toggled.
        services.forEach((svc, index) => {
          const row = existing.get(svc.id) || buildShareRow(svc);
          paintShareRow(row, svc);
          if (rowsEl.children[index] !== row) rowsEl.insertBefore(row, rowsEl.children[index] || null);
        });
        const empty = document.createElement('li');
        empty.className = 'access-empty';
        empty.dataset.shareEmpty = '';
        empty.textContent = 'No match.';
        rowsEl.appendChild(empty);
        filterShares();
        tickExpiryCountdowns();
      }

      // Each agent host is one standing switch: on means reachable with its
      // Cloudflare Access service token and no expiry; off cuts it.
      function renderAgents(services) {
        if (!agentAccessEl) return;
        const agents = services.filter(isAgent);
        agentAccessEl.hidden = agents.length === 0;
        const ids = new Set(agents.map((agent) => agent.id));
        agentAccessEl.querySelectorAll('[data-agent-id]').forEach((node) => {
          if (!ids.has(node.dataset.agentId)) node.remove();
        });
        agents.forEach((agent) => {
          let node = agentAccessEl.querySelector('[data-agent-id="' + agent.id + '"]');
          if (!node) {
            node = document.createElement('div');
            node.className = 'route agent-route';
            node.dataset.agentId = agent.id;
            node.innerHTML =
              '<div class="route-main">' +
                '<div class="eyebrow">Agent access</div>' +
                '<div class="route-state"><span class="lamp" data-agent-lamp></span><span data-agent-name></span></div>' +
                '<div class="meta-line" data-agent-meta></div>' +
              '</div>' +
              '<div class="route-controls"><div class="vpn-toggle">' +
                '<span class="vpn-toggle-label" data-agent-label="off">Off</span>' +
                '<button class="toggle-switch" type="button" role="switch" aria-checked="false"><span class="toggle-knob" aria-hidden="true"></span></button>' +
                '<span class="vpn-toggle-label" data-agent-label="on">On</span>' +
              '</div></div>';
            const toggle = node.querySelector('.toggle-switch');
            toggle.onclick = () => setAgentAccess(agent.id, !toggle.classList.contains('on'));
            node.querySelectorAll('[data-agent-label]').forEach((label) => {
              label.onclick = () => {
                const on = label.dataset.agentLabel === 'on';
                if (on !== toggle.classList.contains('on')) setAgentAccess(agent.id, on);
              };
            });
            agentAccessEl.appendChild(node);
          }
          const verified = agent.authMode === 'cloudflare-access';
          node.querySelector('[data-agent-name]').textContent = agent.name || agent.id;
          node.querySelector('[data-agent-lamp]').className = 'lamp ' + (!agent.enabled ? 'off' : verified ? 'status' : 'warning');
          const meta = node.querySelector('[data-agent-meta]');
          meta.innerHTML = '<span>' + escapeHtml(agent.publicHost || '') + '</span><span>' + (verified ? 'service token' : 'auth none') + '</span>';
          if (agent.enabled) {
            const expiry = fmtExpiry(agent.expiresAt, true);
            const expiryNode = document.createElement('span');
            expiryNode.className = 'expiry ' + expiry.state;
            expiryNode.dataset.expiresAt = String(agent.expiresAt || '');
            expiryNode.dataset.enabled = '1';
            expiryNode.textContent = expiry.text;
            meta.appendChild(expiryNode);
          }
          setAgentSwitch(node, agent.enabled);
          node.querySelector('.toggle-switch').setAttribute('aria-label', 'Agent access for ' + (agent.name || agent.id));
        });
      }

      function setAgentSwitch(node, on) {
        const toggle = node.querySelector('.toggle-switch');
        toggle.classList.toggle('on', on);
        toggle.setAttribute('aria-checked', String(on));
        node.querySelectorAll('[data-agent-label]').forEach((label) => label.classList.toggle('active', (label.dataset.agentLabel === 'on') === on));
      }

      async function setAgentAccess(id, on) {
        const agent = (dashboardState.services || []).find((service) => service.id === id);
        const node = agentAccessEl.querySelector('[data-agent-id="' + id + '"]');
        if (!agent || !node || mutationInFlight > 0) return;
        if (!confirm(on ? 'Open ' + agent.publicHost + ' to its service token?' : 'Cut agent access on ' + agent.publicHost + '?')) return;
        const toggle = node.querySelector('.toggle-switch');
        setAgentSwitch(node, on);
        const result = await runExposure({
          btn: toggle,
          busy: { text: (on ? 'Opening' : 'Closing') + ' agent access…', detail: agent.publicHost },
          request: () => on ? exposureClient.enable(id, { hours: null, authMode: 'cloudflare-access' }) : exposureClient.disable(id),
          done: () => ({ text: 'Agent access ' + (on ? 'on' : 'off'), detail: (agent.name || agent.id) + ' · ' + agent.publicHost }),
          fail: 'Couldn\'t change agent access',
        });
        if (!result) setAgentSwitch(node, agent.enabled);
      }

      function renderAudit(entries) {
        if (!entries.length) {
          auditRowsEl.innerHTML = '<tr><td colspan="4" class="empty-state">Nothing yet.</td></tr>';
          return;
        }
        auditRowsEl.innerHTML = entries.map((entry) => {
          const parts = [];
          if (entry.hours) parts.push(entry.hours + 'h');
          if (entry.extendHours) parts.push('+' + entry.extendHours + 'h');
          if (entry.expiryMode === 'until-disabled') parts.push('no expiry');
          if (entry.authMode) parts.push(entry.authMode);
          if (entry.mode) parts.push('mode ' + entry.mode);
          if (entry.disabled != null) parts.push('disabled ' + entry.disabled);
          // The mark flags a change that opened the public surface.
          const actionClass = entry.action === 'enable'
            ? 'action-enable'
            : entry.action === 'emergency-disable-all'
              ? 'action-emergency'
              : 'action-routine';
          return (
            '<tr>' +
              '<td class="audit-time">' + fmtDateTime(entry.ts) + '</td>' +
              '<td class="audit-action ' + actionClass + '">' + escapeHtml(entry.action || '') + '</td>' +
              '<td>' + escapeHtml(entry.serviceId || '') + '</td>' +
              '<td class="audit-detail">' + escapeHtml(parts.join(' · ')) + '</td>' +
            '</tr>'
          );
        }).join('');
      }

      // Each region repaints only when its markup changes, so a quiet refresh
      // leaves focus and an open disclosure alone.
      function paintUpdates(element, key, markup) {
        if (!element || updatesUi.painted[key] === markup) return;
        updatesUi.painted[key] = markup;
        element.innerHTML = markup;
      }

      // The older of the two reports sets the visible age; both sit in the tooltip.
      function updatesFreshness() {
        const reports = [['images', dashboardState.updates], ['charts', dashboardState.helmUpdates]].filter(([, payload]) => payload && payload.checkedAt);
        if (!reports.length) return { text: '', title: '' };
        const oldest = reports.map(([, payload]) => payload.checkedAt).sort()[0];
        const busy = reports.some(([, payload]) => payload.refreshInProgress);
        const title = reports.map(([label, payload]) => label + ' ' + fmtDateTime(payload.checkedAt) +
          (payload.stale ? ' (stale)' : '') + ' · next ' + (payload.nextCheckAt ? fmtDateTime(payload.nextCheckAt) : '?')).join('\n');
        return { text: (busy ? 'checking · ' : '') + 'checked ' + fmtAgo(oldest), title };
      }

      function renderUpdatesPage() {
        const V = window.UpdatesView;
        if (!V || !updatesBodyEl) return;
        const now = Date.now();
        const renovate = dashboardState.renovate;
        const model = V.buildModel({
          images: dashboardState.updates,
          charts: dashboardState.helmUpdates,
          renovate,
          activity: dashboardState.activity,
          kind: updatesUi.kind,
          query: updatesUi.query,
          now,
        });
        const c = model.counts;
        paintUpdates(renovateStripEl, 'renovate', V.renovateMarkup(renovate, now));
        paintUpdates(updatesFiguresEl, 'figures', V.figuresMarkup(model));
        paintUpdates(updatesBodyEl, 'body', V.bodyMarkup(model, { now, open: updatesUi.open }));

        document.getElementById('updatesImageCount').textContent = c.images ? String(c.images) : '';
        document.getElementById('updatesChartCount').textContent = c.charts ? String(c.charts) : '';
        const freshness = updatesFreshness();
        updatesMetaEl.textContent = freshness.text;
        updatesMetaEl.title = freshness.title;
      }

      // Kept as the entry points the rest of the panel calls.
      function renderUpdates() { renderUpdatesPage(); }
      function renderHelmUpdates() { renderUpdatesPage(); }

      async function loadUpdates(options) {
        const force = Boolean(options && options.force);
        try {
          const payload = await request(force ? '/api/image-updates?force=1' : '/api/image-updates', 'GET');
          dashboardState.updates = payload;
          renderUpdatesPage();
          renderOverview();
          if (payload.stale) setUpdatesMsg('Images cached; refreshing.');
          else if (force) setUpdatesMsg('Images checked.');
        } catch (err) {
          setUpdatesMsg(err.message, true);
        }
      }

      async function loadHelmUpdates(options) {
        const force = Boolean(options && options.force);
        try {
          const payload = await request(force ? '/api/helm-updates?force=1' : '/api/helm-updates', 'GET');
          dashboardState.helmUpdates = payload;
          renderUpdatesPage();
          renderOverview();
          if (payload.stale) setHelmUpdatesMsg('Charts cached; refreshing.');
          else if (force) setHelmUpdatesMsg('Charts checked.');
        } catch (err) {
          setHelmUpdatesMsg(err.message, true);
        }
      }

      async function checkRegistries() {
        setBtnLoading(updatesRefreshBtn, true);
        setUpdatesMsg('Checking…');
        try {
          await Promise.all([loadUpdates({ force: true }), loadHelmUpdates({ force: true }), loadRenovateStatus({ force: true })]);
        } finally {
          setBtnLoading(updatesRefreshBtn, false);
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
          ? String(items.length) + (items.length === 1 ? ' secret' : ' secrets') + ' · ' + (data.branch || 'master')
          : (data.reason || 'Not configured.');
        if (!visible.length) {
          secretsListEl.innerHTML = '<div class="empty-state">No match.</div>';
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
                '<span class="secret-list-meta">' + escapeHtml(item.namespace) + ' · ' + String(item.keyCount || 0) + (Number(item.keyCount) === 1 ? ' key' : ' keys') + (item.existsLive ? '' : ' · not live') + '</span>' +
              '</button>'
            );
          }).join('');
          return (
            '<section class="secret-app-group">' +
              '<div class="secret-app-head">' +
                '<span class="secret-app-name">' + escapeHtml(group.appName) + '</span>' +
                '<span class="secret-app-meta">' + (count > 1 ? count + ' · ' : '') + totalKeys + (totalKeys === 1 ? ' key' : ' keys') + '</span>' +
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
          secretEditorTitleEl.textContent = 'No secret selected';
          secretEditorMetaEl.textContent = '';
          secretKeyRowsEl.innerHTML = '<div class="empty-state">Pick a secret.</div>';
          renderSecretsList(dashboardState.secrets);
          return;
        }
        const entries = Object.entries(secret.stringData || {}).sort((left, right) => left[0].localeCompare(right[0]));
        secretEditorTitleEl.textContent = secret.namespace + '/' + secret.name;
        secretEditorMetaEl.textContent = [secret.repoPath, secret.type || 'Opaque'].filter(Boolean).join(' · ');
        secretKeyRowsEl.innerHTML = entries.length
          ? entries.map(([key, value]) => secretKeyRowHtml(key, value)).join('')
          : '<div class="empty-state">No keys.</div>';
        renderSecretsList(dashboardState.secrets);
      }

      function secretActionIcon(name) {
        const paths = {
          reveal: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
          hide: '<path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 3.8M6.3 6.3A21 21 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5.7-1.7M10 10a3 3 0 0 0 4 4"/>',
          copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
          check: '<path d="m5 12 4 4L19 6"/>',
        };
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths[name] + '</svg>';
      }

      async function copySecretValue(button) {
        const input = button.closest('.secret-key-row').querySelector('.secret-key-value');
        button.disabled = true;
        try {
          await navigator.clipboard.writeText(input.value);
          button.innerHTML = secretActionIcon('check');
          button.classList.add('is-copied');
          button.title = 'Copied';
          button.setAttribute('aria-label', 'Copied');
          setSecretsMsg('Copied.');
          window.setTimeout(() => {
            button.innerHTML = secretActionIcon('copy');
            button.classList.remove('is-copied');
            button.title = 'Copy value';
            button.setAttribute('aria-label', 'Copy value');
            button.disabled = false;
          }, 1800);
        } catch {
          button.disabled = false;
          setSecretsMsg('Clipboard blocked. Allow clipboard access, or reveal and copy.', true);
        }
      }

      function secretKeyRowHtml(key, value) {
        return (
          '<div class="secret-key-row">' +
            '<input class="secret-key-name" type="text" value="' + escapeHtml(key) + '" placeholder="KEY_NAME" autocomplete="off" />' +
            '<div class="secret-value-control">' +
              '<input class="secret-key-value" type="password" value="' + escapeHtml(value) + '" placeholder="value" aria-label="Secret value" autocomplete="off" />' +
              '<div class="secret-value-actions">' +
                '<button class="secret-icon-btn secret-reveal-btn" type="button" title="Reveal value" aria-label="Reveal value">' + secretActionIcon('reveal') + '</button>' +
                '<button class="secret-icon-btn secret-copy-btn" type="button" title="Copy value" aria-label="Copy value">' + secretActionIcon('copy') + '</button>' +
              '</div>' +
            '</div>' +
            '<button class="secret-remove-key-btn danger" type="button" title="Remove key" aria-label="Remove key">×</button>' +
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
          setSecretsMsg('Refreshing…');
        }
        try {
          const payload = await request(force ? '/api/secrets?force=1' : '/api/secrets', 'GET');
          renderSecretsList(payload);
          if (force) setSecretsMsg('');
        } catch (err) {
          setSecretsMsg(err.message, true);
        } finally {
          if (force) setBtnLoading(secretsRefreshBtn, false);
        }
      }

      async function openSecret(namespace, name) {
        setSecretsMsg('Loading ' + namespace + '/' + name + '…');
        try {
          const secret = await request('/api/secrets/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(name), 'GET');
          renderSecretEditor(secret);
          setSecretsMsg('');
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
          setSecretsMsg('Committing…');
          await request('/api/secrets/' + encodeURIComponent(secret.namespace) + '/' + encodeURIComponent(secret.name), 'PUT', {
            type: secret.type || 'Opaque',
            stringData: readSecretEditorForm(),
          });
          await loadSecrets({ force: true });
          await openSecret(secret.namespace, secret.name);
          setSecretsMsg('Committed.');
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
          setSecretsMsg('Name required.', true);
          return;
        }
        if (!confirm('Create ' + namespace + '/' + name + ' in Git?')) return;
        try {
          mutationInFlight += 1;
          setBtnLoading(newSecretBtn, true);
          setSecretsMsg('Creating…');
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
          setSecretsMsg('Created.');
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
          setSecretsMsg('Deleting…');
          await request('/api/secrets/' + encodeURIComponent(secret.namespace) + '/' + encodeURIComponent(secret.name), 'DELETE');
          renderSecretEditor(null);
          await loadSecrets({ force: true });
          setSecretsMsg('Deleted.');
        } catch (err) {
          setSecretsMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          setBtnLoading(secretDeleteBtn, false);
        }
      }

      async function refreshServicesOnly() {
        const payload = await exposureClient.list();
        dashboardState.services = payload.services || [];
        renderRows(dashboardState.services);
        renderOverview();
        setLoadState(fmtTime(new Date()));
      }

      let pulseRequest = null;
      const pulseBatches = [
        { range: '24h', names: ['node_cpu', 'node_mem', 'cluster_watts', 'homelab_watts', 'restarts_1h', 'node_watts', 'node_req_cpu', 'node_req_mem', 'node_info', 'node_role', 'node_hardware', 'node_ready', 'node_pods', 'rpi_low_voltage'] },
        { range: '7d', names: ['homelab_watts', 'tariff'] },
        { range: '24h', names: ['pvc_class', 'pvc_util', 'pvc_used', 'pvc_capacity', 'pvc_requested'] },
        { range: '7d', names: ['pvc_util_7d'] },
        { range: '24h', names: ['pod_info', 'pod_mem_request', 'pod_mem_usage', 'pod_restarts_24h', 'pod_phase'] },
      ];
      const pulseMetric = (name, range = '24h') => dashboardState.metrics[name + '|' + range];

      function renderPulseStrip() {
        const P = window.Pulse;
        const definitions = [
          ['CPU', primarySeries('node_cpu'), P.fmt.pct, .7, true],
          ['Memory', primarySeries('node_mem'), P.fmt.pct, .8, true],
          ['Power', pulseMetric('cluster_watts')?.series?.[0], P.fmt.watts, Infinity, false],
          ['Restarts', pulseMetric('restarts_1h')?.series?.[0], (value) => P.number(value, 0), 0, false],
        ];
        document.getElementById('pulseStrip').innerHTML = definitions.map(([label, series, format, threshold, share]) => {
          const current = P.last(series);
          const history = P.values(series);
          const finite = history.filter(P.numeric);
          const subtitle = finite.length ? format(Math.min(...finite)) + ' – ' + format(Math.max(...finite)) + ' · 24 h' : 'no data';
          return overviewSegment(label, format(current), subtitle, { series: finite.length ? history : null, tone: current > threshold ? 'warning' : 'neutral', barPct: share && P.numeric(current) ? current * 100 : null });
        }).join('');
      }

      function pulseSectionHeader(title, detail) {
        return '<div class="block-head"><h2 class="block-title">' + escapeHtml(title) + '</h2><div class="page-meta">' + escapeHtml(detail) + '</div></div>';
      }

      // Drawing width inside a padded pulse block. An empty block is not laid
      // out yet, so its first render measures the column it will fill.
      function pulseInnerWidth(el) {
        const style = window.getComputedStyle(el);
        const outer = el.clientWidth || el.parentElement.clientWidth - 2;
        return Math.max(280, outer - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      }

      function renderNodeTwins() {
        const P = window.Pulse;
        const info = pulseMetric('node_info')?.series || [];
        const lookup = (name, node) => P.byLabel(pulseMetric(name), 'node').get(node);
        const models = info.map((series) => {
          const name = series.labels.node;
          const value = (metric) => P.last(lookup(metric, name));
          const machine = lookup('node_hardware', name)?.labels.machine;
          const arch = machine === 'aarch64' ? 'arm64' : machine === 'x86_64' ? 'amd64' : machine || 'unknown';
          const roles = (pulseMetric('node_role')?.series || []).filter((entry) => entry.labels.node === name).map((entry) => entry.labels.role);
          return { name, arch, roles, ready: value('node_ready'), cpu: value('node_cpu'), mem: value('node_mem'), watts: value('node_watts'), reqCpu: value('node_req_cpu'), reqMem: value('node_req_mem'), pods: value('node_pods'), kernel: series.labels.kernel_version, lowVoltage: value('rpi_low_voltage') === 1, wattsSeries: lookup('node_watts', name) };
        }).sort((a, b) => Number(b.roles.includes('control-plane')) - Number(a.roles.includes('control-plane')) || a.name.localeCompare(b.name));
        const ready = models.filter((model) => model.ready === 1).length;
        const pods = models.every((model) => P.numeric(model.pods)) ? models.reduce((sum, model) => sum + model.pods, 0) : null;
        document.getElementById('nodeTwins').innerHTML = pulseSectionHeader('Machines', models.length ? ready + '/' + models.length + ' ready · ' + P.number(pods, 0) + ' pods' : 'unavailable') +
          (models.length ? '<div class="node-twins-grid">' + models.map(P.twinCard).join('') + '</div><div class="pulse-reading-key"><span class="key-halftone"></span> usage <span class="key-request"></span> requested</div>' : '<p class="pulse-empty">No node data.</p>');
      }

      let powerPoints = [];
      function renderPowerTicker() {
        const P = window.Pulse;
        const series = pulseMetric('homelab_watts', '7d')?.series?.[0];
        const tariff = P.last(pulseMetric('tariff', '7d')?.series?.[0]);
        const power = P.power(series, tariff);
        const ticks = P.dayTicks(series);
        // Same order and length as the plotted values, for the hover readout.
        powerPoints = (series?.values || []).map(([at, watts]) => ({ at, watts }));
        const stats = [
          [P.fmt.watts(P.last(pulseMetric('homelab_watts')?.series?.[0])), 'now'],
          [P.numeric(power.kwh24h) ? P.number(power.kwh24h, 2) + ' kWh' : '—', '24 h'],
          [P.fmt.sgd(power.sgdPerDay), 'per day'],
          [P.fmt.sgd(power.sgd30d), '30 d projected'],
        ];
        const el = document.getElementById('powerTicker');
        const width = pulseInnerWidth(el);
        el.innerHTML = pulseSectionHeader('Power', '7 d · ' + (P.numeric(tariff) ? 'S$ ' + tariff.toFixed(4) + '/kWh' : 'no tariff')) +
          '<div class="power-ticker"><div class="ticker-stats">' + stats.map(([value, label]) => '<div class="ticker-stat"><div class="ticker-value">' + value + '</div><div class="ticker-label">' + label + '</div></div>').join('') + '</div>' +
          '<div class="ticker-wave" tabindex="0" role="group" aria-label="Estimated homelab power, seven days. Arrow keys read values.">' + P.sparkline(P.values(series), { fill: true, pattern: true, ticks, width, height: 84, label: 'Estimated homelab power over seven days' }) + '</div>' +
          '<div class="ticker-days">' + ticks.filter((tick) => tick.x > .015 && tick.x < .985).map((tick) => '<span style="left:' + tick.x * 100 + '%">' + escapeHtml(tick.label) + '</span>').join('') + '</div>' +
          '<div class="ticker-note"><span>Estimated · Kubernetes nodes + Iris + nas</span>' + (power.kwh24h === null ? '<span>awaiting history</span>' : '') + '</div></div>' + P.monthlyLedger(dashboardState.monthlyPower);
      }

      const expandedStorageGroups = new Set();
      function renderStorageTanks() {
        const P = window.Pulse;
        const metrics = Object.fromEntries(['pvc_class', 'pvc_util', 'pvc_used', 'pvc_capacity', 'pvc_requested'].map((name) => [name, pulseMetric(name)]));
        metrics.pvc_util_7d = pulseMetric('pvc_util_7d', '7d');
        const claims = P.joinPvcs(metrics);
        const measured = claims.filter((claim) => claim.measured).length;
        const warnings = claims.filter((claim) => P.numeric(claim.util) && claim.util >= .8).length;
        const projections = claims.filter((claim) => P.numeric(claim.daysToFull) && claim.daysToFull < 30).length;
        const grouped = new Map();
        for (const claim of claims) {
          const group = claim.storageClass.startsWith('truenas-') ? 'truenas' : claim.storageClass || 'unknown';
          if (!grouped.has(group)) grouped.set(group, []);
          grouped.get(group).push(claim);
        }
        const groups = [...grouped].sort(([a], [b]) => a === 'truenas' ? -1 : b === 'truenas' ? 1 : a.localeCompare(b));
        const el = document.getElementById('storageTanks');
        const focusedGroup = el.contains(document.activeElement) ? document.activeElement.dataset.storageGroup : null;
        el.innerHTML = pulseSectionHeader('Storage', claims.length ? claims.length + ' claims · ' + measured + ' measured · ' + warnings + ' above 80%' : 'unavailable') +
          groups.map(([key, items]) => {
            items.sort((a, b) => (b.util ?? -1) - (a.util ?? -1) || a.name.localeCompare(b.name));
            const expanded = expandedStorageGroups.has(key);
            const visible = expanded ? items : items.slice(0, 16);
            const title = key === 'truenas' ? 'TrueNAS' : key;
            const copy = key === 'truenas' ? 'network' : key === 'local-path' ? 'node-local' : '';
            return '<section class="tank-group"><div class="tank-group-heading"><div><h3>' + escapeHtml(title) + '<span>' + items.length + (copy ? ' · ' + copy : '') + '</span></h3></div>' +
              (items.length > 16 ? '<button type="button" class="tank-more" data-storage-group="' + escapeHtml(key) + '" aria-expanded="' + expanded + '">' + (expanded ? 'Fewer' : '+' + (items.length - 16)) + '</button>' : '') + '</div>' +
              '<div class="tank-grid">' + visible.map((claim) => {
                const tone = claim.util >= .9 ? 'danger' : claim.util >= .8 ? 'warning' : '';
                const size = claim.measured ? P.fmt.bytes(claim.used) + ' / ' + P.fmt.bytes(claim.capacity) : P.fmt.bytes(claim.requested) + ' requested';
                const projection = P.numeric(claim.daysToFull) && claim.daysToFull < 30 ? '<span class="tank-eta ' + (claim.daysToFull < 7 ? 'danger' : 'warning') + '">full in ' + Math.max(1, Math.ceil(claim.daysToFull)) + ' d</span>' : '';
                return '<figure class="tank ' + tone + (claim.measured ? '' : ' is-unmeasured') + '"><div class="tank-value">' + P.fmt.pct(claim.util) + '</div>' + P.tankSvg(claim) + '<figcaption><div class="tank-name" title="' + escapeHtml(claim.namespace + '/' + claim.name) + '">' + escapeHtml(claim.name) + '</div><div class="tank-size">' + size + '</div>' + (claim.measured ? projection : '<span class="tank-unavailable">unmeasured</span>') + '</figcaption></figure>';
              }).join('') + '</div></section>';
          }).join('') + (claims.length ? (projections ? '<div class="storage-note"><span>' + projections + ' full within 30 d</span></div>' : '') : '<p class="pulse-empty">No volume data.</p>');
        if (focusedGroup) [...el.querySelectorAll('[data-storage-group]')].find((button) => button.dataset.storageGroup === focusedGroup)?.focus({ preventScroll: true });
      }
      document.getElementById('storageTanks').addEventListener('click', (event) => {
        const button = event.target.closest('[data-storage-group]');
        if (!button) return;
        const key = button.dataset.storageGroup;
        if (expandedStorageGroups.has(key)) expandedStorageGroups.delete(key);
        else expandedStorageGroups.add(key);
        renderStorageTanks();
      });

      const collapsedNamespaces = new Set();
      let previousPodRestarts = new Map();
      let placementPods = [];
      let placementFlashTimer;
      function renderPlacementMap(recordRestarts = false) {
        const P = window.Pulse;
        placementPods = P.joinPods(Object.fromEntries(['pod_info', 'pod_mem_request', 'pod_mem_usage', 'pod_restarts_24h', 'pod_phase'].map((name) => [name, pulseMetric(name)])));
        const flashing = new Set();
        if (recordRestarts && pulseMetric('pod_restarts_24h')?.state === 'live') {
          const current = new Map();
          for (const pod of placementPods) {
            if (!P.numeric(pod.restarts)) continue;
            const count = Math.round(pod.restarts);
            current.set(pod.key, count);
            if (previousPodRestarts.has(pod.key) && count > previousPodRestarts.get(pod.key)) flashing.add(pod.key);
          }
          previousPodRestarts = current;
        }
        const groups = new Map();
        for (const pod of placementPods) {
          if (!groups.has(pod.node)) groups.set(pod.node, []);
          groups.get(pod.node).push(pod);
        }
        const primary = pulseMetric('node_role')?.series?.find((series) => series.labels.role === 'control-plane')?.labels.node;
        const nodes = [...groups].sort(([a], [b]) => a === primary ? -1 : b === primary ? 1 : a.localeCompare(b));
        const weight = (pods) => pods.reduce((sum, pod) => sum + Math.max(32 * 1024 ** 2, pod.request || 0), 0);
        const total = nodes.reduce((sum, [, pods]) => sum + weight(pods), 0);
        const el = document.getElementById('placementMap');
        const focused = el.contains(document.activeElement) ? { pod: document.activeElement.dataset.podKey, namespace: document.activeElement.dataset.namespace, node: document.activeElement.closest('[data-placement-node]')?.dataset.placementNode } : null;
        const width = pulseInnerWidth(el);
        const stacked = window.innerWidth <= 720;
        const chartHeight = stacked ? 300 : Math.max(260, Math.min(420, width * .36));
        const namespaceCount = new Set(placementPods.map((pod) => pod.namespace)).size;
        el.innerHTML = pulseSectionHeader('Placement', placementPods.length ? placementPods.length + ' pods · ' + namespaceCount + ' namespaces' : 'unavailable') +
          '<div class="placement-legend"><span>Area = memory request</span><span class="placement-density">Usage ' + [1, 2, 3, 4, 5].map((step) => '<i class="density-step density-' + step + '"></i>').join('') + '</span></div>' +
          '<div class="placement-nodes" style="grid-template-columns:' + (stacked ? '1fr' : nodes.map(([, pods]) => weight(pods) + 'fr').join(' ')) + '">' + nodes.map(([name, pods]) => {
            const nodeWidth = stacked ? width : (width - 24 * (nodes.length - 1)) * weight(pods) / total;
            const collapsed = new Set([...collapsedNamespaces].filter((key) => key.startsWith(name + '|')).map((key) => key.slice(name.length + 1)));
            const requested = pods.reduce((sum, pod) => sum + (pod.request || 0), 0);
            return '<section class="placement-node" data-placement-node="' + escapeHtml(name) + '"><div class="placement-node-heading"><h3>' + escapeHtml(name) + '</h3><span>' + pods.length + ' pods · ' + P.fmt.bytes(requested) + '</span></div>' + P.placementSvg(pods, nodeWidth, chartHeight, { collapsed, flashing }) + '</section>';
          }).join('') + '</div>' + (placementPods.length ? '' : '<p class="pulse-empty">No pod data.</p>') +
          '<div id="placementDetail" class="placement-detail" role="status">Hover a pod · click a namespace to fold</div><div class="placement-note"><span>Square: restarts · Red: over request · Checkered: not running</span></div>';
        if (focused) {
          const target = [...el.querySelectorAll('[data-pod-key], [data-namespace]')].find((element) => focused.pod ? element.dataset.podKey === focused.pod : element.dataset.namespace === focused.namespace && element.closest('[data-placement-node]')?.dataset.placementNode === focused.node);
          target?.focus({ preventScroll: true });
        }
        clearTimeout(placementFlashTimer);
        if (flashing.size) placementFlashTimer = setTimeout(() => el.querySelectorAll('.is-flashing').forEach((cell) => cell.classList.remove('is-flashing')), 650);
      }

      function showPlacementDetail(event) {
        const cell = event.target.closest('[data-pod-key]');
        if (!cell) return;
        const pod = placementPods.find((item) => item.key === cell.dataset.podKey);
        if (!pod) return;
        const P = window.Pulse;
        const detail = document.getElementById('placementDetail');
        detail.classList.add('is-active');
        detail.textContent = pod.namespace + '/' + pod.name + ' · req ' + P.fmt.bytes(pod.request) + ' · use ' + P.fmt.bytes(pod.usage) + ' · ' + P.fmt.pct(pod.ratio) + ' of request · ' + P.number(pod.restarts, 0) + ' restarts · ' + pod.phase;
      }
      const placementMapEl = document.getElementById('placementMap');
      placementMapEl.addEventListener('pointerover', showPlacementDetail);
      placementMapEl.addEventListener('focusin', showPlacementDetail);
      function togglePlacementNamespace(event) {
        const label = event.target.closest('[data-namespace]');
        if (!label) { if (event.type === 'click') showPlacementDetail(event); return; }
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        const node = label.closest('[data-placement-node]')?.dataset.placementNode;
        const key = node + '|' + label.dataset.namespace;
        if (collapsedNamespaces.has(key)) collapsedNamespaces.delete(key);
        else collapsedNamespaces.add(key);
        renderPlacementMap();
      }
      placementMapEl.addEventListener('click', togglePlacementNamespace);
      placementMapEl.addEventListener('keydown', togglePlacementNamespace);

      function renderPulse() {
        renderPulseStrip();
        renderNodeTwins();
        renderPowerTicker();
        renderStorageTanks();
        renderPlacementMap(true);
      }

      async function loadPulse() {
        if (pulseRequest) return pulseRequest;
        const status = document.getElementById('pulseStatus');
        pulseRequest = (async () => {
          await Promise.all([...pulseBatches.map(async ({ names, range }) => {
            try {
              const snapshot = await window.Pulse.fetch(names, range);
              for (const [name, metric] of Object.entries(snapshot.metrics)) dashboardState.metrics[name + '|' + range] = metric;
            } catch (error) {
              for (const name of names) dashboardState.metrics[name + '|' + range] = { state: 'degraded', series: [] };
            }
          }), (async () => {
            try {
              dashboardState.monthlyPower = await request('/api/power-cost-ledger', 'GET');
            } catch {
              dashboardState.monthlyPower = { state: 'unavailable', months: [] };
            }
          })()]);
          const degraded = Object.values(dashboardState.metrics).filter((metric) => metric.state !== 'live').length;
          status.dataset.state = degraded ? 'degraded' : 'live';
          status.textContent = (degraded ? degraded + ' unavailable' : 'Live') + ' · ' + new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' });
          renderPulse();
        })().finally(() => { pulseRequest = null; });
        return pulseRequest;
      }

      /* --------------------------------------------------------- activity */

      const FEED_PAGE = 40;
      const feedState = { payload: null, view: 'all', limit: FEED_PAGE, seen: null, loadedAt: 0, request: null, painted: {} };

      // Each region repaints only when its markup changes, so a quiet refresh
      // leaves focus, hover and finished animations alone.
      function paintFeed(element, key, markup) {
        if (feedState.painted[key] === markup) return;
        feedState.painted[key] = markup;
        element.innerHTML = markup;
      }

      function feedSkeleton() {
        return '<div class="feed-skeleton" aria-hidden="true">' + [72, 54, 63, 48].map((width) =>
          '<div class="feed-skeleton-row">' + skeletonLine('46px', '20px') + skeletonLine('30px', '30px') +
            '<div>' + skeletonLine('120px', '12px') + skeletonLine(width + '%', '16px') + '</div></div>'
        ).join('') + '</div>';
      }

      // `swap` marks a change of view: rows enter together. Otherwise only
      // events that were not in the previous snapshot announce themselves.
      function renderActivity(options) {
        const payload = feedState.payload;
        if (!payload) return;
        const F = window.Feed;
        const now = Date.now();
        const events = Array.isArray(payload.events) ? payload.events : [];
        const swap = Boolean(options && options.swap) || !feedState.seen;
        paintFeed(feedHeadlineEl, 'headline', F.headlineMarkup(payload.state));
        paintFeed(feedCountersEl, 'counters', F.countersMarkup(payload.summary));
        feedEyebrowEl.textContent = 'Last ' + (Number(payload.summary && payload.summary.hours) || 24) + ' h · ' + F.dayLabel(new Date(now));
        paintFeed(feedFiltersEl, 'filters', F.filtersMarkup(events, feedState.view));
        const visible = F.select(events, feedState.view);
        const fresh = swap ? new Set() : new Set(visible.filter((event) => !feedState.seen.has(event.id)).map((event) => event.id));
        feedListEl.classList.toggle('is-swapping', swap);
        paintFeed(feedListEl, 'list', F.listMarkup(visible, {
          limit: feedState.limit, fresh, now,
          empty: feedState.view === 'failed' ? 'Nothing failed.' : 'Nothing here.',
        }));
        feedState.seen = new Set(events.map((event) => event.id));
        const status = F.statusLine(payload, now);
        feedStatusEl.dataset.state = status.state;
        feedStatusEl.textContent = status.text;
      }

      async function loadActivity(options) {
        const force = Boolean(options && options.force);
        if (feedState.request) return feedState.request;
        // The server caches the feed for 30 seconds; sooner repeats add nothing.
        if (!force && feedState.payload && Date.now() - feedState.loadedAt < 20000) return undefined;
        if (!feedState.payload) paintFeed(feedListEl, 'list', feedSkeleton());
        if (force) setBtnLoading(feedRefreshBtn, true);
        feedState.request = (async () => {
          try {
            feedState.payload = await request(force ? '/api/activity?force=1' : '/api/activity', 'GET');
            feedState.loadedAt = Date.now();
            dashboardState.activity = feedState.payload;
            renderActivity();
            renderUpdatesPage();
          } catch (err) {
            feedStatusEl.dataset.state = 'degraded';
            feedStatusEl.textContent = 'unavailable';
            if (!feedState.payload) paintFeed(feedListEl, 'list', '<p class="empty-state">' + escapeHtml(err.message) + '</p>');
          } finally {
            feedState.request = null;
            if (force) setBtnLoading(feedRefreshBtn, false);
          }
        })();
        return feedState.request;
      }

      // Area tags toggle; the fixed views behave like a segmented control.
      function setFeedView(view) {
        const next = String(view || 'all');
        feedState.view = next.startsWith('area:') && feedState.view === next ? 'all' : next;
        feedState.limit = FEED_PAGE;
        renderActivity({ swap: true });
        feedFiltersEl.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
        // A shorter list must start under the filter bar: bring a bar that has
        // scrolled away back under the top bar, or the list up to a pinned one.
        const bar = feedFiltersEl.parentElement.getBoundingClientRect();
        const ceiling = document.querySelector('.topbar').getBoundingClientRect().bottom;
        const top = feedListEl.getBoundingClientRect().top;
        if (bar.top < ceiling - 1) window.scrollBy({ top: bar.top - ceiling, behavior: 'auto' });
        else if (top < bar.bottom) window.scrollBy({ top: top - bar.bottom, behavior: 'auto' });
      }

      async function loadDashboard(options) {
        // Telemetry has its own loading state; a slow metrics query must not
        // delay rendering the operator controls returned by the other APIs.
        if (activePage === 'pulse') void loadPulse();
        if (activePage === 'activity' || activePage === 'updates') void loadActivity();
        const silent = Boolean(options && options.silent);
        if (!silent) {
          setLoadState('…');
          setBtnLoading(refreshAllBtn, true);
          if (!rowsEl.querySelector('[data-service-id]')) rowsEl.innerHTML = skeletonShareRows(4);
          auditRowsEl.innerHTML = skeletonTableRows(4, 3);
        }

        try {
          const includeSecrets = activePage === 'secrets';
          const includeJobs = activePage === 'jobs';
          const includeSiteDeployments = activePage === 'deploy';
          const [svcData, auditData, vpnData, tuningData, updatesData, helmUpdatesData, renovateData, travelData, dnsData, jobsData, siteDeployData, secretsData] = await Promise.allSettled([
            exposureClient.list(),
            exposureClient.audit(),
            request('/api/transmission-vpn', 'GET'),
            request('/api/tuning', 'GET'),
            request('/api/image-updates', 'GET'),
            request('/api/helm-updates', 'GET'),
            request('/api/renovate', 'GET'),
            request('/api/travel', 'GET'),
            request('/api/dns-usage', 'GET'),
            includeJobs ? request('/api/jobs', 'GET') : Promise.resolve(null),
            includeSiteDeployments ? request('/api/site-deployments', 'GET') : Promise.resolve(null),
            includeSecrets ? request('/api/secrets', 'GET') : Promise.resolve(null),
          ]);

          // Keep tuning evidence independent of unrelated dashboard failures.
          if (tuningData.status === 'fulfilled') {
            dashboardState.tuning = tuningData.value;
            renderPlanner(dashboardState.tuning);
          } else {
            dashboardState.tuning = null;
            renderPlanner(null);
          }
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
          if (updatesData.status === 'fulfilled') {
            dashboardState.updates = updatesData.value;
            renderUpdates(dashboardState.updates);
            if (!silent) setUpdatesMsg('');
          } else {
            dashboardState.updates = { items: [], error: updatesData.reason.message };
            renderUpdates();
            setUpdatesMsg(updatesData.reason.message, true);
          }
          if (helmUpdatesData.status === 'fulfilled') {
            dashboardState.helmUpdates = helmUpdatesData.value;
            renderHelmUpdates(dashboardState.helmUpdates);
            if (!silent) setHelmUpdatesMsg('');
          } else {
            dashboardState.helmUpdates = { items: [], error: helmUpdatesData.reason.message };
            renderHelmUpdates();
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
          dashboardState.dns = dnsData.status === 'fulfilled' ? dnsData.value : null;
          if (includeJobs) {
            if (jobsData && jobsData.status === 'fulfilled') {
              renderJobs(jobsData.value);
              if (!silent) setJobsMsg('');
            } else {
              dashboardState.jobs = null;
              jobsSummaryEl.textContent = 'unavailable';
              jobsListEl.innerHTML = '<div class="empty-state">' + escapeHtml(jobsData ? jobsData.reason.message : 'Jobs unavailable.') + '</div>';
              if (jobsData && !silent) setJobsMsg(jobsData.reason.message, true);
            }
          } else if (!dashboardState.jobs) {
            jobsSummaryEl.textContent = '';
            jobsListEl.innerHTML = '';
          }
          if (includeSiteDeployments) {
            if (siteDeployData && siteDeployData.status === 'fulfilled') {
              renderSiteDeployments(siteDeployData.value);
              if (!silent) setSiteDeployMsg('');
            } else {
              dashboardState.siteDeployments = null;
              siteDeploySummaryEl.textContent = 'unavailable';
              siteDeployListEl.innerHTML = '<div class="empty-state">' + escapeHtml(siteDeployData ? siteDeployData.reason.message : 'Sites unavailable.') + '</div>';
              if (siteDeployData && !silent) setSiteDeployMsg(siteDeployData.reason.message, true);
            }
          } else if (!dashboardState.siteDeployments) {
            siteDeploySummaryEl.textContent = '';
            siteDeployListEl.innerHTML = '';
          }
          if (includeSecrets) {
            if (secretsData && secretsData.status === 'fulfilled') {
              renderSecretsList(secretsData.value);
              if (!silent) setSecretsMsg('');
            } else {
              renderSecretsList({ configured: false, items: [], namespaces: [], reason: secretsData ? secretsData.reason.message : 'Secrets unavailable.' });
              if (secretsData && !silent) setSecretsMsg(secretsData.reason.message, true);
            }
          } else if (!dashboardState.secrets) {
            secretsSummaryEl.textContent = '';
            secretsListEl.innerHTML = '';
          }

          renderOverview();
          hasLoadedDashboard = true;
          if (activePage === 'jobs' && !includeJobs && !dashboardState.jobs) void loadJobs();
          if (activePage === 'deploy' && !includeSiteDeployments && !dashboardState.siteDeployments) void loadSiteDeployments();
          if (activePage === 'secrets' && !includeSecrets && !dashboardState.secrets) void loadSecrets();
          setLoadState(fmtTime(new Date()));
          if (!silent) setMsg('');
        } catch (err) {
          setLoadState(err.message, true);
          if (!silent) setMsg(err.message, true);
        } finally {
          if (!silent) setBtnLoading(refreshAllBtn, false);
        }
      }

      refreshAllBtn.onclick = () => { loadDashboard(); loadVitals(true); };
      const exposureRefreshBtn = document.getElementById('exposureRefreshBtn');
      if (exposureRefreshBtn) exposureRefreshBtn.onclick = () => loadDashboard();
      updatesRefreshBtn.onclick = () => checkRegistries();
      updatesSearchInputEl.addEventListener('input', () => {
        updatesUi.query = updatesSearchInputEl.value || '';
        renderUpdatesPage();
      });
      updatesKindButtons.forEach((button) => {
        button.onclick = () => {
          updatesUi.kind = button.dataset.updatesKind || 'all';
          updatesKindButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
          renderUpdatesPage();
        };
      });
      renovateRunBtn.onclick = () => runRenovate();
      jobsRefreshBtn.onclick = () => loadJobs({ force: true });
      feedRefreshBtn.onclick = () => loadActivity({ force: true });
      feedFiltersEl.onclick = (event) => {
        const chip = event.target.closest('[data-feed-view]');
        if (chip) setFeedView(chip.dataset.feedView);
      };
      feedListEl.onclick = (event) => {
        const area = event.target.closest('[data-feed-view]');
        if (area) {
          setFeedView(area.dataset.feedView);
        } else if (event.target.closest('[data-feed-more]')) {
          feedState.limit += FEED_PAGE;
          renderActivity();
        }
      };
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
        button.addEventListener('click', () => {
          const next = button.dataset.themeMode;
          const apply = () => applyThemeMode(next);
          // Reveal only when the page will actually change colour.
          if (resolvedThemeMode(next) === resolvedThemeMode(storedThemeMode())) apply();
          else window.Fx.reveal(button, apply);
        });
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
        const copy = event.target.closest('.secret-copy-btn');
        if (copy && !copy.disabled) copySecretValue(copy);
        if (reveal) {
          const input = reveal.closest('.secret-key-row').querySelector('.secret-key-value');
          const visible = input.type === 'text';
          input.type = visible ? 'password' : 'text';
          reveal.innerHTML = secretActionIcon(visible ? 'reveal' : 'hide');
          reveal.title = visible ? 'Reveal value' : 'Hide value';
          reveal.setAttribute('aria-label', reveal.title);
        }
        if (remove) {
          const row = remove.closest('.secret-key-row');
          if (!row || row.classList.contains('is-removing')) return;
          row.classList.add('is-removing');

          const finishRemoval = () => {
            if (!row.isConnected) return;
            row.remove();
            if (!secretKeyRowsEl.querySelector('.secret-key-row')) {
              secretKeyRowsEl.innerHTML = '<div class="empty-state">No keys.</div>';
            }
          };
          row.addEventListener('transitionend', finishRemoval, { once: true });
          window.setTimeout(finishRemoval, 220);
        }
      });
      // A disclosure remembers being open across repaints; toggle does not
      // bubble, so it is caught on the way down.
      updatesBodyEl.addEventListener('toggle', (event) => {
        const key = event.target && event.target.dataset ? event.target.dataset.updatesDisclosure : '';
        if (key) updatesUi.open[key] = event.target.open;
      }, true);
      // Each figure jumps to the list it counts, opening it when folded.
      updatesFiguresEl.onclick = (event) => {
        const tile = event.target.closest('[data-updates-jump]');
        if (!tile) return;
        const target = document.getElementById(tile.dataset.updatesJump);
        if (!target) return;
        const folded = target.closest('details');
        if (folded && !folded.open) folded.open = true;
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
        target.focus({ preventScroll: true });
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
        if (!confirm('Stop every share and agent access?')) return;
        const open = (dashboardState.services || []).filter((svc) => svc.enabled);
        await runExposure({
          btn: emergencyBtn,
          busy: { text: 'Closing everything…', detail: open.length ? namesOf(open) : '' },
          request: () => exposureClient.disableAll(),
          done: () => ({ text: 'Everything is private', detail: open.length ? namesOf(open) + ' closed' : 'nothing was public' }),
          fail: 'Couldn\'t close everything',
        });
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
        // Travel closes temporary shares only; agent access is not travel posture.
        travelDisableSharesBtn.onclick = async () => {
          if (!confirm('Disable all temporary shares?')) return;
          const services = dashboardState.services || [];
          const open = services.filter((svc) => svc.enabled && !isAgent(svc));
          const agentOn = services.some((svc) => svc.enabled && isAgent(svc));
          await runExposure({
            btn: travelDisableSharesBtn,
            busy: { text: 'Closing ' + open.length + (open.length === 1 ? ' share…' : ' shares…'), detail: namesOf(open) },
            request: async () => ({ services: (await Promise.all(open.map((svc) => exposureClient.disable(svc.id)))).map((reply) => reply && reply.service) }),
            done: () => ({ text: 'Shares closed', detail: namesOf(open) + (agentOn ? ' · agent access kept' : '') }),
            fail: 'Couldn\'t close shares',
          });
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
          setActivePage(target, { focus: true });
          if (target === 'overview') loadVitals();
        });
      });

      window.addEventListener('hashchange', () => {
        setActivePage(window.location.hash, { replace: true, focus: true });
        if (activePage === 'overview') loadVitals();
      });

      let pulseResizeTimer;
      window.addEventListener('resize', () => {
        clearTimeout(pulseResizeTimer);
        pulseResizeTimer = setTimeout(() => { if (activePage === 'pulse') { renderPowerTicker(); renderPlacementMap(); } }, 200);
      });
      // Telemetry refreshes only for the page that is on screen.
      function refreshVisibleTelemetry() {
        if (document.visibilityState !== 'visible') return;
        if (activePage === 'pulse') loadPulse({ silent: true });
        if (activePage === 'overview') loadVitals();
        if (activePage === 'activity') loadActivity();
        // Renovate runs and Flux rollouts move on their own; keep the page honest.
        if (activePage === 'updates') { loadActivity(); loadRenovateStatus(); renderUpdatesPage(); }
      }
      setInterval(refreshVisibleTelemetry, 60000);
      document.documentElement.classList.toggle('is-backgrounded', document.hidden);
      document.addEventListener('visibilitychange', () => {
        document.documentElement.classList.toggle('is-backgrounded', document.hidden);
        refreshVisibleTelemetry();
      });
      setInterval(tickExpiryCountdowns, 1000);

      /* ------------------------------------------------- presentation */

      const fx = window.Fx;
      heroField = fx.field(document.getElementById('heroField'));
      fx.spotlight('.tile');
      fx.glide(document.getElementById('navRail'), document.querySelector('.nav-indicator'), '[aria-current="page"]', 'y');
      document.querySelectorAll('.tabs, .view-switch').forEach((group) => {
        const thumb = group.querySelector('.glide-thumb');
        if (thumb) fx.glide(group, thumb, '[aria-selected="true"], [aria-pressed="true"]', 'x');
      });
      const crosshairTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      fx.crosshair(document.getElementById('powerTicker'), {
        plot: '.ticker-wave',
        getPoints: () => powerPoints,
        format: (point) => crosshairTime.format(new Date(point.at * 1000)) + ' · ' + window.Pulse.fmt.watts(point.watts),
      });

      // Figures roll to a new value and stay still when it has not changed.
      const rolledFigures = new Map();
      function rollFigures() {
        document.querySelectorAll('[data-roll]:not([data-rolled])').forEach((node) => {
          const key = (node.closest('[id]')?.id || '') + '|' + (node.parentElement.querySelector('.tile-label, .eyebrow')?.textContent || '');
          node.dataset.rolled = '1';
          fx.roll(node, node.dataset.roll, rolledFigures.get(key));
          rolledFigures.set(key, node.dataset.roll);
        });
      }
      new MutationObserver(rollFigures).observe(document.getElementById('mainContent'), { childList: true, subtree: true });

      // The clock lands on each whole second. Seconds carry into minutes like an
      // odometer, and the hairline sweeps the minute on the compositor.
      const clockEl = document.getElementById('clock');
      clockEl.innerHTML = '<span class="sr-only"></span><span class="clock-face" aria-hidden="true"><span class="clock-hm"></span><span class="clock-colon">:</span><span class="clock-s"></span><span class="clock-sweep"></span></span><span class="clock-zone" aria-hidden="true">SGT</span>';
      const [clockLabel, clockFace] = clockEl.children;
      const [clockHm, , clockS, clockSweep] = clockFace.children;
      const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      let clockTimer = 0;
      function tickClock(animate) {
        const now = new Date();
        const part = Object.fromEntries(clockFormat.formatToParts(now).map((entry) => [entry.type, entry.value]));
        const hm = part.hour + ':' + part.minute;
        const moving = animate && !document.hidden && clockEl.getClientRects().length > 0;
        const carried = fx.tick(clockS, part.second, { animate: moving });
        fx.tick(clockHm, hm, { animate: moving, after: carried });
        if (clockLabel.textContent !== hm + ' Singapore time') {
          clockLabel.textContent = hm + ' Singapore time';
          clockEl.dateTime = hm;
        }
        // Pin the sweep to the wall clock on load, on return and once a minute.
        const sweep = (!moving || part.second === '00') && clockSweep.getAnimations?.()[0];
        if (sweep) sweep.currentTime = Number(part.second) * 1000 + now.getMilliseconds();
      }
      function scheduleClock() {
        clearTimeout(clockTimer);
        clockTimer = setTimeout(() => { tickClock(true); scheduleClock(); }, 1000 - (Date.now() % 1000) + 8);
      }
      tickClock(false);
      scheduleClock();
      // Hidden tabs throttle timers; a returning tab snaps to the time without replaying motion.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        tickClock(false);
        scheduleClock();
      });

      // Everything reachable by pointer is reachable from the palette.
      const commandPalette = fx.palette({
        getCommands() {
          const commands = pageLinks.map((link) => ({
            group: 'Go to',
            label: link.dataset.pageTitle,
            run: () => setActivePage(link.getAttribute('href'), { focus: true }),
          }));
          commands.push({ group: 'Run', label: 'Refresh', hint: 'all data', run: () => refreshAllBtn.click() });
          if (!renovateRunBtn.disabled) commands.push({ group: 'Run', label: 'Run Renovate', run: () => runRenovate() });
          commands.push(
            { group: 'Run', label: 'Check for updates', hint: 'registries + charts', run: () => { setActivePage('updates'); checkRegistries(); } },
            { group: 'Run', label: 'Deploy all sites', hint: 'flux reconcile', run: () => { setActivePage('deploy'); runAllSiteDeployments(siteDeployAllBtn); } },
          );
          if (transmissionVpnState) {
            const next = transmissionVpnState.desiredMode === 'vpn' ? 'direct' : 'vpn';
            commands.push({ group: 'Run', label: 'Route Transmission ' + next, hint: 'asks first', run: () => setTransmissionVpnMode(next) });
          }
          commands.push({ group: 'Run', label: 'Stop all public access', hint: 'asks first', danger: true, run: () => emergencyBtn.click() });
          commands.push({ group: 'View', label: 'Toggle sidebar', hint: '[', keywords: 'fold collapse navigation', run: toggleNavigation });
          for (const mode of ['system', 'light', 'dark']) {
            commands.push({ group: 'Theme', label: mode[0].toUpperCase() + mode.slice(1), keywords: 'theme appearance', run: () => themeModeButtons.find((button) => button.dataset.themeMode === mode)?.click() });
          }
          for (const service of dashboardState.services || []) {
            if (isAgent(service)) {
              commands.push({
                group: 'Public access',
                label: service.name || service.id,
                hint: 'agent ' + (service.enabled ? 'on' : 'off'),
                keywords: [service.id, service.publicHost, 'agent token'].join(' '),
                run: () => {
                  setActivePage('exposure');
                  const node = agentAccessEl.querySelector('[data-agent-id="' + service.id + '"]');
                  if (!node) return;
                  node.scrollIntoView({ block: 'center' });
                  node.querySelector('.toggle-switch').focus({ preventScroll: true });
                },
              });
              continue;
            }
            commands.push({
              group: 'Public access',
              label: service.name || service.id,
              hint: service.enabled ? 'public · ' + fmtExpiry(service.expiresAt, true).text : 'private',
              keywords: [service.id, service.publicHost].join(' '),
              run: () => {
                setActivePage('exposure');
                sharesSearch.value = '';
                shareView = 'all';
                filterShares();
                if (openShareId !== service.id) openSharePanel(service.id);
                const row = shareRow(service.id);
                if (row) row.scrollIntoView({ block: 'center' });
              },
            });
          }
          return commands;
        },
      });
      const paletteBtn = document.getElementById('paletteBtn');
      if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) paletteBtn.querySelector('kbd').textContent = 'Ctrl K';
      paletteBtn.onclick = () => commandPalette.open();
      document.addEventListener('keydown', (event) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
        const plain = !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          commandPalette.toggle();
        } else if (event.key === '/' && plain) {
          event.preventDefault();
          commandPalette.open();
        } else if (event.key === '[' && plain) {
          event.preventDefault();
          toggleNavigation();
        }
      });

      renderPulseStrip();
      renderVitals();
      applyThemeMode(storedThemeMode());
      setActivePage(window.location.hash || '#overview', { replace: true });
      loadDashboard();
      loadVitals();
