// Domain policy shared by the HTTP API, proxy, and expiry reconciler.
// Storage, clocks, and audit delivery are supplied by the host process.
function normalizeAuthMode(value) {
  const mode = String(value || "").toLowerCase();
  return mode === "none" || mode === "cloudflare-access" ? mode : null;
}

class ExposureError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function createExposureCore({
  services, initialState, saveState, appendAuditEntry,
  publicHost, defaultExpiryHours = 1, defaultAuthMode = "cloudflare-access",
  now = Date.now,
}) {
  let state = initialState;
  const byId = new Map(services.map((service) => [service.id, service]));
  const timestamp = () => new Date(now()).toISOString();
  const serviceDefaultAuthMode = (service) => normalizeAuthMode(service.authMode) || defaultAuthMode;
  const authModeFor = (service, exposure) => normalizeAuthMode(exposure?.authMode) || serviceDefaultAuthMode(service);
  const expired = (exposure) => Boolean(exposure?.enabled && exposure.expiresAt &&
    (!Number.isFinite(Date.parse(exposure.expiresAt)) || Date.parse(exposure.expiresAt) <= now()));
  const enabled = (exposure) => Boolean(exposure?.enabled && !expired(exposure));

  function requireService(id) {
    const service = byId.get(id);
    if (!service) throw new ExposureError("service not found: " + id, 404);
    return service;
  }

  function snapshot(service) {
    const exposure = state.exposures[service.id];
    const host = publicHost(service);
    return {
      id: service.id,
      name: service.name,
      description: service.description || "",
      target: service.target,
      publicHost: host,
      publicUrl: "https://" + host,
      enabled: enabled(exposure),
      desiredEnabled: Boolean(exposure?.enabled),
      expiresAt: exposure?.expiresAt ?? null,
      updatedAt: exposure?.updatedAt ?? null,
      defaultExpiryHours,
      defaultAuthMode: serviceDefaultAuthMode(service),
      authMode: authModeFor(service, exposure),
    };
  }

  function commit(exposures, entries) {
    const next = { ...state, exposures };
    saveState(next);
    state = next;
    for (const entry of entries) appendAuditEntry(entry);
  }

  function disabledState(service) {
    return {
      enabled: false, expiresAt: null, updatedAt: timestamp(),
      authMode: authModeFor(service, state.exposures[service.id]),
    };
  }

  return {
    list: () => services.map(snapshot),
    get: (id) => snapshot(requireService(id)),
    activeCount: () => services.filter((service) => enabled(state.exposures[service.id])).length,
    enable(id, options = {}) {
      const service = requireService(id);
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new ExposureError("enable options must be an object");
      }
      const hours = options.hours === null ? null : (options.hours ?? defaultExpiryHours);
      if (hours !== null && (typeof hours !== "number" || !Number.isFinite(hours) ||
          hours < 0.25 || hours > 24 || !Number.isInteger(hours * 4))) {
        throw new ExposureError("hours must be 0.25 to 24 in 15-minute increments, or null for until disabled");
      }
      const authMode = options.authMode === undefined
        ? serviceDefaultAuthMode(service) : normalizeAuthMode(options.authMode);
      if (!authMode) throw new ExposureError("authMode must be none or cloudflare-access");
      commit({ ...state.exposures, [id]: {
        enabled: true,
        expiresAt: hours === null ? null : new Date(now() + hours * 3600000).toISOString(),
        updatedAt: timestamp(), authMode,
      } }, [{ action: "enable", serviceId: id, authMode,
        ...(hours === null ? { expiryMode: "until-disabled" } : { hours }) }]);
      return snapshot(service);
    },
    disable(id) {
      const service = requireService(id);
      commit({ ...state.exposures, [id]: disabledState(service) }, [{ action: "disable", serviceId: id }]);
      return snapshot(service);
    },
    disableAll() {
      const disabled = services.filter((service) => state.exposures[service.id]?.enabled).length;
      commit(Object.fromEntries(services.map((service) => [service.id, disabledState(service)])),
        [{ action: "emergency-disable-all", disabled }]);
      return { disabled, services: services.map(snapshot) };
    },
    expire(trigger) {
      const stale = services.filter((service) => expired(state.exposures[service.id]));
      if (stale.length) {
        const exposures = { ...state.exposures };
        for (const service of stale) exposures[service.id] = {
          ...state.exposures[service.id], ...disabledState(service),
        };
        commit(exposures, stale.map((service) => ({ action: "auto-expire", serviceId: service.id,
          ...(trigger ? { trigger } : {}) })));
      }
      return stale.length;
    },
  };
}

module.exports = { createExposureCore, ExposureError, normalizeAuthMode };
