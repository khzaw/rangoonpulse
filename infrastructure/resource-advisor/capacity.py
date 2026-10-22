"""CPU reservation policy shared by Git/CI and the local read-only preflight."""

import copy
import math
import time
from collections import Counter, defaultdict

import advisor

CONTROLLERS = {"Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"}
RESOURCES = {
    "deployments": "Deployment", "statefulsets": "StatefulSet", "daemonsets": "DaemonSet",
    "replicasets": "ReplicaSet", "jobs": "Job", "cronjobs": "CronJob", "pods": "Pod",
}


def key(obj):
    meta = obj.get("metadata") or {}
    return obj["kind"], meta.get("namespace", "default"), meta.get("name", "")


def owner(obj):
    return next((r for r in (obj.get("metadata") or {}).get("ownerReferences", []) if r.get("controller")), None)


def pod_spec(obj):
    if obj["kind"] == "Pod":
        return obj["spec"]
    if obj["kind"] == "CronJob":
        return obj["spec"]["jobTemplate"]["spec"]["template"]["spec"]
    return obj["spec"]["template"]["spec"]


def replicas(obj):
    return max(0, int(obj["spec"].get("parallelism" if obj["kind"] == "Job" else "replicas", 1)))


def cpu(obj):
    return advisor.pod_effective_requests({"spec": pod_spec(obj)})[0]


def terminal(obj):
    if obj["kind"] == "Pod":
        return not advisor.active_pod(obj)
    return obj["kind"] == "Job" and any(
        c.get("type") in ("Complete", "Failed") and c.get("status") == "True"
        for c in (obj.get("status") or {}).get("conditions", [])
    )


def surge(obj):
    if obj["kind"] != "Deployment" or (obj["spec"].get("strategy") or {}).get("type") == "Recreate":
        return 1
    value = ((obj["spec"].get("strategy") or {}).get("rollingUpdate") or {}).get("maxSurge", "25%")
    return max(1, math.ceil(replicas(obj) * float(value[:-1]) / 100) if isinstance(value, str) and value.endswith("%") else int(value))


def placement(spec):
    return {k: spec.get(k) for k in ("nodeName", "nodeSelector", "affinity", "tolerations")}


def eligible_nodes(spec, nodes):
    name = spec.get("nodeName")
    selector = spec.get("nodeSelector") or {}
    eligible = []
    terms = (((spec.get("affinity") or {}).get("nodeAffinity") or {}).get("requiredDuringSchedulingIgnoredDuringExecution") or {}).get("nodeSelectorTerms")
    for node in nodes:
        meta = node["metadata"]
        labels = meta.get("labels") or {}
        if name and meta["name"] != name:
            continue
        if not all(labels.get(k) == v for k, v in selector.items()):
            continue
        def matches(term):
            for field, values in (("matchExpressions", labels), ("matchFields", {"metadata.name": meta["name"]})):
                for expr in term.get(field, []):
                    actual = values.get(expr["key"])
                    expected = expr.get("values", [])
                    op = expr["operator"]
                    if op == "In" and actual not in expected:
                        return False
                    if op == "NotIn" and actual in expected:
                        return False
                    if op == "Exists" and actual is None:
                        return False
                    if op == "DoesNotExist" and actual is not None:
                        return False
                    if op in ("Gt", "Lt"):
                        try:
                            if not (int(actual) > int(expected[0]) if op == "Gt" else int(actual) < int(expected[0])):
                                return False
                        except (ValueError, TypeError, IndexError):
                            return False
            return True
        if terms is not None and not any(matches(t) for t in terms):
            continue
        eligible.append(meta["name"])
    return eligible


def signature(obj):
    """Only capacity-relevant intent is used to acknowledge an accepted write."""
    target = placement(pod_spec(obj))
    if obj["kind"] == "Pod":
        target.pop("nodeName", None)  # The scheduler fills this after admission.
    return json_signature([key(obj), cpu(obj), replicas(obj), surge(obj), target, owner(obj)])


def json_signature(value):
    import json
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def root_for_pod(pod, objects):
    ref = owner(pod)
    namespace = key(pod)[1]
    if ref:
        parent = (ref["kind"], namespace, ref["name"])
        if ref["kind"] == "ReplicaSet":
            rs = objects.get(parent)
            grandparent = owner(rs) if rs else None
            if grandparent and grandparent["kind"] == "Deployment":
                return "Deployment", namespace, grandparent["name"]
        return parent
    return key(pod)


