// Reads a Cloudflare zone's DNS record usage against its plan quota. The
// quota caps every record type, including ExternalDNS ownership TXT records.
const API = "https://api.cloudflare.com/client/v4";

function createDnsUsage({
  token, zoneName, fetchJson, now = Date.now,
  ttlMs = 10 * 60 * 1000, retryMs = 60 * 1000,
}) {
  const zone = String(zoneName || "").trim().toLowerCase();
  const configured = Boolean(String(token || "").trim() && zone);
  let zoneRef = null;
  let last = null;
  let checkedAt = 0;
  let failedAt = 0;
  let failure = null;
  let inflight = null;

  async function call(path) {
    const body = await fetchJson(API + path, { authorization: "Bearer " + String(token).trim() });
    if (!body || body.success !== true) {
      const error = Array.isArray(body?.errors) && body.errors[0];
      throw new Error(error ? "cloudflare " + (error.code || "") + " " + (error.message || "") : "cloudflare request failed");
    }
    return body.result;
  }

  async function read() {
    if (!zoneRef) {
      const zones = await call("/zones?name=" + encodeURIComponent(zone));
      const match = Array.isArray(zones) ? zones.find((item) => item && item.name === zone) : null;
      if (!match || !match.id) throw new Error("zone " + zone + " not visible to token");
      zoneRef = { id: match.id, account: match.account?.id || null };
    }
    const usage = await call("/zones/" + encodeURIComponent(zoneRef.id) + "/dns_records/usage");
    const records = Number(usage?.record_usage);
    const quota = Number(usage?.record_quota);
    if (!Number.isInteger(records) || records < 0) throw new Error("usage response missing record_usage");
    return {
      zone, records,
      quota: Number.isInteger(quota) && quota > 0 ? quota : null,
      dashboardUrl: zoneRef.account
        ? "https://dash.cloudflare.com/" + zoneRef.account + "/" + zone + "/dns/records"
        : null,
    };
  }

  function snapshot() {
    if (!configured) return { state: "unconfigured", zone: zone || null, records: null, quota: null, checkedAt: null, detail: "Cloudflare token not configured" };
    if (!last) return { state: "unavailable", zone, records: null, quota: null, checkedAt: null, detail: failure || "not checked yet" };
    const stale = failedAt > checkedAt;
    return {
      ...last,
      state: stale ? "stale" : "live",
      checkedAt: new Date(checkedAt).toISOString(),
      detail: stale ? failure : null,
    };
  }

  async function get(force) {
    if (!configured) return snapshot();
    const t = now();
    const fresh = last && t - checkedAt < ttlMs;
    const coolingDown = failedAt && t - failedAt < retryMs;
    if (!force && (fresh || coolingDown)) return snapshot();
    if (!inflight) {
      inflight = read()
        .then((value) => { last = value; checkedAt = now(); failure = null; })
        .catch((error) => { failedAt = now(); failure = error?.message || String(error); })
        .finally(() => { inflight = null; });
    }
    await inflight;
    return snapshot();
  }

  return { get, configured };
}

module.exports = { createDnsUsage };
