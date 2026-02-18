# ARM64 Node: `canal` CrashLoop (`flexvol-driver` exec format error)

## Symptom
- ARM64 worker (example: Raspberry Pi 4) shows as `Ready`, but pods scheduled to it fail to create a sandbox, or `canal` is not `Ready`.
- `kubectl -n kube-system get pods -l k8s-app=canal -o wide` shows the ARM node's `canal` pod stuck in `Init:CrashLoopBackOff`.
- `kubectl -n kube-system logs <canal-pod> -c flexvol-driver --previous` shows:
  - `exec /usr/local/bin/flexvol.sh: exec format error`

## Root Cause
The `flexvol-driver` init container image tag in the applied `canal.yaml` was `calico/pod2daemon-flexvol:v3.20.6`, which is **amd64-only**. On ARM64 nodes, it is pulled and then fails to execute.

## Immediate Fix (Live Cluster)
Patch the DaemonSet to use a multi-arch `pod2daemon-flexvol` tag (example uses `v3.28.0` which includes `arm64`):

```bash
kubectl -n kube-system patch ds canal --type='json' \
  -p='[{"op":"replace","path":"/spec/template/spec/initContainers/2/image","value":"docker.io/calico/pod2daemon-flexvol:v3.28.0"}]'

kubectl -n kube-system rollout status ds/canal --timeout=240s
kubectl -n kube-system get pods -l k8s-app=canal -o wide
```

Sanity check (schedule a throwaway pod onto the ARM node and ensure it gets a Pod IP):

```bash
kubectl run -n default nettest-arm --image=busybox:1.36 --restart=Never \
  --overrides='{"spec":{"nodeName":"<arm-node-name>","tolerations":[{"operator":"Exists"}]}}' \
  --command -- sh -c 'sleep 30'

kubectl -n default get pod nettest-arm -o wide
kubectl -n default delete pod nettest-arm
```

## Make It Stick (Future Nodes)
Ensure the CNI manifest source you apply (Talos `cluster.network.cni.urls` or whatever bootstrap flow you use)
references a Calico `canal.yaml` that uses a multi-arch `pod2daemon-flexvol` tag (or removes it).

If you want to verify an image tag is multi-arch before using it:

```bash
crane manifest docker.io/calico/pod2daemon-flexvol:v3.28.0 | rg -n 'architecture'
```

