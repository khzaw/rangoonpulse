"use strict";

const crypto = require("node:crypto");

function authorized(token, expected) {
  if (typeof token !== "string" || !expected || token.length > 256) return false;
  const a = Buffer.from(token), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateSnapshot(value, now = Date.now()) {
  if (!value || !Array.isArray(value.months) || value.months.length > 1200 ||
      !Number.isFinite(Date.parse(value.recordedAt)) || Date.parse(value.recordedAt) > now + 60000) {
    throw new Error("Invalid monthly ledger snapshot");
  }
  const seen = new Set();
  const months = value.months.map((row) => {
    if (!row || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) || seen.has(row.month) ||
        typeof row.costSgd !== "number" || !Number.isFinite(row.costSgd) || row.costSgd < 0 ||
        !Number.isSafeInteger(row.observedSamples) || row.observedSamples < 0 ||
        !Number.isSafeInteger(row.expectedSamples) || row.expectedSamples < row.observedSamples ||
        !Number.isFinite(Date.parse(row.collectedUntil))) throw new Error("Invalid monthly ledger row");
    seen.add(row.month);
    const start = Date.parse(row.month + "-01T00:00:00+08:00");
    const next = new Date(start + 8 * 3600000);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const end = next.getTime() - 8 * 3600000;
    const through = Date.parse(row.collectedUntil);
    if (through < start || through > end || through > Date.parse(value.recordedAt)) throw new Error("Invalid collection boundary");
    return {
      month: row.month, costSgd: row.costSgd,
      observedSamples: row.observedSamples, expectedSamples: row.expectedSamples,
      collectedUntil: new Date(through).toISOString(),
      final: through === end,
      partial: row.observedSamples < row.expectedSamples,
      coveragePercent: row.expectedSamples ? 100 * row.observedSamples / row.expectedSamples : null,
    };
  }).sort((a, b) => a.month.localeCompare(b.month));
  return { recordedAt: new Date(value.recordedAt).toISOString(), months };
}

module.exports = { authorized, validateSnapshot };
