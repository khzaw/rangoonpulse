/*
 * thinking-orbs 0.1.1 canvas engine, adapted for the vanilla control panel.
 * https://github.com/Jakubantalik/thinking-orbs
 *
 * MIT License
 * Copyright (c) 2026 Jakub Antalik
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

(() => {
  'use strict';
  function F(e, n) {
    const s = Math.sin(e * 12.9898 + n * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  function st(e, n) {
    const s = Math.PI * (3 - Math.sqrt(5)), r = 1 - 2 * (e + 0.5) / n, t = Math.sqrt(1 - r * r), o = e * s;
    return [t * Math.cos(o), r, t * Math.sin(o)];
  }
  function ot(e, n) {
    return Math.atan2(Math.sin(e - n), Math.cos(e - n));
  }
  function q(e, n, s, r, t) {
    const o = Math.sin(n), c = Math.cos(n), a = Math.sin(e), i = Math.cos(e);
    return (m, g, M) => {
      const u = m * i + M * a, h = -m * a + M * i, b = g * c - h * o, x = g * o + h * c;
      return [s + u * t, r - b * t, x];
    };
  }
  function _(e, n, s, r = 0.3) {
    n.sort((t, o) => t.z - o.z);
    for (const t of n) {
      const o = t.a ?? 1;
      if (o < 0.02) continue;
      const c = Math.min(1, Math.max(0, t.white)), a = Math.round((s ? 1 - c : c) * 255);
      e.fillStyle = `rgba(${a},${a},${a},${o})`, e.beginPath(), e.arc(t.x, t.y, Math.max(r, t.r), 0, Math.PI * 2), e.fill();
    }
  }
  function $(e, n) {
    return (e / 300) ** n;
  }
  function et(e, n, s, r) {
    const t = 2 * n * s + r, o = e % t, c = new Array(n).fill(0);
    let a = -1;
    if (o < 2 * n * s) {
      const i = Math.floor(o / s), m = (o - i * s) / s, M = 1 - (1 - Math.min(1, m / 0.7)) ** 3;
      if (i < n) {
        for (let u = 0; u < i; u++) c[u] = 1;
        c[i] = M, a = i;
      } else {
        const u = 2 * n - 1 - i;
        for (let h = 0; h < u; h++) c[h] = 1;
        c[u] = 1 - M, a = u;
      }
    }
    return { amount: c, active: a };
  }
  function ct(e, n, s) {
    let [r, t, o] = e, c = !1;
    for (let a = 0; a < n.length; a++) {
      if (s.amount[a] <= 0) continue;
      const i = n[a], m = i.axis === 0 ? r : i.axis === 1 ? t : o;
      if (m < i.lo || m >= i.hi) continue;
      a === s.active && (c = !0);
      const g = i.ang * s.amount[a], M = Math.cos(g), u = Math.sin(g);
      if (i.axis === 0) {
        const h = t * M - o * u;
        o = t * u + o * M, t = h;
      } else if (i.axis === 1) {
        const h = r * M + o * u;
        o = -r * u + o * M, r = h;
      } else {
        const h = r * M - t * u;
        t = r * u + t * M, r = h;
      }
    }
    return [r, t, o, c];
  }
  function at(e) {
    const n = [];
    for (let s = 0; s < e; s++) {
      const r = Math.min(2, Math.floor(F(s, 2.3) * 3)), t = -1 + 0.5 * Math.min(3, Math.floor(F(s, 5.9) * 4)), o = F(s, 7.7) < 0.5 ? 1 : -1;
      n.push({ axis: r, lo: t, hi: t + 0.5, ang: o * Math.PI / 2 });
    }
    return n;
  }
  const rt = (e, n, s, r, t) => {
    const c = n / 2, a = n / 2, i = n / 2 * 0.82, m = 0.4 + 0.06 * Math.sin(s * 0.35), g = q(s * 0.5, m, c, a, i), M = s * (0.5 + (1.7 - 0.5) * (t.scanMul ?? 1)), u = $(n, t.rsPow ?? 0.6), h = t.dimBase ?? 1, b = [], x = t.latRings ?? 17, I = t.lonDensity ?? 44;
    for (let P = 0; P <= x; P++) {
      const y = -Math.PI / 2 + P / x * Math.PI, D = Math.cos(y), w = Math.sin(y), k = Math.max(1, Math.round(Math.abs(D) * I));
      for (let v = 0; v < k; v++) {
        const R = v / k * 2 * Math.PI, [p, d, l] = g(D * Math.cos(R), w, D * Math.sin(R)), f = (l + 1) / 2, S = ot(R + s * 0.5, M), L = Math.exp(-(S * S) / 0.18) * Math.max(0, l);
        b.push({
          x: p,
          y: d,
          z: l,
          r: ((t.rBase ?? 0.6) + (t.rDepth ?? 1.7) * f + (t.rBoost ?? 1) * L) * u,
          white: (t.inkFar ?? 0.62) - (t.inkSpan ?? 0.54) * f,
          // dimBase < 1 fades un-scanned dots so the meridian reads clearly
          a: h + (1 - h) * Math.min(1, L)
        });
      }
    }
    _(e, b, r, t.rMin);
  }, it = (e, n, s, r, t) => {
    const o = n / 2, c = n / 2, a = n / 2 * 0.82, i = q(s * 0.55, 0.35 + 0.1 * Math.sin(s * 0.9), o, c, a), m = $(n, t.rsPow ?? 0.6), g = t.moveCount ?? 14, M = at(g), u = et(s, g, 0.42, 1.2), h = [], b = t.latRings ?? 15, x = t.lonDensity ?? 40;
    for (let I = 0; I <= b; I++) {
      const P = -Math.PI / 2 + I / b * Math.PI, y = Math.cos(P), D = Math.sin(P), w = Math.max(1, Math.round(Math.abs(y) * x));
      for (let k = 0; k < w; k++) {
        const v = k / w * 2 * Math.PI, [R, p, d, l] = ct([y * Math.cos(v), D, y * Math.sin(v)], M, u), [f, S, L] = i(R, p, d), A = (L + 1) / 2;
        h.push({
          x: f,
          y: S,
          z: L,
          r: ((t.rBase ?? 0.6) + (t.rDepth ?? 1.7) * A + (l ? t.rActive ?? 0.3 : 0)) * m,
          white: (t.inkFar ?? 0.62) - (t.inkSpan ?? 0.54) * A - (l ? 0.14 : 0)
        });
      }
    }
    _(e, h, r, t.rMin);
  }, ht = (e, n, s, r, t) => {
    const o = n / 2, c = n / 2, a = n / 2 * 0.874, i = q(s * 0.18, 0.38, o, c, 1), m = $(n, t.rsPow ?? 0.6), g = [], M = t.rings ?? 15, u = t.lonDensity ?? 40;
    for (let h = 0; h <= M; h++) {
      const b = -Math.PI / 2 + h / M * Math.PI, x = Math.cos(b), I = Math.sin(b), P = 0.62 * Math.sin(s * 2.1 - h * 0.52) + 0.38 * Math.sin(s * 1.27 + h * 0.83), y = a * (0.88 + 0.105 * P), D = Math.max(1, Math.round(Math.abs(x) * u));
      for (let w = 0; w < D; w++) {
        const k = w / D * 2 * Math.PI, [v, R, p] = i(x * Math.cos(k) * y, I * y, x * Math.sin(k) * y), d = (p / a + 1) / 2, l = Math.max(0, P);
        g.push({
          x: v,
          y: R,
          z: p,
          r: ((t.rBase ?? 0.6) + (t.rDepth ?? 1.7) * d) * (1 + 0.4 * l) * m,
          white: 0.66 - 0.56 * d - 0.1 * l
        });
      }
    }
    _(e, g, r, t.rMin);
  };
  function lt(e) {
    return e * e * (3 - 2 * e);
  }
  function Q(e) {
    const n = e.length, s = [];
    let r = 0;
    for (let t = 0; t < n; t++) {
      const o = e[t], c = e[(t + 1) % n], a = Math.hypot(c[0] - o[0], c[1] - o[1]);
      s.push(a), r += a;
    }
    return (t) => {
      let o = t * r, c = 0;
      for (; o > s[c] && c < n - 1; )
        o -= s[c], c++;
      const a = e[c], i = e[(c + 1) % n], m = s[c] ? Math.min(1, o / s[c]) : 0;
      return [a[0] + (i[0] - a[0]) * m, a[1] + (i[1] - a[1]) * m];
    };
  }
  const ut = (e) => {
    const n = -Math.PI / 2 + e * 2 * Math.PI;
    return [Math.cos(n) * 0.24, Math.sin(n) * 0.24];
  }, Mt = Q([
    [0, -0.26],
    [0.24, 0.16],
    [-0.24, 0.16]
  ]), pt = Q([
    [0, -0.2],
    [0.2, -0.2],
    [0.2, 0.2],
    [-0.2, 0.2],
    [-0.2, -0.2]
  ]), Y = [ut, Mt, pt];
  function dt(e) {
    return Math.max(6, Math.round(34 * e));
  }
  const U = 1.4, J = 0.9, K = U + J, ft = (e, n, s, r, t) => {
    const o = Y.length, c = s % (K * o), a = Math.floor(c / K), i = c - a * K, m = i > U ? lt((i - U) / J) : 0, g = t.spread ?? 1, M = Y[a], u = Y[(a + 1) % o], h = 160, b = [];
    for (let p = 0; p < h; p++) {
      const d = p / h, l = M(d), f = u(d);
      b.push([(l[0] + (f[0] - l[0]) * m) * g, (l[1] + (f[1] - l[1]) * m) * g]);
    }
    const x = [];
    let I = 0;
    for (let p = 0; p < h; p++) {
      const d = b[p], l = b[(p + 1) % h], f = Math.hypot(l[0] - d[0], l[1] - d[1]);
      x.push(f), I += f;
    }
    const P = dt(t.iconD ?? 1), y = (t.rDot ?? 0.021) * 1.35 * g, D = 1 + 0.02 * Math.sin(i * 3.1), w = [], k = n / 2;
    let v = 0, R = 0;
    for (let p = 0; p < P; p++) {
      const d = p / P * I;
      for (; R + x[v] < d && v < h - 1; )
        R += x[v], v++;
      const l = b[v], f = b[(v + 1) % h], S = x[v] ? Math.min(1, (d - R) / x[v]) : 0, L = (l[0] + (f[0] - l[0]) * S) * D, A = (l[1] + (f[1] - l[1]) * S) * D;
      w.push({
        x: k + L * n,
        y: k + A * n,
        z: 0,
        r: Math.max(0.35, y * n),
        white: 0.1
      });
    }
    _(e, w, r, t.rMin);
  }, mt = (e, n, s, r, t) => {
    const o = n / 2, c = n / 2, a = n / 2 * 0.82, i = q(s * 0.12, 0.3, o, c, 1), m = $(n, t.rsPow ?? 0.6), g = [], M = t.orbitN ?? 12, u = t.ghostN ?? 40, h = t.particles ?? 3;
    for (let b = 0; b < M; b++) {
      const x = F(b, 1.7), I = F(b, 5.2), P = F(b, 8.9), y = a * (0.45 + 0.52 * x), D = x * 2 * Math.PI, w = Math.acos(2 * I - 1), k = Math.sin(w) * Math.cos(D), v = Math.cos(w), R = Math.sin(w) * Math.sin(D);
      let p = -v, d = k;
      const l = 0, f = Math.max(1e-6, Math.sqrt(p * p + d * d));
      p /= f, d /= f;
      const S = v * l - R * d, L = R * p - k * l, A = k * d - v * p, B = (0.25 + 0.55 * P) * (P > 0.5 ? 1 : -1);
      for (let C = 0; C < u; C++) {
        const E = C / u * 2 * Math.PI, [T, z, N] = i(
          (p * Math.cos(E) + S * Math.sin(E)) * y,
          (d * Math.cos(E) + L * Math.sin(E)) * y,
          (l * Math.cos(E) + A * Math.sin(E)) * y
        ), O = (N / y + 1) / 2;
        g.push({
          x: T,
          y: z,
          z: N,
          r: (t.ghostR ?? 0.9) * m,
          white: 0.72,
          a: (t.ghostA ?? 0.5) * (0.4 + 0.6 * O)
        });
      }
      for (let C = 0; C < h; C++) {
        const E = s * B + C / h * 2 * Math.PI + I * 6, [T, z, N] = i(
          (p * Math.cos(E) + S * Math.sin(E)) * y,
          (d * Math.cos(E) + L * Math.sin(E)) * y,
          (l * Math.cos(E) + A * Math.sin(E)) * y
        ), O = (N / y + 1) / 2;
        g.push({
          x: T,
          y: z,
          z: N,
          r: ((t.partR ?? 1.2) + (t.partRDepth ?? 1.6) * O) * m,
          white: 0.3 - 0.22 * O
        });
      }
    }
    _(e, g, r, t.rMin);
  }, gt = (e, n, s, r, t) => {
    const o = n / 2, c = n / 2, a = n / 2 * 0.78, i = t.spin ?? 1, m = q(s * 0.1 * i, 0.3, o, c, 1), g = $(n, t.rsPow ?? 0.6), M = [], u = t.ghostN ?? 150;
    for (let f = 0; f < u; f++) {
      const S = st(f, u), [L, A, B] = m(S[0] * a, S[1] * a, S[2] * a), C = (B / a + 1) / 2;
      M.push({ x: L, y: A, z: B, r: 0.8 * g, white: 0.78, a: 0.1 + 0.22 * C });
    }
    const h = s * 0.24 * i, b = 0.55 + 0.3 * Math.sin(s * 0.18) * i, x = Math.cos(h), I = 0, P = Math.sin(h), y = -P * Math.sin(b), D = Math.cos(b), w = x * Math.sin(b), k = I * w - P * D, v = P * y - x * w, R = x * D - I * y, p = t.lanes ?? 5, d = t.segs ?? 88, l = Math.max(1, Math.round(p * (t.bandMul ?? 1)));
    for (let f = 0; f < l; f++) {
      const S = (f - (l - 1) / 2) * 0.075, L = Math.abs(f - (l - 1) / 2) / Math.max(1, (l - 1) / 2);
      for (let A = 0; A < d; A++) {
        const B = A / d * 2 * Math.PI, C = (0.16 * Math.sin(B * 3 - s * 1.7 + f * 0.22) + 0.07 * Math.sin(B * 5 + s * 1.1)) * (t.wobMul ?? 1), E = S + C, T = x * Math.cos(B) + y * Math.sin(B) + k * E, z = I * Math.cos(B) + D * Math.sin(B) + v * E, N = P * Math.cos(B) + w * Math.sin(B) + R * E, O = Math.sqrt(T * T + z * z + N * N), [X, Z, W] = m(T / O * a, z / O * a, N / O * a), j = (W / a + 1) / 2;
        M.push({
          x: X,
          y: Z,
          z: W,
          r: ((t.rBase ?? 1.1) + (t.rDepth ?? 1.7) * j) * (1 - 0.25 * L) * g,
          white: 0.52 - 0.44 * j + 0.18 * L,
          a: 0.4 + 0.6 * j
        });
      }
    }
    _(e, M, r, t.rMin);
  }, bt = {
    orbits: mt,
    globe: rt,
    rubik: it,
    wave: ht,
    ribbon: gt,
    morph: ft
  }, yt = [
    ["latRings", "lonDensity"],
    ["rings", "lonDensity"],
    ["lanes", "segs"]
  ], xt = ["orbitN", "ghostN"], vt = ["iconD"], wt = ["rBase", "rDepth", "rActive", "rDot", "ghostR", "partR", "partRDepth"];
  function kt(e, n) {
    const s = { ...e }, r = /* @__PURE__ */ new Set(), t = Math.sqrt(n);
    for (const [o, c] of yt) {
      const a = s[o], i = s[c];
      a != null && i != null && !r.has(o) && !r.has(c) && (s[o] = Math.max(2, Math.round(a * t)), s[c] = Math.max(2, Math.round(i * t)), r.add(o), r.add(c));
    }
    for (const o of xt) {
      const c = s[o];
      c != null && !r.has(o) && (s[o] = Math.max(1, Math.round(c * n)));
    }
    for (const o of vt) {
      const c = s[o];
      c != null && (s[o] = Math.max(0.02, c * n));
    }
    return s;
  }
  function Pt(e, n) {
    const s = { ...e };
    for (const r of wt) {
      const t = s[r];
      t != null && (s[r] = t * n);
    }
    return s.rSizeMul = (s.rSizeMul ?? 1) * n, s;
  }
  const Dt = {
    globe: {
      latRings: 17,
      lonDensity: 44,
      rBase: 0.6,
      rDepth: 1.7,
      rBoost: 1,
      inkFar: 0.62,
      inkSpan: 0.54,
      rsPow: 0.6,
      rMin: 0.3
    },
    orbits: {
      orbitN: 12,
      ghostN: 40,
      ghostR: 0.9,
      ghostA: 0.5,
      particles: 3,
      partR: 1.2,
      partRDepth: 1.6,
      rsPow: 0.6,
      rMin: 0.3
    },
    rubik: {
      latRings: 15,
      lonDensity: 40,
      moveCount: 14,
      rBase: 0.6,
      rDepth: 1.7,
      rActive: 0.3,
      inkFar: 0.62,
      inkSpan: 0.54,
      rsPow: 0.6,
      rMin: 0.3
    },
    wave: {
      rings: 15,
      lonDensity: 40,
      rBase: 0.6,
      rDepth: 1.7,
      rsPow: 0.6,
      rMin: 0.3
    },
    ribbon: {
      lanes: 5,
      segs: 88,
      ghostN: 150,
      rBase: 1.1,
      rDepth: 1.7,
      rsPow: 0.6,
      rMin: 0.3
    },
    morph: {
      rDot: 0.021,
      iconD: 1,
      rMin: 0.25
    }
  }, Rt = {
    working: "orbits",
    searching: "globe",
    solving: "rubik",
    listening: "wave",
    composing: "ribbon",
    shaping: "morph"
  }, St = {
    orbits: {
      64: { speed: 1.885, count: 1, size: 1 },
      20: { speed: 3.9, count: 0.238, size: 2.4 }
    },
    globe: {
      64: { speed: 2.015, count: 0.42, size: 1.15, extra: { scanMul: 4.08, dimBase: 0.45 } },
      20: { speed: 2.665, count: 0.105, size: 1.75, extra: { scanMul: 4.335, dimBase: 0.45 } }
    },
    rubik: {
      64: { speed: 1.82, count: 0.35, size: 1.05 },
      20: { speed: 1.95, count: 0.088, size: 1.9 }
    },
    wave: {
      64: { speed: 4.388, count: 0.341, size: 1 },
      20: { speed: 3.998, count: 0.105, size: 1.6 }
    },
    ribbon: {
      64: { speed: 2.34, count: 0.25, size: 0.85, extra: { spin: 0, bandMul: 3.9, wobMul: 1 } },
      20: { speed: 3.12, count: 0.051, size: 1.073, extra: { spin: 0, bandMul: 4.94, wobMul: 1 } }
    },
    morph: {
      64: { speed: 2.405, count: 0.54, size: 0.395, extra: { spread: 1.45 } },
      20: { speed: 2.08, count: 0.53, size: 1.011, extra: { spread: 1.45 } }
    }
  }, H = /* @__PURE__ */ new Map();
  function It(e, n) {
    const s = `${e}-${n}`, r = H.get(s);
    if (r) return r;
    const t = Rt[e], o = St[t][n];
    let c = { ...Dt[t] };
    o.count !== 1 && (c = kt(c, o.count)), o.size !== 1 && (c = Pt(c, o.size)), o.extra && (c = { ...c, ...o.extra });
    const a = { mode: t, speed: o.speed, opts: c };
    return H.set(s, a), a;
  }

  const ORB_LABELS = {
    working: 'Working…',
    searching: 'Searching…',
    solving: 'Solving…',
    listening: 'Listening…',
    composing: 'Composing…',
    shaping: 'Shaping…',
  };
  const ORB_STATES = new Set(Object.keys(ORB_LABELS));

  function resolvedDark(canvas) {
    let element = canvas;
    while (element) {
      const theme = element.getAttribute && element.getAttribute('data-theme');
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      if (element.classList && element.classList.contains('dark')) return true;
      if (element.classList && element.classList.contains('light')) return false;
      element = element.parentElement;
    }
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function createThinkingOrb(canvas, options) {
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const config = options || {};
    let state = ORB_STATES.has(config.state) ? config.state : 'working';
    const size = config.size === 64 ? 64 : 20;
    const speed = Number.isFinite(config.speed) ? config.speed : 1;
    const reducedMotion = typeof matchMedia !== 'undefined'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const colorScheme = typeof matchMedia !== 'undefined'
      ? matchMedia('(prefers-color-scheme: dark)')
      : null;
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    const context = canvas.getContext('2d');
    if (!context) return null;

    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', config['aria-label'] || ORB_LABELS[state]);

    let frameId = 0;
    let running = false;
    let visible = true;
    let paused = Boolean(config.paused);

    function frame(timeSeconds) {
      const resolved = It(state, size);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size, size);
      bt[resolved.mode](context, size, timeSeconds * resolved.speed * speed, resolvedDark(canvas), resolved.opts);
    }

    function loop() {
      frame(performance.now() / 1000);
      if (running) frameId = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(frameId);
    }

    function start() {
      if (running || paused || !visible || document.visibilityState === 'hidden') return;
      if (reducedMotion && reducedMotion.matches) {
        frame(0.6);
        return;
      }
      running = true;
      frameId = requestAnimationFrame(loop);
    }

    function redraw() {
      stop();
      frame(reducedMotion && reducedMotion.matches ? 0.6 : performance.now() / 1000);
      start();
    }

    const intersectionObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          if (visible) start();
          else stop();
        })
      : null;
    intersectionObserver?.observe(canvas);

    const themeObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(redraw)
      : null;
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };
    const onMediaChange = () => redraw();
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion?.addEventListener('change', onMediaChange);
    colorScheme?.addEventListener('change', onMediaChange);
    frame(0.6);
    if (!intersectionObserver) start();

    return {
      setState(nextState) {
        if (!ORB_STATES.has(nextState) || nextState === state) return;
        state = nextState;
        canvas.setAttribute('aria-label', ORB_LABELS[state]);
        redraw();
      },
      setPaused(nextPaused) {
        paused = Boolean(nextPaused);
        if (paused) stop();
        else start();
      },
      destroy() {
        stop();
        intersectionObserver?.disconnect();
        themeObserver?.disconnect();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        reducedMotion?.removeEventListener('change', onMediaChange);
        colorScheme?.removeEventListener('change', onMediaChange);
      },
    };
  }

  window.ThinkingOrbs = Object.freeze({ create: createThinkingOrb });
})();
