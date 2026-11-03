"""Conservative, evidence-based exception to the historical restart guard.

Kubernetes retains only the last termination. Never infer the cause of multiple
restarts, a retired pod's restart, or an ordinary crash from reboot timing alone.
"""

import datetime as dt
import json
import math
import re


REBOOT_RECOVERY_SECONDS = 600


def timestamp(value):
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, TypeError, ValueError):
        return None


def samples(vector):
    """Missing, malformed and non-finite telemetry cannot establish an exemption."""
    if not isinstance(vector, list):
        return None
    result = []
    for item in vector:
        try:
            value = float(item["value"][1])
            metric = item["metric"]
            if not math.isfinite(value) or not isinstance(metric, dict):
                return None
            result.append((metric, value))
        except (KeyError, TypeError, ValueError, IndexError):
            return None
    return result


def selector(metric, name):
    return name + "{" + ",".join(
        key + "=" + json.dumps(value) for key, value in sorted(metric.items()) if key != "__name__"
    ) + "}"


def single_value(prom, query):
    values = samples(prom.query_vector(query))
    return values[0][1] if values is not None and len(values) == 1 else None


def matching_pods(pods, namespace, workload, kind):
    expected_kind = "StatefulSet" if kind in ("statefulset", "statefulsets") else "ReplicaSet"
    pattern = re.escape(workload) + ("" if expected_kind == "StatefulSet" else "-[a-z0-9]+")
    return [pod for pod in pods if (pod.get("metadata") or {}).get("namespace") == namespace
            and any(owner.get("kind") == expected_kind and owner.get("controller") is True
                    and re.fullmatch(pattern, owner.get("name", ""))
                    for owner in (pod.get("metadata") or {}).get("ownerReferences", []))]


def live_snapshot(nodes, pods, namespace, workload, kind, container):
    boot_ids = {(n.get("metadata") or {}).get("name"):
                (n.get("status") or {}).get("nodeInfo", {}).get("bootID") for n in nodes}
    ready_nodes = {(n.get("metadata") or {}).get("name") for n in nodes
                   if any(c.get("type") == "Ready" and c.get("status") == "True"
                          for c in (n.get("status") or {}).get("conditions", []))}
    result = []
    for pod in matching_pods(pods, namespace, workload, kind):
        meta, spec, status = (pod.get(key) or {} for key in ("metadata", "spec", "status"))
        node = spec.get("nodeName")
        states = [s for s in status.get("containerStatuses", []) if s.get("name") == container]
        if (len(states) != 1 or not meta.get("uid") or meta.get("deletionTimestamp")
                or status.get("phase") != "Running" or not boot_ids.get(node) or node not in ready_nodes):
            return None
        state = states[0]
        started = state.get("state", {}).get("running", {}).get("startedAt")
        if not state.get("ready") or timestamp(started) is None:
            return None
        terminated = state.get("lastState", {}).get("terminated")
        result.append({"pod": meta.get("name"), "uid": meta["uid"], "node": node,
                       "boot_id": boot_ids[node], "restarts": state.get("restartCount"),
                       "started_at": started, "last_termination": {
                           key: terminated.get(key) for key in ("reason", "exitCode", "startedAt", "finishedAt")
                       } if terminated else None})
    return sorted(result, key=lambda item: item["uid"]) or None


def evidence_unchanged(assessment, nodes, pods, namespace, workload, kind, container):
    saved = assessment.get("live_snapshot")
    return bool(saved) and saved == live_snapshot(nodes, pods, namespace, workload, kind, container)