def projection(items, pending=(), candidate=None):
    nodes = [o for o in items if o["kind"] == "Node"]
    alloc = {n["metadata"]["name"]: {"cpu_m": advisor.parse_cpu_to_m(n["status"]["allocatable"]["cpu"])} for n in nodes}
    objects = {key(o): o for o in items if o["kind"] != "Node"}
    variants = defaultdict(list)
    for obj in objects.values():
        if obj["kind"] in CONTROLLERS or obj["kind"] == "Pod":
            variants[key(obj)].append((obj, False))
    for obj in pending:
        variants[key(obj)].append((obj, True))
        objects.setdefault(key(obj), obj)
    if candidate is not None:
        variants[key(candidate)].append((candidate, True))
        objects.setdefault(key(candidate), candidate)
    # Include accepted but not yet persisted Pod writes in the current footprint.
    pods = {key(o): o for o in items if o["kind"] == "Pod" and not terminal(o)}
    for obj in [*pending, *([candidate] if candidate is not None else [])]:
        if obj["kind"] == "Pod":
            previous = pods.get(key(obj))
            if previous is None or cpu(obj) >= cpu(previous):
                pods[key(obj)] = obj
    by_root = defaultdict(list)
    for pod in pods.values():
        by_root[root_for_pod(pod, objects)].append(pod)
    rows = {name: {"current_cpu_m": 0.0, "cpu_after_upsizes_m": 0.0, "largest_replacement_cpu_m": 0.0} for name in alloc}
    for root in variants.keys() | by_root.keys():
        options = variants.get(root, [])
        # Owned ReplicaSets and Pods are already represented by their controller.
        if options:
            first = options[0][0]
            if first["kind"] == "ReplicaSet" and owner(first) and owner(first)["kind"] == "Deployment":
                continue
            if first["kind"] == "Pod" and root_for_pod(first, objects) != root and root_for_pod(first, objects) in variants:
                continue
        actual_total = Counter()
        actual_largest = Counter()
        actual_count = Counter()
        for pod in by_root.get(root, []):
            targets = eligible_nodes(pod_spec(pod), nodes)
            scheduled = pod_spec(pod).get("nodeName")
            for node in ([scheduled] if scheduled in alloc else targets):
                actual_total[node] += cpu(pod)
                actual_largest[node] = max(actual_largest[node], cpu(pod))
                actual_count[node] += 1
        totals = dict(actual_total)
        largest = dict(actual_largest)
        for obj, proposed in options:
            if terminal(obj):
                continue
            if obj["kind"] == "Pod" and owner(obj) and root != root_for_pod(obj, objects):
                continue
            spec = pod_spec(obj)
            targets = eligible_nodes(spec, nodes)
            if not targets and cpu(obj) > 0:
                raise ValueError(f"{root}: no eligible node; set a valid node selector")
            count = replicas(obj) if obj["kind"] != "Pod" else 1
            if obj["kind"] == "DaemonSet":
                counts = {n: 1 for n in targets}
            elif proposed or len(targets) == 1 or not actual_count:
                # An unpinned proposal must fit even if all replicas land on any eligible node.
                counts = {n: count for n in targets}
            else:
                counts = dict(actual_count)
                extra = max(0, count - sum(actual_count.values()))
                for node in targets:
                    counts[node] = counts.get(node, 0) + extra
            for node, number in counts.items():
                totals[node] = max(totals.get(node, 0), number * cpu(obj))
                if number:
                    largest[node] = max(largest.get(node, 0), cpu(obj) * surge(obj))
        for node in alloc:
            rows[node]["current_cpu_m"] += totals.get(node, 0)
            rows[node]["cpu_after_upsizes_m"] += totals.get(node, 0)
            rows[node]["largest_replacement_cpu_m"] = max(rows[node]["largest_replacement_cpu_m"], largest.get(node, 0))
    floor = advisor.env_float("MIN_FREE_CPU_M_PER_NODE", 1000)
    job = advisor.env_float("JOB_CPU_RESERVE_M_PER_NODE", 150)
    if any(not math.isfinite(v) or v < 0 for v in (floor, job)):
        raise ValueError("CPU reserve settings must be finite and non-negative")
    if not alloc:
        raise ValueError("Cannot validate CPU capacity: no nodes returned")
    return advisor.summarize_cpu_headroom(alloc, rows, floor, job)


