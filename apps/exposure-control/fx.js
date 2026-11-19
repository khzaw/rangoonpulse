/* Presentation layer for the control panel: motion, palette and toasts. Owns no data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.Fx = factory(root);
})(typeof window === 'object' ? window : globalThis, function (window) {
  'use strict';

  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const reducedMotion = () => Boolean(window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  /* ------------------------------------------------------------ ranking */

  // Subsequence match that rewards word starts and runs, so "dall" finds
  // "Disable all" before "Deploy all sites".
  function score(query, text) {
    const needle = String(query || '').toLowerCase().replace(/\s+/g, '');
    const hay = String(text || '').toLowerCase();
    if (!needle) return 1;
    let total = 0;
    let at = -1;
    let run = 0;
    for (const char of needle) {
      const next = hay.indexOf(char, at + 1);
      if (next < 0) return 0;
      run = next === at + 1 ? run + 1 : 0;
      const wordStart = next === 0 || /[\s/·:_-]/.test(hay[next - 1]);
      total += 1 + run * 2 + (wordStart ? 4 : 0) - Math.min(3, (next - at - 1) * 0.1);
      at = next;
    }
    return total + (hay.startsWith(needle) ? 8 : 0);
  }

  function rank(query, items) {
    const list = Array.isArray(items) ? items : [];
    if (!String(query || '').trim()) return list.slice();
    return list
      .map((item, index) => ({ item, index, value: Math.max(score(query, item.label) * 2, score(query, [item.group, item.hint, item.keywords].filter(Boolean).join(' '))) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .map((entry) => entry.item);
  }

  /* --------------------------------------------------------- digit roll */

  // Each digit is a ten-row strip moved by --d; `from` supplies the digits a
  // previous value showed, aligned from the right, so only changes travel.
  function rollMarkup(text, from) {
    const next = String(text ?? '');
    const previous = String(from ?? '');
    return Array.from(next).map((char, index) => {
      if (!/\d/.test(char)) return '<span class="roll-char">' + escape(char) + '</span>';
      const old = previous[previous.length - (next.length - index)];
      return '<span class="roll-digit" data-d="' + char + '" style="--d:' + (/\d/.test(old || '') ? old : 0) + '"><span class="roll-strip" aria-hidden="true">0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</span></span>';
    }).join('');
  }

  // The readable value stays in the DOM once; the moving strips are decoration.
  function roll(element, text, previous) {
    const next = String(text ?? '');
    if (!element) return;
    if (!/\d/.test(next)) { element.textContent = next; return; }
    const still = previous === next || reducedMotion() || !window?.requestAnimationFrame;
    element.innerHTML = '<span class="sr-only">' + escape(next) + '</span><span aria-hidden="true">' + rollMarkup(next, still ? next : previous) + '</span>';
    if (still) return;
    const settle = () => element.querySelectorAll('.roll-digit').forEach((digit) => digit.style.setProperty('--d', digit.dataset.d));
    // Two frames: the first paints the starting digits, the second moves them.
    window.requestAnimationFrame(() => window.requestAnimationFrame(settle));
  }

  /* -------------------------------------------------------- signal field */

  // One heartbeat over u in [0, 1): P wave, QRS spike, T wave.
  function ecg(u) {
    const bump = (center, width) => Math.exp(-(((u - center) / width) ** 2));
    return 0.13 * bump(0.2, 0.045) - 0.16 * bump(0.335, 0.014) + bump(0.37, 0.016) - 0.26 * bump(0.405, 0.016) + 0.27 * bump(0.6, 0.06);
  }

  // Brightness (0–1) of one cell: a monitor trace that is strongest at the
  // sweep head and decays behind it, plus a soft swell under the pointer.
  function fieldLevel(x, y, o) {
    const loop = o.width + o.gap;
    const age = (((o.head - x) % loop) + loop) % loop;
    let level = 0;
    if (age < o.tail) {
      // Distance to the stroke between this column and the previous one, so a
      // steep spike stays a continuous line instead of two stray cells.
      const at = (px) => o.mid - o.amp * (o.flat ? 0 : ecg((((px / o.period) % 1) + 1) % 1));
      const a = at(x - o.step);
      const b = at(x);
      const distance = (y < Math.min(a, b) ? Math.min(a, b) - y : y > Math.max(a, b) ? y - Math.max(a, b) : 0) / o.sigma;
      level = (1 - age / o.tail) ** 1.6 * Math.exp(-distance * distance);
    }
    if (o.px != null) {
      const dx = x - o.px;
      const dy = y - o.py;
      level += 0.5 * Math.exp(-(dx * dx + dy * dy) / 9800);
    }
    return Math.min(1, level);
  }

  function field(canvas) {
    if (!canvas?.getContext || !window) return { setVitals() {}, destroy() {} };
    const context = canvas.getContext('2d');
    const step = 8;
    const PERIOD = 340;
    const state = { bpm: 58, flat: true, px: null, py: null, head: 0, width: 0, height: 0, visible: true, last: 0, frame: 0 };
    let bed = null;
    let ink = '#888';

    function resize() {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const bounds = canvas.getBoundingClientRect();
      state.width = Math.max(1, Math.round(bounds.width));
      state.height = Math.max(1, Math.round(bounds.height));
      canvas.width = state.width * ratio;
      canvas.height = state.height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      ink = window.getComputedStyle(canvas).color || ink;
      // The resting dots never change, so they are drawn once and blitted.
      bed = window.document.createElement('canvas');
      bed.width = canvas.width;
      bed.height = canvas.height;
      const bedContext = bed.getContext('2d');
      bedContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      bedContext.fillStyle = ink;
      bedContext.globalAlpha = 0.17;
      for (let y = step / 2; y < state.height; y += step) for (let x = step / 2; x < state.width; x += step) bedContext.fillRect(x - 0.5, y - 0.5, 1, 1);
      draw();
    }

    function draw() {
      const { width, height } = state;
      context.clearRect(0, 0, width, height);
      if (bed) context.drawImage(bed, 0, 0, width, height);
      // On a narrow stage the headline owns the lower half, so the trace rides above it.
      const compact = width < 560;
      const options = { width, step, gap: 120, head: state.head, tail: width * 0.72, period: compact ? PERIOD * 0.6 : PERIOD, amp: height * (compact ? 0.2 : 0.44), mid: height * (compact ? 0.27 : 0.66), sigma: 5, flat: state.flat, px: state.px, py: state.py };
      context.fillStyle = ink;
      for (let y = step / 2; y < height; y += step) {
        for (let x = step / 2; x < width; x += step) {
          const level = fieldLevel(x, y, options);
          if (level < 0.03) continue;
          const size = 1 + level * 4.4;
          context.globalAlpha = 0.17 + level * 0.83;
          context.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
      context.globalAlpha = 1;
    }

    function tick(now) {
      state.frame = 0;
      if (!state.visible || window.document.hidden) return;
      const elapsed = Math.min(80, now - (state.last || now));
      // ~30 fps is plenty for a slow sweep and halves the paint cost.
      if (elapsed >= 30 || !state.last) {
        state.last = now;
        state.head = (state.head + (PERIOD * state.bpm / 60) * (elapsed / 1000)) % (state.width + 120);
        draw();
      }
      state.frame = window.requestAnimationFrame(tick);
    }

    function start() {
      if (state.frame) return;
      if (reducedMotion()) { state.head = state.width * 0.82; draw(); return; }
      state.last = 0;
      state.frame = window.requestAnimationFrame(tick);
    }

    const sizeObserver = window.ResizeObserver ? new window.ResizeObserver(resize) : null;
    sizeObserver?.observe(canvas);
    const viewObserver = window.IntersectionObserver ? new window.IntersectionObserver(([entry]) => { state.visible = entry.isIntersecting; if (state.visible) start(); }) : null;
    viewObserver?.observe(canvas);
    const onVisibility = () => { if (!window.document.hidden) start(); };
    const onMove = (event) => {
      const bounds = canvas.getBoundingClientRect();
      const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      state.px = inside ? event.clientX - bounds.left : null;
      state.py = inside ? event.clientY - bounds.top : null;
      if (reducedMotion()) draw();
    };
    const themeObserver = new window.MutationObserver(resize);
    themeObserver.observe(window.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', resize);
    window.document.addEventListener('visibilitychange', onVisibility);
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) window.addEventListener('pointermove', onMove, { passive: true });
    resize();
    start();

    return {
      // Heart rate follows load; a missing reading is a flat line, not a guess.
      setVitals({ load, live }) {
        state.flat = !live;
        state.bpm = live && Number.isFinite(load) ? 46 + Math.max(0, Math.min(1, load)) * 94 : 40;
        if (reducedMotion()) draw();
      },
      destroy() {
        window.cancelAnimationFrame(state.frame);
        sizeObserver?.disconnect();
        viewObserver?.disconnect();
        themeObserver.disconnect();
        scheme.removeEventListener('change', resize);
        window.document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pointermove', onMove);
      },
    };
  }

  /* ----------------------------------------------------------- spotlight */

  // One delegated listener; panels read --mx/--my to light the dots beneath
  // the pointer. Fine pointers only: touch has no hover to follow.
  function spotlight(selector) {
    if (!window?.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let pending = null;
    let queued = false;
    window.document.addEventListener('pointermove', (event) => {
      pending = event;
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        const target = pending.target?.closest?.(selector);
        if (!target) return;
        const bounds = target.getBoundingClientRect();
        target.style.setProperty('--mx', (pending.clientX - bounds.left).toFixed(1) + 'px');
        target.style.setProperty('--my', (pending.clientY - bounds.top).toFixed(1) + 'px');
      });
    }, { passive: true });
  }

  /* --------------------------------------------------------------- glide */

  // Slides one indicator to whichever child currently matches `active`.
  function glide(container, indicator, active, axis) {
    if (!container || !indicator) return () => {};
    let placed = false;
    function sync() {
      const target = container.querySelector(active);
      if (!target || !target.offsetParent) { indicator.style.opacity = '0'; placed = false; return; }
      const from = container.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      if (!placed) indicator.style.transition = 'none';
      indicator.style.opacity = '1';
      // Offsets are measured from the padding box the indicator is placed in.
      if (axis === 'x') {
        indicator.style.width = to.width + 'px';
        indicator.style.transform = 'translateX(' + (to.left - from.left - container.clientLeft + container.scrollLeft) + 'px)';
      } else {
        indicator.style.height = to.height + 'px';
        indicator.style.transform = 'translateY(' + (to.top - from.top - container.clientTop + container.scrollTop) + 'px)';
      }
      if (!placed) { void indicator.offsetWidth; indicator.style.transition = ''; placed = true; }
    }
    new window.MutationObserver(sync).observe(container, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected', 'aria-pressed', 'open'] });
    if (window.ResizeObserver) new window.ResizeObserver(sync).observe(container);
    window.document.fonts?.ready.then(sync);
    sync();
    return sync;
  }

  /* -------------------------------------------------------------- toasts */

  const toasts = new Map();
  function toastHost() {
    let host = window.document.getElementById('toasts');
    if (!host) {
      host = window.document.createElement('div');
      host.id = 'toasts';
      host.className = 'toasts';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      window.document.body.appendChild(host);
    }
    return host;
  }

  function dismiss(scope) {
    const entry = toasts.get(scope);
    if (!entry) return;
    toasts.delete(scope);
    window.clearTimeout(entry.timer);
    entry.node.classList.add('is-leaving');
    window.setTimeout(() => entry.node.remove(), 200);
  }

  // One toast per scope: "Saving…" becomes "Saved." in place instead of stacking.
  function toast(scope, text, options = {}) {
    if (!window) return;
    if (!text) { dismiss(scope); return; }
    const busy = options.busy ?? /(…|\.\.\.)$/.test(text);
    let entry = toasts.get(scope);
    if (!entry) {
      // Several areas failing for one reason should read as one message.
      for (const other of toasts.values()) if (other.text === text) return;
      const node = window.document.createElement('button');
      node.type = 'button';
      node.className = 'toast';
      node.innerHTML = '<span class="toast-mark" aria-hidden="true"></span><span class="toast-text"></span>';
      node.addEventListener('click', () => dismiss(scope));
      toastHost().appendChild(node);
      entry = { node };
      toasts.set(scope, entry);
    }
    window.clearTimeout(entry.timer);
    entry.text = text;
    entry.node.querySelector('.toast-text').textContent = text;
    entry.node.dataset.tone = options.error ? 'danger' : busy ? 'busy' : 'done';
    entry.node.setAttribute('aria-label', text + ' — dismiss');
    entry.timer = window.setTimeout(() => dismiss(scope), options.error ? 9000 : busy ? 90000 : 3200);
  }

  /* ------------------------------------------------------------- palette */

  function palette({ getCommands, placeholder }) {
    const document = window.document;
    const dialog = document.createElement('dialog');
    dialog.className = 'palette';
    dialog.setAttribute('aria-label', 'Command palette');
    dialog.innerHTML =
      '<div class="palette-box">' +
        '<div class="palette-field"><span class="palette-prompt" aria-hidden="true">›</span>' +
        '<input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="paletteList" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="' + escape(placeholder || 'Go to or run…') + '" />' +
        '<kbd>esc</kbd></div>' +
        '<div id="paletteList" class="palette-list" role="listbox" aria-label="Commands"></div>' +
      '</div>';
    document.body.appendChild(dialog);
    const input = dialog.querySelector('.palette-input');
    const list = dialog.querySelector('.palette-list');
    let commands = [];
    let visible = [];
    let active = 0;

    function paint() {
      visible = rank(input.value, commands).slice(0, 40);
      active = Math.max(0, Math.min(active, visible.length - 1));
      let group = null;
      list.innerHTML = visible.length ? visible.map((command, index) => {
        const heading = !input.value.trim() && command.group !== group ? '<div class="palette-group" role="presentation">' + escape(command.group) + '</div>' : '';
        group = command.group;
        return heading + '<div class="palette-item' + (command.danger ? ' is-danger' : '') + '" role="option" id="palette-option-' + index + '" data-index="' + index + '" aria-selected="' + (index === active) + '">' +
          '<span class="palette-label">' + escape(command.label) + '</span>' +
          (command.hint ? '<span class="palette-hint">' + escape(command.hint) + '</span>' : '') + '</div>';
      }).join('') : '<div class="palette-empty">No match</div>';
      input.setAttribute('aria-activedescendant', visible.length ? 'palette-option-' + active : '');
    }

    function move(delta) {
      if (!visible.length) return;
      active = (active + delta + visible.length) % visible.length;
      list.querySelectorAll('[role="option"]').forEach((option, index) => option.setAttribute('aria-selected', String(index === active)));
      input.setAttribute('aria-activedescendant', 'palette-option-' + active);
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }

    function run(index) {
      const command = visible[index];
      if (!command) return;
      dialog.close();
      command.run();
    }

    function open() {
      if (dialog.open) return;
      commands = getCommands();
      input.value = '';
      active = 0;
      paint();
      dialog.showModal();
      input.focus();
    }

    input.addEventListener('input', () => { active = 0; paint(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); run(active); }
    });
    list.addEventListener('click', (event) => {
      const option = event.target.closest('[data-index]');
      if (option) run(Number(option.dataset.index));
    });
    list.addEventListener('pointermove', (event) => {
      const option = event.target.closest('[data-index]');
      if (option && Number(option.dataset.index) !== active) move(Number(option.dataset.index) - active);
    });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    return { open, close: () => dialog.close(), toggle: () => (dialog.open ? dialog.close() : open()) };
  }

  /* ----------------------------------------------------------- crosshair */

  // Hover/keyboard readout for a rendered line plot. `plot` is re-rendered
  // on refresh, so listeners live on the stable host and resolve it lazily.
  function crosshair(host, { plot, getPoints, format }) {
    if (!host) return;
    function show(area, index) {
      const points = getPoints();
      const point = points[index];
      if (!point) return hide(area);
      let line = area.querySelector('.crosshair');
      if (!line) {
        line = window.document.createElement('div');
        line.className = 'crosshair';
        line.innerHTML = '<span class="crosshair-chip"></span>';
        area.appendChild(line);
      }
      const x = points.length > 1 ? index / (points.length - 1) : 0.5;
      line.style.left = (x * 100).toFixed(3) + '%';
      line.dataset.side = x > 0.5 ? 'left' : 'right';
      line.querySelector('.crosshair-chip').textContent = format(point);
      area.dataset.index = String(index);
    }
    function hide(area) { area?.querySelector('.crosshair')?.remove(); }
    host.addEventListener('pointermove', (event) => {
      const area = event.target.closest(plot);
      if (!area) return;
      const bounds = area.getBoundingClientRect();
      const points = getPoints();
      show(area, Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * (points.length - 1)));
    });
    host.addEventListener('pointerleave', () => hide(host.querySelector(plot)), true);
    host.addEventListener('keydown', (event) => {
      const area = event.target.closest(plot);
      if (!area || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      const points = getPoints();
      const current = Number(area.dataset.index ?? points.length - 1);
      const stride = Math.max(1, Math.round(points.length / 48));
      show(area, Math.max(0, Math.min(points.length - 1, current + (event.key === 'ArrowLeft' ? -stride : stride))));
    });
    host.addEventListener('focusout', (event) => hide(event.target.closest(plot)));
  }

  /* -------------------------------------------------------- theme reveal */

  // The new theme opens from the control that chose it. Rare action, so it
  // may be a little special; it is skipped entirely under reduced motion.
  function reveal(origin, apply) {
    const document = window.document;
    if (!document.startViewTransition || reducedMotion() || !origin) { apply(); return; }
    const bounds = origin.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    document.documentElement.classList.add('is-theming');
    const transition = document.startViewTransition(apply);
    transition.ready.then(() => document.documentElement.animate(
      { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
      { duration: 520, easing: 'cubic-bezier(0.645, 0.045, 0.355, 1)', pseudoElement: '::view-transition-new(root)' },
    )).catch(() => {});
    transition.finished.finally(() => document.documentElement.classList.remove('is-theming'));
  }

  return { escape, score, rank, rollMarkup, roll, ecg, fieldLevel, field, spotlight, glide, toast, dismiss, palette, crosshair, reveal };
});
