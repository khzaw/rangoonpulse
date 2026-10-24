---
title: Secrets Management
summary: Current SOPS, Flux, Kubernetes Secret, and control-panel editing model.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Secrets Management

## Source Of Truth

Git-managed credentials are SOPS-encrypted under `infrastructure/secrets/`. `infrastructure/secrets/kustomization.yaml` includes the encrypted Secret manifests, and `flux/kustomizations/secrets.yaml` reconciles them before dependent workloads.

Consult [GitHub credential reuse and permissions](./github-credentials.md) before requesting a new token. A public repository read does not establish workflow-dispatch or contents-write permission.

Flux decrypts with the cluster's age identity. Plaintext values must never be committed, copied into docs, or written into unencrypted workspace files.

## Runtime Model

Applications consume normal Kubernetes Secrets through `secretKeyRef`, `envFrom`, mounted files, or chart-specific secret references. The encrypted manifest is the durable desired state; the live Secret is the runtime projection.

A live Secret existing does not prove the encrypted source is complete or that its credentials remain valid. Verify the consumer and provider when diagnosing authentication.

## Control-Panel Editing

The control panel provides an allowlisted editor for Git-managed secrets. The flow is:

1. validate the requested namespace, name, type, and keys against the allowlist
2. place the payload in a short-lived Kubernetes Secret for the helper Job
3. encrypt the manifest with SOPS
4. commit and push the encrypted change
5. request Flux reconciliation
6. remove transient payload resources

The helper path must never log secret values. Read-back verification should compare metadata and key names only.

The private Secrets page inventories Git files before joining live Kubernetes metadata. A GitHub `Bad credentials` error can therefore hide valid live Secrets; check the GitHub credential before changing registration or RBAC. Refresh `/api/secrets?force=1` and check expected keys, `existsLive`, and the managed path without revealing values. Credential updates captured in environment variables require a consumer restart.

Delete actions remove the encrypted file and namespace Kustomization entry, then rely on Flux pruning. Do not expose `controlpanel.khzaw.dev` publicly: it can read managed live Secrets and create helper Jobs with transient plaintext payloads.

cert-manager owns generated TLS Secrets. Kubernetes also owns the restricted Iris watchdog's generated service-account token; see [Iris operations](./iris-operations.md). Inventory their metadata separately without pretending they are editable SOPS credentials. Apps without application credentials need no placeholder Secret.

## Key Lifecycle

- Keep the Flux age private key outside Git and back it up through the secure operator workflow.
- Add recipients before rotating away an old key, re-encrypt the corpus, verify Flux decryption, then retire the old identity.
- If local SOPS decryption is unavailable, do not assume repository corruption; Flux may have an identity not present on the operator host.
- Recovery requires both the encrypted Git data and at least one matching age private key.

## Adding Or Changing A Secret

Prefer the control-panel allowlisted path when supported. Otherwise:

1. create or update the Secret manifest locally without persisting plaintext outside the process
2. encrypt it with the repository SOPS policy
3. verify the file is encrypted and only expected keys are present
4. update `infrastructure/secrets/kustomization.yaml` if it is a new file
5. commit, push, reconcile `secrets`, and verify the consuming workload

Never use an imperative live-only Secret as the final state for a GitOps-managed credential.

## Verification

```bash
sops -d infrastructure/secrets/<path>.yaml >/dev/null
flux get kustomization secrets -n flux-system
kubectl get secret <name> -n <namespace> -o go-template='{{.metadata.namespace}}/{{.metadata.name}} keys={{range $k, $_ := .data}} {{$k}}{{end}}{{"\n"}}'
```

Do not print or decode secret values during routine verification.