class Guard:
    """Serialize decisions and hold unobserved writes until the API reflects them."""
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.pending = []

    def evaluate(self, obj, old, items, *, dry_run=False):
        now = self.clock()
        current = {key(o): o for o in items if o["kind"] != "Node"}
        self.pending = [(until, p) for until, p in self.pending if until > now and (
            key(p) not in current or signature(current[key(p)]) != signature(p)
        )]
        pending = [p for _, p in self.pending]
        kind = obj["kind"]
        # Existing intent is grandfathered, including no-op SSA reconciliation.
        # A placement change or reservation increase still requires a full check.
        if old is not None and cpu(obj) <= cpu(old) and replicas(obj) <= replicas(old) and surge(obj) <= surge(old):
            if placement(pod_spec(obj)) == placement(pod_spec(old)):
                return {"allowed": True, "reason": "CPU-neutral update or recovery downsize"}
        ref = owner(obj)
        if ref and (kind == "ReplicaSet" or (kind == "Pod" and old is None)):
            supported = {"Deployment"} if kind == "ReplicaSet" else {"ReplicaSet", "StatefulSet", "DaemonSet", "Job"}
            if ref["kind"] not in supported:
                return {"allowed": False, "reason": "Unsupported controller ownership for CPU admission"}
            parents = dict(current)
            parents.update({key(p): p for p in pending})
            parent = parents.get((ref["kind"], key(obj)[1], ref["name"]))
            if parent is None or parent.get("metadata", {}).get("uid") != ref.get("uid"):
                return {"allowed": False, "reason": "Cannot verify controller identity; retry after its API write settles"}
            if cpu(obj) > cpu(parent) + 0.01:
                return {"allowed": False, "reason": "Child CPU requests exceed the approved controller template; set explicit requests"}
            nodes = [o for o in items if o["kind"] == "Node"]
            if not set(eligible_nodes(pod_spec(obj), nodes)) <= set(eligible_nodes(pod_spec(parent), nodes)):
                return {"allowed": False, "reason": "Child placement exceeds the approved controller placement"}
            family = [p for p in parents.values() if p["kind"] == kind and key(p) != key(obj)
                      and key(p)[1] == key(obj)[1] and owner(p) and owner(p).get("uid") == ref["uid"]
                      and not terminal(p) and not p.get("metadata", {}).get("deletionTimestamp")]
            if kind == "ReplicaSet":
                count = sum(replicas(p) for p in family) + replicas(obj)
                limit = replicas(parent) + surge(parent)
            else:
                if parent["kind"] == "DaemonSet":
                    targets = eligible_nodes(pod_spec(obj), nodes)
                    family = [p for p in family if set(eligible_nodes(pod_spec(p), nodes)) & set(targets)]
                    limit = max(1, len(targets))
                else:
                    limit = replicas(parent)
                count = len(family) + 1
            if count > limit:
                return {"allowed": False, "reason": "Child replicas exceed the approved controller rollout budget"}
            projected = projection(items, pending, obj)
            if any(row["free_cpu_after_upsizes_m"] < -0.01 for row in projected["nodes"].values()):
                return {"allowed": False, "reason": "Approved rollout has no remaining allocatable CPU; retry when pods terminate"}
            if not dry_run:
                self.pending.append((now + 300, copy.deepcopy(obj)))
            return {"allowed": True, "reason": "Approved controller child may use rollout/job headroom"}
        # CronJobs are checked as prospective Jobs; the actual Job is checked again
        # when its schedule fires and no future reservation is held here.
        if kind == "CronJob":
            virtual = {"kind": "Job", "metadata": obj["metadata"], "spec": obj["spec"]["jobTemplate"]["spec"]}
            return self.evaluate(virtual, None, items, dry_run=True)
        baseline = projection(items, pending)
        proposed = projection(items, pending, obj)
        allowance = advisor.env_float("JOB_CPU_RESERVE_M_PER_NODE", 150) if kind == "Job" else 0
        failures = []
        for node, row in proposed["nodes"].items():
            before = baseline["nodes"][node]
            growing = row["cpu_after_upsizes_m"] > before["cpu_after_upsizes_m"] + 0.01
            growing = growing or row["required_cpu_headroom_m"] > before["required_cpu_headroom_m"] + 0.01
            if growing and row["free_cpu_after_upsizes_m"] + allowance < row["required_cpu_headroom_m"] - 0.01:
                failures.append(f"{node}: {row['free_cpu_after_upsizes_m']:g}m free, needs {row['required_cpu_headroom_m'] - allowance:g}m")
        if failures:
            return {"allowed": False, "reason": "CPU rollout/job headroom: " + "; ".join(failures), "cpuHeadroom": proposed}
        if not dry_run:
            if len(self.pending) >= 1024:
                raise ValueError("Too many unobserved capacity changes; retry after API writes settle")
            self.pending.append((now + 300, copy.deepcopy(obj)))
        return {"allowed": True, "reason": "CPU rollout/job headroom preserved", "cpuHeadroom": proposed}
