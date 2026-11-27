(function initUpdatePolicy(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UpdatePolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function updatePolicyFactory() {
  "use strict";

  function canonicalPackage(value) {
    let result = String(value || "").trim().toLowerCase().replace(/\.git$/, "");
    result = result.replace(/^(?:docker\.io|index\.docker\.io|ghcr\.io|quay\.io|lscr\.io)\//, "");
    result = result.replace(/^library\//, "");
    return result;
  }

  function normalizedToken(value) {
    return canonicalPackage(value).replace(/[^a-z0-9]+/g, "");
  }

  function itemFullCandidates(item) {
    return [item && item.imageRepo, item && item.image, item && item.name, item && item.id]
      .map(canonicalPackage)
      .filter(Boolean);
  }

  function itemCandidates(item) {
    const full = itemFullCandidates(item);
    const ignoredParts = new Set([
      "advisor", "alpine", "app", "default", "docker", "exporter", "image", "latest",
      "library", "linuxserver", "main", "operator", "prometheus", "resource", "server",
    ]);
    const parts = full.flatMap((candidate) =>
      candidate
        .split(/[^a-z0-9]+/)
        .filter((part) => part.length >= 5 && !ignoredParts.has(part)),
    );
    return [...new Set([...full, ...parts])];
  }

  function matchScore(value, item) {
    const haystack = normalizedToken(value);
    if (!haystack) return 0;
    let best = 0;
    const exactTokens = new Set(itemFullCandidates(item).map(normalizedToken));
    for (const candidate of itemCandidates(item)) {
      const token = normalizedToken(candidate);
      if (token.length < 4) continue;
      if (haystack === token && exactTokens.has(token)) best = Math.max(best, 10000 + token.length);
      else if (haystack.includes(token) || token.includes(haystack)) best = Math.max(best, token.length);
    }
    return best;
  }

  function bestMatchingEntry(entries, item, valueForEntry) {
    let best = null;
    let bestScore = 0;
    for (const entry of entries) {
      const score = matchScore(valueForEntry(entry), item);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return best;
  }

  function findDetectedDependency(item, renovate) {
    const dependencies = Array.isArray(renovate && renovate.detectedDependencies)
      ? renovate.detectedDependencies
      : [];
    return bestMatchingEntry(dependencies, item, (dependency) => dependency && dependency.name);
  }

  function findRateLimitedUpdate(item, renovate) {
    const updates = Array.isArray(renovate && renovate.rateLimitedUpdates)
      ? renovate.rateLimitedUpdates
      : [];
    return bestMatchingEntry(
      updates,
      item,
      (update) => String((update && update.title) || "") + " " + String((update && update.branchName) || ""),
    );
  }

  function findOpenPr(item, renovate) {
    const prs = Array.isArray(renovate && renovate.openPrs) ? renovate.openPrs : [];
    return bestMatchingEntry(
      prs,
      item,
      (pr) => String((pr && pr.title) || "") + " " + String((pr && pr.headRefName) || ""),
    );
  }

  function sameVersion(left, right) {
    return String(left || "").replace(/^v/, "") === String(right || "").replace(/^v/, "");
  }

  function happenedAfter(left, right) {
    const leftTime = Date.parse(String(left || ""));
    const rightTime = Date.parse(String(right || ""));
    return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime > rightTime;
  }

  const CHART_MANAGED_IMAGE_REPOS = new Set([
    "grafana/grafana",
    "kiwigrid/k8s-sidecar",
    "kube-state-metrics/kube-state-metrics",
    "prometheus-operator/prometheus-operator",
    "prometheus/alertmanager",
    "prometheus/blackbox-exporter",
    "prometheus/node-exporter",
    "prometheus/prometheus",
    "tailscale/k8s-operator",
    "tailscale/tailscale",
    "valkey/valkey",
  ]);

  function helmFullCandidates(item) {
    return [item && item.chart, item && item.name, item && item.id]
      .map(canonicalPackage)
      .filter(Boolean);
  }

  function matchHelmScore(value, item) {
    const haystack = normalizedToken(value);
    if (!haystack) return 0;
    let best = 0;
    for (const candidate of helmFullCandidates(item)) {
      const token = normalizedToken(candidate);
      if (token.length < 4) continue;
      if (haystack === token) best = Math.max(best, 10000 + token.length);
      else if (haystack.includes(token)) best = Math.max(best, token.length);
    }
    return best;
  }

  function bestMatchingHelmEntry(entries, item, valueForEntry) {
    let best = null;
    let bestScore = 0;
    for (const entry of entries) {
      const score = matchHelmScore(valueForEntry(entry), item);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return best;
  }

  function classifyImageUpdate(item, renovate, imageCheckedAt) {
    if (!item || item.status !== "update") {
      return { kind: "current", label: "current", detail: "No newer image detected.", canRun: false };
    }

    const dependency = findDetectedDependency(item, renovate);
    if (
      dependency &&
      !sameVersion(item.currentVersion, dependency.currentValue) &&
      sameVersion(item.latestVersion, dependency.currentValue)
    ) {
      return {
        kind: "git-ahead",
        label: "Git at " + dependency.currentValue,
        detail: "Renovate already sees this version in Git; the live workload is behind.",
        canRun: false,
      };
    }

    const imageRepo = canonicalPackage(item.imageRepo || item.image);
    if (CHART_MANAGED_IMAGE_REPOS.has(imageRepo)) {
      return {
        kind: "chart-managed",
        label: "chart managed",
        detail: "This image is generated by a Helm chart or operator and is updated through the parent chart.",
        canRun: false,
      };
    }

    const openPr = findOpenPr(item, renovate);
    if (openPr) {
      return {
        kind: "open-pr",
        label: "open PR #" + String(openPr.number || ""),
        detail: String(openPr.title || "Renovate PR is open."),
        url: String(openPr.url || ""),
        canRun: false,
      };
    }

    const queued = findRateLimitedUpdate(item, renovate);
    if (queued) {
      return {
        kind: "queued",
        label: "queued",
        detail: "Renovate detected this update but the PR limit deferred it.",
        canRun: false,
      };
    }

    if (imageRepo === "node" && /^\d+-alpine$/.test(String(item.currentVersion || ""))) {
      const major = String(item.currentVersion).split("-", 1)[0];
      return {
        kind: "version-policy",
        label: "Node " + major + " line",
        detail: "Renovate keeps this floating Node major tag on its current release line.",
        canRun: false,
      };
    }

    const lastRunAt = renovate && renovate.lastRun && renovate.lastRun.updatedAt;
    const dependencyAlreadyReportedLatest = Boolean(
      dependency &&
      Array.isArray(dependency.updates) &&
      dependency.updates.some((version) => sameVersion(version, item.latestVersion)),
    );
    if (happenedAfter(imageCheckedAt, lastRunAt) && !dependencyAlreadyReportedLatest) {
      return {
        kind: "new-since-run",
        label: "new since run",
        detail: "The image report found this after Renovate last completed.",
        canRun: true,
      };
    }

    return {
      kind: "ready",
      label: "ready to scan",
      detail: "No open or queued Renovate update matched this image.",
      canRun: true,
    };
  }

  function classifyHelmUpdate(item, renovate, helmCheckedAt) {
    if (!item || item.status !== "update") {
      return { kind: "current", label: "current", detail: "No newer chart detected.", canRun: false };
    }

    if (
      item.specVersion &&
      !sameVersion(item.currentVersion, item.specVersion) &&
      sameVersion(item.latestVersion, item.specVersion)
    ) {
      return {
        kind: "git-ahead",
        label: "Git at " + item.specVersion,
        detail: "The HelmRelease spec is already at this version; Flux has not finished rolling it out yet.",
        canRun: false,
      };
    }

    const dependencies = Array.isArray(renovate && renovate.detectedDependencies)
      ? renovate.detectedDependencies
      : [];
    const dependency = bestMatchingHelmEntry(dependencies, item, (entry) => entry && entry.name);
    if (
      dependency &&
      !sameVersion(item.currentVersion, dependency.currentValue) &&
      sameVersion(item.latestVersion, dependency.currentValue)
    ) {
      return {
        kind: "git-ahead",
        label: "Git at " + dependency.currentValue,
        detail: "Renovate already sees this chart version in Git; the live release is behind.",
        canRun: false,
      };
    }

    const openPrs = Array.isArray(renovate && renovate.openPrs) ? renovate.openPrs : [];
    const openPr = bestMatchingHelmEntry(
      openPrs,
      item,
      (pr) => String((pr && pr.title) || "") + " " + String((pr && pr.headRefName) || ""),
    );
    if (openPr) {
      return {
        kind: "open-pr",
        label: "PR #" + String(openPr.number || ""),
        detail: String(openPr.title || "Renovate PR is open."),
        url: String(openPr.url || ""),
        canRun: false,
      };
    }

    const rateLimited = Array.isArray(renovate && renovate.rateLimitedUpdates)
      ? renovate.rateLimitedUpdates
      : [];
    const queued = bestMatchingHelmEntry(
      rateLimited,
      item,
      (update) => String((update && update.title) || "") + " " + String((update && update.branchName) || ""),
    );
    if (queued) {
      return {
        kind: "queued",
        label: "queued",
        detail: String(queued.title || "Renovate detected this chart update but the PR limit deferred it."),
        canRun: false,
      };
    }

    const lastRunAt = renovate && renovate.lastRun && renovate.lastRun.updatedAt;
    const dependencyAlreadyReportedLatest = Boolean(
      dependency &&
      Array.isArray(dependency.updates) &&
      dependency.updates.some((version) => sameVersion(version, item.latestVersion)),
    );
    if (happenedAfter(helmCheckedAt, lastRunAt) && !dependencyAlreadyReportedLatest) {
      return {
        kind: "new-since-run",
        label: "new since run",
        detail: "The chart report found this after Renovate last completed.",
        canRun: true,
      };
    }

    return {
      kind: "ready",
      label: "ready to scan",
      detail: "No open or queued Renovate update matched this chart.",
      canRun: true,
    };
  }

  return {
    canonicalPackage,
    classifyHelmUpdate,
    classifyImageUpdate,
    findDetectedDependency,
    findOpenPr,
    findRateLimitedUpdate,
  };
});
