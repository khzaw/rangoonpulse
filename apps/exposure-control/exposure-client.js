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

  return { createExposureClient };
});
