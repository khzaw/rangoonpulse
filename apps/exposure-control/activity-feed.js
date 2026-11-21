"use strict";

// One ordered feed from four records the panel already reads: Git commits,
// Flux release history, the operator audit log and managed job runs.
// Pure: every input is passed in and nothing here performs I/O.

const WINDOW_HOURS = 168;
const SUMMARY_HOURS = 24;
const MAX_EVENTS = 240;
// A rollout is attributed to a commit only when the commit landed shortly
// before it and after the release's previous rollout.
const ROLLOUT_LOOKBACK_MS = 2 * 3600000;
const ROLLOUT_SKEW_MS = 60000;
const MANUAL_JOB_ANNOTATION = "controlpanel.khzaw.dev/triggered-at";

const ACTORS = Object.freeze({
  flux: Object.freeze({ name: "flux", kind: "bot", icon: "layers" }),
  renovate: Object.freeze({ name: "renovate", kind: "bot", icon: "cycle" }),
  panel: Object.freeze({ name: "panel", kind: "bot", icon: "panel" }),
  kube: Object.freeze({ name: "kube", kind: "bot", icon: "job" }),
  operator: Object.freeze({ name: "operator", kind: "person" }),
});

function ms(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function oneLine(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return limit && text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// "Resource advisor report" reads as a noun mid-sentence; a first word with
// its own capitals, such as "TrueNAS", keeps its casing.
function inSentence(title) {
  const text = String(title || "");
  return /^[A-Z][a-z]*(\s|$)/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

// Long hexadecimal runs (commit SHAs, digests) shorten to seven characters.
function shortTag(value) {
  return String(value ?? "").replace(/[0-9a-f]{12,}/gi, (run) => run.slice(0, 7));
}

function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 90) return Math.round(seconds) + " s";
  if (seconds < 5400) return Math.round(seconds / 60) + " min";
  return (seconds / 3600).toFixed(1).replace(/\.0$/, "") + " h";
}

/* ----------------------------------------------------------------- areas */

function normalizePath(value) {
  return String(value || "").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}

// Flux Kustomizations own repository paths; the longest matching path names
// the area a file belongs to, which is also the tag its rollouts carry.
function kustomizationAreas(kustomizations) {
  return (Array.isArray(kustomizations) ? kustomizations : [])
    .map((item) => ({
      name: String(item?.metadata?.name || ""),
      path: normalizePath(item?.spec?.path),
    }))
    .filter((area) => area.name && area.path)
    .sort((a, b) => b.path.length - a.path.length || a.name.localeCompare(b.name));
}

function fallbackArea(file) {
  const parts = normalizePath(file).split("/").filter(Boolean);
  if (parts.length < 2) return "repo";
  if (/^(apps|infrastructure|core)$/.test(parts[0]) && parts.length > 2) return parts[1];
  if (parts[0] === ".github") return "ci";
  return parts[0].replace(/^\./, "");
}

function areaForFile(file, areas) {
  const path = normalizePath(file);
  const owner = areas.find((area) => path === area.path || path.startsWith(area.path + "/"));
  return owner ? owner.name : fallbackArea(path);
}

// Most-touched area first, so a commit's primary tag is where it did the most.
function areasForFiles(files, areas) {
  const counts = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const area = areaForFile(file, areas);
    counts.set(area, (counts.get(area) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/* --------------------------------------------------------------- commits */

function commitSubject(commit) {
  return String(commit?.commit?.message || "").split("\n")[0].trim();
}

function commitActor(commit, options) {
  const name = String(commit?.commit?.author?.name || "").trim();
  const login = String(commit?.author?.login || "").trim();
  if (/^fluxcdbot$/i.test(name) || /^fluxcdbot$/i.test(login) || /^image-automation\b/i.test(commitSubject(commit))) {
    return ACTORS.flux;
  }
  if (/^renovate/i.test(name) || /^renovate/i.test(login)) return ACTORS.renovate;
  if (options?.panelAuthor && name === options.panelAuthor) return ACTORS.panel;
  const display = login || name || "unknown";
  if (commit?.author?.type === "Bot" || /\[bot\]$/i.test(display)) {
    return { name: display.replace(/\[bot\]$/i, "").toLowerCase(), kind: "bot", icon: "commit" };
  }
  return { name: display, kind: "person" };
}

function commitWording(subject, actor) {
  let text = subject;
  let pullRequest = null;
  const pr = text.match(/\s*\(#(\d+)\)$/);
  if (pr) {
    pullRequest = Number(pr[1]);
    text = text.slice(0, pr.index);
  }
  const image = text.match(/^image-automation\(([^)]+)\):\s*update\s+(\S+)\s*->\s*(\S+)$/i);
  if (image) {
    return { text: "Update " + image[1] + " image", detail: shortTag(image[2]) + " → " + shortTag(image[3]), pullRequest };
  }
  // Renovate's conventional prefix says nothing its avatar does not.
  if (actor === ACTORS.renovate) text = capitalize(text.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, ""));
  return { text: oneLine(text, 200), detail: null, pullRequest };
}

function revisionSha(revision) {
  const match = String(revision || "").match(/([0-9a-f]{40})$/i);
  return match ? match[1].toLowerCase() : "";
}

function repositoryUrl(repository) {
  const repo = String(repository || "");
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? "https://github.com/" + repo : "";
}

// `commits` is GitHub's listing, newest first. A commit is applied once every
// Kustomization that owns one of its files reports a revision at or after it.
function commitEvents({ commits, commitFiles, areas, kustomizations, repository, rootKustomization, panelAuthor }) {
  const list = (Array.isArray(commits) ? commits : []).filter((commit) => /^[0-9a-f]{40}$/i.test(commit?.sha || ""));
  const position = new Map(list.map((commit, index) => [commit.sha.toLowerCase(), index]));
  const appliedAt = new Map();
  for (const item of Array.isArray(kustomizations) ? kustomizations : []) {
    const index = position.get(revisionSha(item?.status?.lastAppliedRevision));
    if (index !== undefined) appliedAt.set(String(item?.metadata?.name || ""), index);
  }
  const owners = new Set(areas.map((area) => area.name));
  const repo = repositoryUrl(repository);

  return list.map((commit, index) => {
    const sha = commit.sha.toLowerCase();
    const actor = commitActor(commit, { panelAuthor });
    const wording = commitWording(commitSubject(commit), actor);
    const files = commitFiles instanceof Map ? commitFiles.get(sha) : commitFiles?.[sha];
    const commitAreas = areasForFiles(files, areas);
    const relevant = commitAreas.filter((area) => owners.has(area));
    const judges = relevant.length ? relevant : [rootKustomization || "flux-system"];
    const known = judges.filter((name) => appliedAt.has(name));
    const state = !known.length ? null : known.length === judges.length && known.every((name) => appliedAt.get(name) <= index) ? "applied" : known.some((name) => appliedAt.get(name) > index) ? "pending" : null;
    const links = [];
    if (repo) {
      links.push({ label: sha.slice(0, 7), href: repo + "/commit/" + sha });
      if (wording.pullRequest) links.push({ label: "#" + wording.pullRequest, href: repo + "/pull/" + wording.pullRequest });
    }
    return {
      id: "commit:" + sha,
      at: commit?.commit?.committer?.date || commit?.commit?.author?.date || null,
      kind: "commit",
      actor,
      via: "git",
      text: wording.text,
      detail: wording.detail,
      area: commitAreas[0] || null,
      areas: commitAreas,
      tone: "neutral",
      failed: false,
      pinned: false,
      tags: state ? [["state", state]] : [],
      links,
      quote: null,
      progress: null,
      sha,
    };
  });
}

/* --------------------------------------------------------------- rollouts */

function releaseArea(release) {
  const meta = release?.metadata || {};
  return String((meta.labels || {})["kustomize.toolkit.fluxcd.io/name"] || meta.name || "");
}

function triggerFor(area, at, previousAt, commits) {
  const from = Math.max(previousAt ?? -Infinity, at - ROLLOUT_LOOKBACK_MS);
  const candidates = commits.filter((commit) => {
    const landed = ms(commit.at);
    return landed !== null && landed > from && landed <= at + ROLLOUT_SKEW_MS && commit.areas.includes(area);
  });
  if (!candidates.length) return null;
  const newest = candidates.reduce((best, commit) => (ms(commit.at) > ms(best.at) ? commit : best));
  return { actor: newest.actor, via: newest.via, at: new Date(ms(newest.at)).toISOString(), text: newest.text, more: candidates.length - 1 };
}

// The chart is worth a line when it is new or its version moved; Helm keeps
// only one predecessor, so the older entry has nothing to compare against.
function chartChange(entry, previous) {
  const chart = String(entry.chartName || "chart");
  const version = String(entry.chartVersion || "");
  if (!previous) return Number(entry.version) === 1 && version ? chart + " " + version : null;
  if (previous.chartName !== entry.chartName || previous.chartVersion !== entry.chartVersion) {
    return chart + " " + String(previous.chartVersion || "?") + " → " + (version || "?");
  }
  if (entry.appVersion && previous.appVersion && previous.appVersion !== entry.appVersion) {
    return "app " + previous.appVersion + " → " + entry.appVersion;
  }
  return null;
}

// Helm keeps the current and previous release; each is one rollout.
function rolloutEvents(helmReleases, commits) {
  const events = [];
  for (const release of Array.isArray(helmReleases) ? helmReleases : []) {
    const name = String(release?.metadata?.name || "");
    const namespace = String(release?.metadata?.namespace || "");
    if (!name) continue;
    const area = releaseArea(release);
    const history = (Array.isArray(release?.status?.history) ? release.status.history : [])
      .filter((entry) => entry && ms(entry.lastDeployed) !== null)
      .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
    history.forEach((entry, index) => {
      const previous = history[index + 1] || null;
      const at = ms(entry.lastDeployed);
      const status = String(entry.status || "");
      const failed = /fail/i.test(status);
      const version = Number(entry.version || 0);
      const tags = [["rev", String(version)]];
      if (status && status !== "superseded") tags.push(["status", status]);
      events.push({
        id: "rollout:" + namespace + "/" + name + ":" + version,
        at: entry.lastDeployed,
        kind: "rollout",
        actor: ACTORS.flux,
        via: "helm",
        text: failed ? "Rollout of " + name + " failed" : (version === 1 ? "Installed " : "Rolled out ") + name,
        detail: chartChange(entry, previous),
        area,
        areas: [area],
        tone: failed ? "danger" : "neutral",
        failed,
        pinned: false,
        tags,
        links: [],
        quote: failed ? null : triggerFor(area, at, previous ? ms(previous.lastDeployed) : null, commits),
        progress: null,
      });
    });
  }
  return events;
}

// Whatever Flux is not Ready about right now. These describe the present, so
// they are pinned above the timeline however long ago the condition began.
function reconcileEvents(items, via, now) {
  const events = [];
  for (const item of Array.isArray(items) ? items : []) {
    const name = String(item?.metadata?.name || "");
    if (!name || item?.spec?.suspend) continue;
    const ready = (Array.isArray(item?.status?.conditions) ? item.status.conditions : []).find((condition) => condition?.type === "Ready");
    if (!ready || ready.status === "True") continue;
    const reason = String(ready.reason || "Unknown");
    const waiting = ready.status !== "False" || reason === "DependencyNotReady" || reason === "Progressing";
    const area = via === "helm" ? releaseArea(item) : name;
    events.push({
      id: "flux:" + via + ":" + String(item?.metadata?.namespace || "") + "/" + name,
      at: ready.lastTransitionTime || new Date(now).toISOString(),
      kind: "reconcile",
      actor: ACTORS.flux,
      via,
      text: waiting ? "Reconciling " + name : name + " is not ready",
      detail: oneLine(ready.message, 240) || null,
      area,
      areas: [area],
      tone: waiting ? "warning" : "danger",
      failed: !waiting,
      pinned: true,
      tags: [["reason", reason]],
      links: [],
      quote: null,
      progress: waiting ? { ratio: null, label: "in progress" } : null,
    });
  }
  return events;
}

/* ------------------------------------------------------------------ audit */

const AUTH_LABEL = { "cloudflare-access": "cf-access", none: "none" };

function auditEvents(entries, jobs) {
  const areaByCronJob = new Map((Array.isArray(jobs) ? jobs : []).map((job) => [job.namespace + "/" + job.cronJob, job.fluxKustomization || job.id]));
  const events = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const action = String(entry?.action || "");
    const target = String(entry?.serviceId || "");
    if (!action || ms(entry?.ts) === null) continue;
    const short = target.split("/").pop();
    const event = {
      id: "audit:" + entry.ts + ":" + action + ":" + target,
      at: entry.ts,
      kind: "panel",
      actor: ACTORS.operator,
      via: "panel",
      text: oneLine(action + (target ? " " + target : ""), 200),
      detail: null,
      area: null,
      areas: [],
      tone: "neutral",
      failed: false,
      pinned: false,
      tags: [],
      links: [],
      quote: null,
      progress: null,
    };
    if (action === "enable") {
      event.via = "shares";
      event.text = "Shared " + target;
      event.area = target;
      const ttl = entry.expiryMode === "until-disabled" ? "none" : Number.isFinite(Number(entry.hours)) && entry.hours != null ? Number(entry.hours) + "h" : "";
      event.tags = (ttl ? [["ttl", ttl]] : []).concat([["auth", AUTH_LABEL[entry.authMode] || String(entry.authMode || "default")]]);
      if (entry.authMode === "none") event.tone = "warning";
    } else if (action === "disable") {
      event.via = "shares";
      event.text = "Unshared " + target;
      event.area = target;
    } else if (action === "auto-expire") {
      event.via = "shares";
      event.actor = ACTORS.panel;
      event.text = "Share of " + target + " expired";
      event.area = target;
    } else if (action === "emergency-disable-all") {
      event.via = "shares";
      event.text = "Disabled all shares";
      event.tags = [["closed", String(Number(entry.disabled) || 0)]];
    } else if (action === "site-deploy") {
      event.via = "deploy";
      event.text = "Requested a deploy of " + target;
      event.area = target;
    } else if (action === "site-deploy-all") {
      event.via = "deploy";
      event.text = "Requested a deploy of every site";
    } else if (action === "managed-job-run" || action === "managed-job-config") {
      event.via = "jobs";
      event.text = (action === "managed-job-run" ? "Started " : "Rescheduled ") + short;
      event.area = areaByCronJob.get(target) || null;
    } else if (action === "transmission-vpn-set") {
      event.via = "route";
      event.text = "Routed Transmission " + (entry.mode === "vpn" ? "through the VPN" : "direct");
      event.area = "transmission";
    } else if (action === "secret-upsert" || action === "secret-delete") {
      event.via = "secrets";
      event.text = (action === "secret-upsert" ? "Saved secret " : "Deleted secret ") + target;
      event.area = "secrets";
    }
    event.areas = event.area ? [event.area] : [];
    events.push(event);
  }
  return events;
}

/* ------------------------------------------------------------------- jobs */

// A CronJob contributes its latest finished run, plus any retained run that
// failed or is still going. Older routine successes would only be noise.
function jobEvents(jobRuns, now) {
  const events = [];
  for (const { job, runs } of Array.isArray(jobRuns) ? jobRuns : []) {
    if (!job) continue;
    const ordered = (Array.isArray(runs) ? runs : [])
      .filter((run) => run && ms(run.startedAt) !== null)
      .sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
    const typical = ordered.find((run) => run.status === "succeeded" && Number.isFinite(run.durationSeconds))?.durationSeconds ?? null;
    const area = job.fluxKustomization || job.id || null;
    const isActive = (run) => run.status === "running" || run.status === "pending";
    const latestFinished = ordered.find((run) => !isActive(run));
    ordered.forEach((run) => {
      const status = String(run.status || "unknown");
      const active = isActive(run);
      const failed = status === "failed";
      if (run !== latestFinished && !active && !failed) return;
      const manual = /-manual-/.test(String(run.name || "")) || Boolean((run.annotations || {})[MANUAL_JOB_ANNOTATION]);
      const elapsed = Math.max(0, (now - ms(run.startedAt)) / 1000);
      events.push({
        id: "job:" + String(job.namespace || "") + "/" + String(run.name || job.cronJob || job.id),
        at: active ? run.startedAt : run.completedAt || run.startedAt,
        kind: "job",
        actor: ACTORS.kube,
        via: manual ? "panel" : "cron",
        text: failed ? String(job.title || job.id) + " failed" : (active ? "Running " : "Ran ") + inSentence(job.title || job.id),
        detail: !active && Number.isFinite(run.durationSeconds) ? duration(run.durationSeconds) : null,
        area,
        areas: area ? [area] : [],
        tone: failed ? "danger" : active ? "warning" : "neutral",
        failed,
        pinned: active,
        tags: [["run", status]],
        links: [],
        quote: null,
        progress: active ? {
          // Without a previous success there is nothing to measure against.
          ratio: typical ? Math.min(0.96, elapsed / typical) : null,
          label: duration(elapsed) + (typical ? " of ~" + duration(typical) : ""),
        } : null,
      });
    });
  }
  return events;
}

/* ------------------------------------------------------------------- feed */

function buildFeed(input) {
  const options = input || {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const areas = kustomizationAreas(options.kustomizations);
  const commits = commitEvents({ ...options, areas });
  const all = commits
    .concat(rolloutEvents(options.helmReleases, commits))
    .concat(reconcileEvents(options.helmReleases, "helm", now))
    .concat(reconcileEvents(options.kustomizations, "kustomize", now))
    .concat(auditEvents(options.audit, options.jobs))
    .concat(jobEvents(options.jobRuns, now));

  const windowStart = now - WINDOW_HOURS * 3600000;
  const events = all
    .filter((event) => ms(event.at) !== null && (event.pinned || ms(event.at) >= windowStart))
    // Pinned conditions lead, failures before work in progress; the rest is a timeline.
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.pinned ? Number(b.failed) - Number(a.failed) : 0) || ms(b.at) - ms(a.at) || a.id.localeCompare(b.id))
    .slice(0, MAX_EVENTS)
    .map(({ sha, ...event }) => ({ ...event, at: new Date(ms(event.at)).toISOString() }));

  const since = now - SUMMARY_HOURS * 3600000;
  const recent = (event) => ms(event.at) >= since;
  const stalled = events.filter((event) => event.kind === "reconcile" && event.failed).length;
  const reconciling = events.filter((event) => event.kind === "reconcile" && !event.failed).length;
  const pending = events.filter((event) => event.kind === "commit" && event.tags.some(([key, value]) => key === "state" && value === "pending")).length;
  // A source that could not be read yields no count, never a zero.
  const git = options.gitAvailable !== false;
  const flux = Boolean(options.fluxAvailable);
  const summary = {
    hours: SUMMARY_HOURS,
    commits: git ? events.filter((event) => event.kind === "commit" && recent(event)).length : null,
    rollouts: flux ? events.filter((event) => event.kind === "rollout" && !event.failed && recent(event)).length : null,
    failed: flux ? events.filter((event) => event.failed && (event.pinned || recent(event))).length : null,
    pending,
    stalled,
    reconciling,
  };

  // Without Flux there is no evidence either way, so the feed claims nothing.
  const state = !flux ? "unknown" : stalled ? "stalled" : reconciling || pending ? "syncing" : "in-sync";
  return { state, summary, windowHours: WINDOW_HOURS, events };
}

module.exports = {
  ACTORS, WINDOW_HOURS, SUMMARY_HOURS, MAX_EVENTS,
  kustomizationAreas, areaForFile, areasForFiles, commitActor, commitEvents,
  rolloutEvents, reconcileEvents, auditEvents, jobEvents, buildFeed, shortTag, duration,
};
