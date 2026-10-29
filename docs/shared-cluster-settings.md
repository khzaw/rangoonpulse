---
title: Shared Cluster Settings
summary: Current Flux post-build substitution contract and cluster-wide non-secret keys.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Shared Cluster Settings

`flux/cluster-settings.yaml` is the source of cluster-wide non-secret constants consumed by child Flux Kustomizations through post-build substitution.

Current keys cover:

- base and secondary domains
- share-host prefix
- timezone
- primary and utility node names/IPs
- shared ingress VIP
- Transmission peer-to-peer VIP
- Mac mini edge VIP, LAN IP, and immutable power/cost enrollment timestamp (shared
  between Prometheus rules and the monthly collector)
- NAS and router IPs, plus the immutable TrueNAS power/cost enrollment timestamp
- AdGuard primary and secondary IPs
- LAN, Pod, and Service CIDRs

Add a key only when multiple reconciled components need one shared value. App-local values belong with the app.

## Substitution Rules

Use `${VAR}` for values Flux should substitute.

Use `$${VAR}` when the rendered resource must retain a literal `${VAR}` for the application runtime. Flux consumes one dollar sign and leaves the placeholder intact.

Numeric/boolean substitutions into string fields need Flux's quote-variable pattern:
`flux/kustomizations/media-postgres.yaml` defines `quote: '"'` and the collector uses
`${quote}${IRIS_POWER_COST_START_SECONDS}${quote}` for its environment value.
Quoting `${VAR}` in source YAML alone is insufficient: Kustomize can remove those
quotes before Flux substitutes the numeric value. Validate the post-substitution
YAML types, not only the source YAML.

Every child Kustomization that uses shared settings must reference the `cluster-settings` ConfigMap in `postBuild.substituteFrom`. Its `reconcile.fluxcd.io/watch: Enabled` label requeues consumers after a settings change, including when a new key lands with its consumers.

## Change Procedure

1. find every current consumer
2. update the shared value or add the key
3. render the full Flux tree
4. inspect substitutions and runtime-literal escapes
5. reconcile the smallest affected Kustomizations
6. verify the resulting objects and workload behavior

```bash
kubectl kustomize flux >/tmp/rangoonpulse-flux-rendered.yaml
rg '\${[A-Z_][A-Z0-9_]*}' /tmp/rangoonpulse-flux-rendered.yaml
```

`kubectl kustomize` builds objects but does not perform Flux post-build substitution; placeholders in this output are expected. Verify each owning Flux Kustomization's substitution source and inspect its applied objects to confirm the final values. Runtime placeholders should originate from `$${...}` in source. Dynacat, exposure-control JavaScript, and media-postgres shell configuration rely on this escape.

## Cadence Notes

Image automation timing is not a cluster setting. The six per-app flows own their intervals under `infrastructure/image-automation/`; Interview Prep currently uses three hours and the other five use six.

Talos machine configuration is outside Flux substitution. A shared IP change may require a separate secure Talos update; do not assume changing this ConfigMap updates nodes.
