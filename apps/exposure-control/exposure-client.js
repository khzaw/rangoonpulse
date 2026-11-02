(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExposureClient = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function servicePath(id) {
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) throw new Error("invalid service id");
    return "/api/services/" + encodeURIComponent(id);
  }

  function createExposureClient({ request }) {
    return {
      list: () => request("/api/services", "GET"),
      enable: (id, options = {}) => request(servicePath(id) + "/enable", "POST", options),
      disable: (id) => request(servicePath(id) + "/disable", "POST"),
      disableAll: () => request("/api/admin/disable-all", "POST"),
      audit: () => request("/api/audit", "GET"),
    };
  }

  function createHttpRequest({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password ||
        base.pathname !== "/" || base.search || base.hash) {
      throw new Error("URL must be an http(s) origin without credentials, path, query, or fragment");
    }
    return async function request(path, method, body) {
      const response = await fetchImpl(new URL(path, base), {
        method, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected a JSON response from the private Control Panel API (HTTP " + response.status + ")");
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "HTTP " + response.status);
      return payload;
    };
  }

  return { createExposureClient, createHttpRequest };
});
