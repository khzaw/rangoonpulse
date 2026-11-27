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
  const HOURS_RULE = "0.25 to 24 in 15-minute increments";
  const validHours = (hours) => typeof hours === "number" && Number.isFinite(hours) &&
    hours >= 0.25 && hours <= 24 && Number.isInteger(hours * 4);
  const expiryFrom = (hours) => (hours === null ? null : new Date(now() + hours * 3600000).toISOString());
  const expiryAudit = (hours) => (hours === null ? { expiryMode: "until-disabled" } : { hours });

  function requireOptions(options, action) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new ExposureError(action + " options must be an object");
    }
  }

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
      kind: service.kind === "agent" ? "agent" : "share",
      target: service.target,
      publicHost: host,
      publicUrl: "https://" + host,
      enabled: enabled(exposure),
      desiredEnabled: Boolean(exposure?.enabled),
      expiresAt: exposure?.expiresAt ?? null,
      updatedAt: exposure?.updatedAt ?? null,
      // When the current public window began; edits to a live share keep it.
      openedAt: enabled(exposure) ? (exposure.openedAt ?? exposure.updatedAt ?? null) : null,
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
      requireOptions(options, "enable");
      const hours = options.hours === null ? null : (options.hours ?? defaultExpiryHours);
      if (hours !== null && !validHours(hours)) {
        throw new ExposureError("hours must be " + HOURS_RULE + ", or null for until disabled");
      }
      const authMode = options.authMode === undefined
        ? serviceDefaultAuthMode(service) : normalizeAuthMode(options.authMode);
      if (!authMode) throw new ExposureError("authMode must be none or cloudflare-access");
      const at = timestamp();
      commit({ ...state.exposures, [id]: {
        enabled: true, expiresAt: expiryFrom(hours), updatedAt: at, openedAt: at, authMode,
      } }, [{ action: "enable", serviceId: id, authMode, ...expiryAudit(hours) }]);
      return snapshot(service);
    },
    // Changes a share that is public right now: a new expiry counted from now
    // (hours), more time on the current expiry (extendHours), or its auth.
    // A share that is off or already past its expiry is never reopened here.
    update(id, options = {}) {
      const service = requireService(id);
      requireOptions(options, "update");
      const current = state.exposures[id];
      if (!enabled(current)) throw new ExposureError("share is not public: " + id, 409);
      const setsExpiry = options.hours !== undefined;
      const extending = options.extendHours !== undefined;
      const setsAuth = options.authMode !== undefined;
      if (setsExpiry && extending) throw new ExposureError("send hours or extendHours, not both");
      if (!setsExpiry && !extending && !setsAuth) {
        throw new ExposureError("nothing to update: send hours, extendHours, or authMode");
      }
      if (setsExpiry && options.hours !== null && !validHours(options.hours)) {
        throw new ExposureError("hours must be " + HOURS_RULE + ", or null for until disabled");
      }
      if (extending && !validHours(options.extendHours)) {
        throw new ExposureError("extendHours must be " + HOURS_RULE);
      }
      if (extending && !current.expiresAt) throw new ExposureError("share has no expiry to extend: " + id, 409);
      const authMode = setsAuth ? normalizeAuthMode(options.authMode) : authModeFor(service, current);
      if (!authMode) throw new ExposureError("authMode must be none or cloudflare-access");
      const expiresAt = setsExpiry ? expiryFrom(options.hours)
        : extending ? new Date(Date.parse(current.expiresAt) + options.extendHours * 3600000).toISOString()
          : current.expiresAt ?? null;
      const at = timestamp();
      commit({ ...state.exposures, [id]: {
        ...current, enabled: true, expiresAt, updatedAt: at,
        openedAt: current.openedAt ?? current.updatedAt ?? at, authMode,
      } }, [{ action: "update", serviceId: id,
        ...(setsExpiry ? expiryAudit(options.hours) : {}),
        ...(extending ? { extendHours: options.extendHours } : {}),
        ...(setsAuth ? { authMode } : {}),
        expiresAt }]);
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
