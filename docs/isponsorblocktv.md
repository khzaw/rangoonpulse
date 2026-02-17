# iSponsorBlockTV

## URL
- `https://sponsorblocktv.khzaw.dev` (small info page; iSponsorBlockTV itself is headless)

## Deployment
- GitOps: `apps/isponsorblock-tv/`
- HelmRelease: `apps/isponsorblock-tv/helmrelease.yaml`

Notes:
- The upstream app is headless and requires a one-time setup to add at least one device.
- The pod runs with `hostNetwork: true` to support auto discovery during setup (per upstream docs).
- The container will stay idle until the config contains at least 1 device, then it will auto-start.

## Setup (One-Time)
Run the CLI setup inside the running pod (writes config under `/app/data` on the PVC):

```bash
kubectl exec -n default -it deploy/isponsorblock-tv -c main -- \
  python3 -m iSponsorBlockTV --data /app/data setup-cli
```

After devices are configured, the `start` command should stay running.
The deployment will automatically detect the configured device(s) and start the service within ~1 minute.