class RestartClassifier:
    def __init__(self, prom, nodes, pods, window):
        self.prom, self.nodes, self.pods, self.window = prom, nodes, pods, window
        self.boots = None

    def confirmed_boots(self):
        if self.boots is not None:
            return self.boots
        self.boots = {}
        exporter_pods = {(p.get("metadata", {}).get("namespace"), p.get("metadata", {}).get("name")):
                         p.get("spec", {}).get("nodeName") for p in self.pods}
        candidates = {}
        for metric, boot in samples(self.prom.query_vector("node_boot_time_seconds")) or []:
            node = exporter_pods.get((metric.get("namespace"), metric.get("pod")))
            if node:
                candidates.setdefault(node, []).append((metric, boot))
        for node, entries in candidates.items():
            if len(entries) != 1:
                continue
            metric, boot = entries[0]
            series = selector(metric, "node_boot_time_seconds")
            changes = single_value(self.prom, f"changes({series}[{self.window}])")
            previous = single_value(self.prom, f"min_over_time({series}[{self.window}])")
            if changes is not None and changes >= 1 and previous is not None and 0 < previous < boot:
                self.boots[node] = boot
        return self.boots

    @staticmethod
    def termination_matches(pod, state, boot):
        end = state.get("lastState", {}).get("terminated", {})
        created = timestamp(pod.get("metadata", {}).get("creationTimestamp"))
        previous = timestamp(end.get("startedAt"))
        finished = timestamp(end.get("finishedAt"))
        started = timestamp(state.get("state", {}).get("running", {}).get("startedAt"))
        if (state.get("restartCount") != 1 or not state.get("ready")
                or None in (created, previous, finished, started)):
            return False
        if not (created <= previous < boot <= started <= boot + REBOOT_RECOVERY_SECONDS
                and boot - 120 <= finished <= started):
            return False
        # Unknown/255 is the CRI lost-status marker. It additionally needs an
        # independent cohort; all other unknowns and nonzero exits stay guarded.
        return (end.get("reason"), end.get("exitCode")) == ("Completed", 0) or (
            (end.get("reason"), end.get("exitCode")) == ("Unknown", 255) and finished >= boot
        )

    def corroborating_owners(self, node, boot, finished):
        owners = set()
        for pod in self.pods:
            meta = pod.get("metadata") or {}
            if (pod.get("spec", {}).get("nodeName") != node or meta.get("deletionTimestamp")
                    or pod.get("status", {}).get("phase") != "Running"):
                continue
            for state in pod.get("status", {}).get("containerStatuses", []):
                end = state.get("lastState", {}).get("terminated", {})
                if (end.get("reason"), end.get("exitCode"), end.get("finishedAt")) != ("Unknown", 255, finished):
                    continue
                if self.termination_matches(pod, state, boot):
                    for owner in meta.get("ownerReferences", []):
                        if owner.get("controller") is True and owner.get("uid") and owner.get("name"):
                            kind, name = owner.get("kind"), owner["name"]
                            # ReplicaSets from successive rollouts are still
                            # one workload, not independent reboot witnesses.
                            if kind == "ReplicaSet":
                                kind, name = "Deployment", name.rsplit("-", 1)[0]
                            if kind in ("Deployment", "StatefulSet", "DaemonSet"):
                                owners.add((meta.get("namespace"), kind, name))
        return len(owners)

    def assess(self, namespace, workload, kind, container, pod_regex, total):
        assessment = {"status": "guarded", "excluded_restarts": 0, "reason": "unproven_restart_cause"}
        if total is None or not math.isfinite(total) or total < 0:
            return {**assessment, "status": "unavailable", "reason": "restart_metrics_unavailable"}
        if total == 0:
            return {**assessment, "status": "clear", "reason": "no_observed_restarts"}
        snapshot = live_snapshot(self.nodes, self.pods, namespace, workload, kind, container)
        if not snapshot:
            return {**assessment, "reason": "live_restart_state_unavailable"}
        selector_text = (f'kube_pod_container_status_restarts_total{{namespace={json.dumps(namespace)},'
                         f'pod=~{json.dumps(pod_regex)},container={json.dumps(container)}}}')
        history = samples(self.prom.query_vector(f"increase({selector_text}[{self.window}])"))
        if not history or any(value < 0 for _, value in history) or not math.isclose(
                sum(value for _, value in history), total, rel_tol=0.001, abs_tol=0.001):
            return {**assessment, "reason": "restart_history_incomplete"}
        current = {s["uid"]: s for s in snapshot}
        pods_by_uid = {p.get("metadata", {}).get("uid"): p for p in self.pods}
        evidence, seen = [], set()
        for metric, count in history:
            if count == 0:
                continue
            uid = metric.get("uid")
            live = current.get(uid)
            if (uid in seen or not live or live["pod"] != metric.get("pod")
                    or metric.get("namespace") != namespace or metric.get("container") != container
                    or live["restarts"] != 1 or not 0.95 <= count <= 1.05):
                return {**assessment, "reason": "restart_history_not_single_current_restart"}
            seen.add(uid)
            pod = pods_by_uid[uid]
            state = next(s for s in pod["status"]["containerStatuses"] if s["name"] == container)
            boot = self.confirmed_boots().get(live["node"])
            if boot is None or not self.termination_matches(pod, state, boot):
                return {**assessment, "reason": "termination_not_proven_reboot"}
            end = live["last_termination"]
            cohort = self.corroborating_owners(live["node"], boot, end["finishedAt"])
            if end["reason"] == "Unknown" and cohort < 3:
                return {**assessment, "reason": "runtime_status_loss_uncorroborated"}
            counter = selector(metric, "kube_pod_container_status_restarts_total")
            before = single_value(self.prom, f"{counter} @ {int(boot - 60)}")
            resets = single_value(self.prom, f"resets({counter}[{self.window}])")
            if before != 0 or resets != 0:
                return {**assessment, "reason": "pre_reboot_counter_unproven"}
            evidence.append({"pod": live["pod"], "uid": uid, "node": live["node"],
                             "boot_id": live["boot_id"], "boot_time": boot,
                             "termination_reason": end["reason"], "finished_at": end["finishedAt"],
                             "corroborating_owners": cohort})
        # A live restart absent from history is also uncertainty, even if other
        # replicas have positive, provable history.
        if not evidence or any(s["restarts"] != (1 if s["uid"] in seen else 0) for s in snapshot):
            return {**assessment, "reason": "live_and_historical_restarts_differ"}
        return {"status": "node_reboot", "excluded_restarts": len(evidence),
                "reason": "confirmed_node_reboot", "evidence": evidence, "live_snapshot": snapshot}
