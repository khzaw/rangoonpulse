---
title: Operations Command Reference
summary: Durable day-two commands for GitOps status, reconciliation, workloads, storage, DNS, and operator APIs.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Operations Command Reference

Run commands from the repository root with the intended kubeconfig and Talos context already selected.

Make automatically uses the repository's ignored `kubeconfig` when present, while preserving an explicit `KUBECONFIG`. Without that file, it leaves normal client configuration alone. Direct `kubectl` and `flux` commands need the same context selected explicitly; when using that local file:

```bash
export KUBECONFIG="$PWD/kubeconfig"
```

If direct commands return `Unauthorized` while Make works, compare kubeconfig selection before rotating credentials.

## Git And Validation

```bash
git status --short --branch
git fetch --prune
git pull --ff-only
make validate-all
```

## Flux

```bash
flux get sources all -A
flux get kustomizations -A
flux get helmreleases -A
flux get image repository -A
flux get image policy -A
flux get image update -A

flux reconcile source git flux-system -n flux-system
flux reconcile kustomization <name> -n flux-system --with-source
flux reconcile helmrelease <name> -n <namespace>
```

## Kubernetes Triage

```bash
kubectl get nodes -o wide
kubectl get pods -A -o wide
kubectl get events -A --sort-by=.lastTimestamp
kubectl top nodes
kubectl top pods -A
kubectl rollout status deployment/<name> -n <namespace> --timeout=180s
kubectl logs -n <namespace> deploy/<name> --since=30m
```

## DNS, Ingress, And Services

```bash
kubectl get ingress,svc,endpointslices -A
dig @1.1.1.1 +short <host>
curl -Ik --resolve <host>:443:10.0.0.231 https://<host>/
curl -I --max-time 20 https://<host>/
```

Use the dedicated edge VIP instead of `10.0.0.231` for Iris/Athena host-path checks.

## Storage

```bash
kubectl get sc
kubectl get pvc -A -o wide
kubectl get pv
kubectl get pods -n democratic-csi -o wide
```

Before any cleanup, prove the candidate is absent from current Pods, controllers, Flux sources, manifests, and intended recovery paths. `scripts/storage-sunset-cleanup.sh` is destructive tooling, not an inventory command.

## Self-Built Image Promotion

```bash
make deploy-blog
make deploy-mmcal
make deploy-ericaknight
make deploy-itvp
make deploy-retirement
make deploy-rangoon-mapper
```

Each target requests the corresponding ImageRepository, ImagePolicy, ImageUpdateAutomation, Git source, and app reconciliation. Fetch/pull afterward because image automation can commit to remote `master`.

## Exposure Control

```bash
curl -s https://controlpanel.khzaw.dev/api/services | jq
curl -s https://controlpanel.khzaw.dev/api/travel | jq
curl -s https://controlpanel.khzaw.dev/api/tuning | jq
```

Use the current catalog IDs returned by the API rather than copied examples.

## Talos

```bash
talosctl -n 10.0.0.197 dashboard
talosctl -n 10.0.0.38 dashboard
```

Use focused Talos recovery docs before upgrade, image-GC, or userspace-OOM operations.

## Safe Secret Inspection

```bash
kubectl get secret <name> -n <namespace> -o go-template='{{.metadata.namespace}}/{{.metadata.name}} keys={{range $k, $_ := .data}} {{$k}}{{end}}{{"\n"}}'
```

Never print values during routine verification.
