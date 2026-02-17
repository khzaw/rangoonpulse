# iSponsorBlockTV

## URL
- `https://sponsorblocktv.khzaw.dev` (small info page; iSponsorBlockTV itself is headless)

## Deployment
- GitOps: `apps/isponsorblock-tv/`
- HelmRelease: `apps/isponsorblock-tv/helmrelease.yaml`

Notes:
- The upstream app is headless and requires a one-time setup to add at least one device.
- The pod runs with `hostNetwork: true` to support auto discovery during setup (per upstream docs).

## Setup (One-Time)
Run the CLI setup inside the running pod (writes config under `/app/data` on the PVC):

```bash
kubectl exec -n default -it deploy/isponsorblock-tv -c main -- \
  python3 -m iSponsorBlockTV --data /app/data setup-cli
```

After devices are configured, the `start` command should stay running.

