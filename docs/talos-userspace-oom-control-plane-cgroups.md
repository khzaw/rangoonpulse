# Talos Userspace OOM and Control Plane Cgroups

Use this when `kubectl` cannot reach the API server but Talos is reachable, or when `talosctl get oomaction` shows the Talos OOM controller killing Kubernetes pod cgroups.

## What Happened

Talos has a userspace OOM controller. It watches Linux pressure stall information, or PSI, and can kill a Kubernetes pod cgroup when memory pressure is high enough. This is separate from the kernel OOM killer.

A cgroup is a Linux accounting and control bucket for processes. Kubernetes puts each pod and each container into cgroups. The important memory fields are:

- `memory.current`: how much memory that cgroup is using now.
- `memory.max`: the memory ceiling for that cgroup. If it is `max`, the cgroup has no memory limit.

If critical static pods such as `kube-apiserver`, `kube-controller-manager`, or `kube-scheduler` have no memory limit, they can be ranked as OOM victims during a pressure spike. When `kube-apiserver` is killed, `kubectl` fails even if the kubeconfig certificate is still valid.

## Fast Triage

Check whether the Kubernetes API is down but Talos is up:

```sh
kubectl --kubeconfig ./kubeconfig get nodes
talosctl --talosconfig ./talos/talosconfig -e 10.0.0.197 -n 10.0.0.197 service kubelet status
talosctl --talosconfig ./talos/talosconfig -e 10.0.0.197 -n 10.0.0.197 get staticpodstatus -o yaml
```

Check for Talos OOM actions:

```sh
talosctl --talosconfig ./talos/talosconfig -e 10.0.0.197 -n 10.0.0.197 get oomaction -o yaml
talosctl --talosconfig ./talos/talosconfig -e 10.0.0.197 -n 10.0.0.197 read /proc/pressure/memory
```

Check the actual cgroup limits:

```sh
talosctl --talosconfig ./talos/talosconfig -e 10.0.0.197 -n 10.0.0.197 cgroups --preset memory | rg -C 3 'kube-apiserver|kube-controller-manager|kube-scheduler'
```

Healthy static control-plane pods should show finite `memory.max` values, not `max`, for the main container.

## Recovery Pattern

1. Confirm the kubeconfig certificate before regenerating anything:

   ```sh
   yq -r '.users[0].user."client-certificate-data"' kubeconfig | base64 -d | openssl x509 -noout -dates
   ```

2. If Talos OOM killed a control-plane static pod, add live resources to the machine config with a no-reboot patch. Example values used for this cluster:

   ```sh
   talosctl --talosconfig ./talos/talosconfig \
     -e 10.0.0.197 -n 10.0.0.197 patch machineconfig --mode no-reboot \
     --patch '[{"op":"add","path":"/cluster/apiServer/resources","value":{"requests":{"cpu":"250m","memory":"1Gi"},"limits":{"memory":"4Gi"}}},{"op":"add","path":"/cluster/controllerManager/resources","value":{"requests":{"cpu":"100m","memory":"256Mi"},"limits":{"memory":"1Gi"}}},{"op":"add","path":"/cluster/scheduler/resources","value":{"requests":{"cpu":"50m","memory":"128Mi"},"limits":{"memory":"512Mi"}}}]'
   ```

3. If Talos renders the static pod manifests but kubelet leaves a static pod stuck in `Pending`, restart kubelet:

   ```sh
   talosctl --talosconfig ./talos/talosconfig -e 10.0.0.197 -n 10.0.0.197 service kubelet restart
   ```

4. Verify API health and cgroup limits:

   ```sh
   kubectl --kubeconfig ./kubeconfig get --raw='/readyz?verbose'
   kubectl --kubeconfig ./kubeconfig -n kube-system get pods -l tier=control-plane -o wide
   talosctl --talosconfig ./talos/talosconfig -e 10.0.0.197 -n 10.0.0.197 cgroups --preset memory | rg -C 3 'kube-apiserver|kube-controller-manager|kube-scheduler'
   ```

5. Watch for the OOM controller moving to other uncapped pods:

   ```sh
   talosctl --talosconfig ./talos/talosconfig -e 10.0.0.197 -n 10.0.0.197 get oomaction -o yaml | tail -120
   kubectl --kubeconfig ./kubeconfig get pods -A --sort-by=.metadata.namespace
   ```

## Alerting Expectations

This class of incident should alert at critical severity. The cluster has a `control-plane-visibility` PrometheusRule that alerts on:

- control-plane static pod restarts,
- monitoring stack restarts,
- critical control-plane or monitoring containers becoming unready.

Do not rely only on `kubectl get pods --field-selector=status.phase!=Running`. A pod can have phase `Running` while one container is in `CrashLoopBackOff` or not ready.

## Caveats

The generated Talos machine config files under `talos/` are ignored because they contain sensitive material. If a live no-reboot Talos patch is used, make sure the source machine config that will be used for future Talos maintenance receives the same non-secret resource settings through the secure config workflow.
