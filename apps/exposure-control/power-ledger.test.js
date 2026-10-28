const assert = require('node:assert/strict');
const { test } = require('node:test');
const { authorized, validateSnapshot } = require('./power-ledger');
const Pulse = require('./pulse');

const row = {
  month: '2026-10', costSgd: 1.2345, observedSamples: 20, expectedSamples: 40,
  collectedUntil: '2026-11-01T00:00:00+08:00',
};
const snapshot = () => ({ token: 'never-return-this', recordedAt: '2026-11-01T00:15:00+08:00', months: [{ ...row }] });

test('ledger authentication is fail-closed and accepts only the configured token', () => {
  assert.equal(authorized('secret', 'secret'), true);
  for (const input of [null, undefined, 1, {}, 'bad', 'x'.repeat(300)]) assert.equal(authorized(input, 'secret'), false);
  assert.equal(authorized('', ''), false);
});

test('monthly snapshot is whitelisted, token-free, finalized at Singapore month-end and coverage-aware', () => {
  const result = validateSnapshot(snapshot(), Date.parse('2026-11-02'));
  assert.equal(result.token, undefined);
  assert.equal(result.months[0].final, true);
  assert.equal(result.months[0].partial, true);
  assert.equal(result.months[0].coveragePercent, 50);
  assert.equal(result.months[0].collectedUntil, '2026-10-31T16:00:00.000Z');
});

test('invalid totals, duplicate months, future dates and impossible coverage are rejected', () => {
  const variants = [
    { costSgd: null }, { costSgd: '1' }, { costSgd: -1 }, { costSgd: Infinity },
    { month: '2026-13' }, { month: '<script>' }, { observedSamples: 41 },
    { expectedSamples: -1 }, { collectedUntil: '2026-12-01T00:00:00+08:00' },
    { collectedUntil: '2026-09-30T00:00:00+08:00' },
  ];
  for (const change of variants) assert.throws(() => validateSnapshot({ ...snapshot(), months: [{ ...row, ...change }] }, Date.parse('2026-11-02')));
  assert.throws(() => validateSnapshot({ ...snapshot(), months: [row, row] }, Date.parse('2026-11-02')));
  assert.throws(() => validateSnapshot(snapshot(), Date.parse('2026-10-01')));
});

test('monthly chart has distinct empty and unavailable states without invented values', () => {
  assert.match(Pulse.monthlyLedger(), /Awaiting the first collection/);
  assert.match(Pulse.monthlyLedger({ state: 'unavailable', months: [] }), /history unavailable/);
  assert.doesNotMatch(Pulse.monthlyLedger({ state: 'unavailable' }), /monthly-bars/);
});

test('monthly chart uses measured totals, partial patterns, real zero and keyboard-readable labels', () => {
  const data = validateSnapshot(snapshot(), Date.parse('2026-11-02'));
  data.months.push({ ...data.months[0], month: '2026-11', costSgd: 0, final: false });
  const html = Pulse.monthlyLedger(data, Date.parse('2026-11-02'));
  assert.match(html, /monthly-bars/);
  assert.match(html, /Recorded monthly homelab electricity costs/);
  assert.match(html, /Iris included from 28 Oct 2026, 16:30 SGT; earlier totals cluster-only/);
  assert.match(html, /height:0\.000%/);
  assert.match(html, /Final · partial coverage/);
  assert.match(html, /50% coverage/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /is-partial/);
  assert.doesNotMatch(html, /is-overdue/);
  assert.match(Pulse.monthlyLedger(data, Date.parse('2026-11-12')), /Collection overdue/);
  assert.doesNotMatch(Pulse.monthlyLedger({ months: [{ month: '<img>', costSgd: 0 }] }), /<img>/);
});
