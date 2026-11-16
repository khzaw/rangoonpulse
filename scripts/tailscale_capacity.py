"""Audited CPU/scheduling model for Tailscale Connector StatefulSets.

Matches tailscale/tailscale v1.104.7 cmd/k8s-operator/sts.go and its embedded
deploy/manifests/proxy.yaml. This is a capacity projection, never an apply input.
"""

import copy


CONNECTOR = 'rangoonpulse.khzaw.dev/capacity-connector'
PARENT = 'tailscale.com/parent-resource'
PARENT_TYPE = 'tailscale.com/parent-resource-type'
AUDITED_VERSION = '1.104.7'


def render(objects):
    connectors = [o for o in objects.values() if o.get('kind') == 'Connector']
    if not connectors:
        return []
    operator = objects.get(('HelmRelease', 'tailscale', 'tailscale-operator'), {})
    spec = operator.get('spec', {})
    if spec.get('chart', {}).get('spec', {}).get('version') != AUDITED_VERSION:
        raise ValueError('Re-audit Connector capacity rendering for this Tailscale operator version')
    namespace = spec.get('targetNamespace', operator['metadata']['namespace'])
    classes = {o['metadata']['name']: o for o in objects.values() if o.get('kind') == 'ProxyClass'}
    results = []
    for connector in connectors:
        if connector.get('apiVersion') != 'tailscale.com/v1alpha1':
            raise ValueError('Unsupported Connector API version for capacity rendering')
        cfg = connector['spec']
        if cfg.get('appConnector') or cfg.get('tailnet'):
            raise ValueError('Connector capacity rendering currently supports default-tailnet subnet routers only')
        name = connector['metadata']['name']
        profile = classes.get(cfg.get('proxyClass'))
        if cfg.get('proxyClass') and profile is None:
            raise ValueError('Connector capacity requires its Git-managed ProxyClass')
        pc = profile.get('spec', {}) if profile else {}
        if set(pc) - {'statefulSet', 'tailscale', 'metrics', 'useLetsEncryptStagingEnvironment'}:
            raise ValueError('Unsupported ProxyClass capacity fields')
        pod = pc.get('statefulSet', {}).get('pod', {})
        allowed = {'nodeName', 'nodeSelector', 'affinity', 'tolerations', 'priorityClassName',
                   'topologySpreadConstraints', 'labels', 'annotations', 'dnsPolicy', 'dnsConfig',
                   'imagePullSecrets', 'securityContext', 'tailscaleContainer', 'tailscaleInitContainer'}
        if set(pod) - allowed:
            raise ValueError('Unsupported ProxyClass pod capacity fields')

        def resources(field, default):
            result = copy.deepcopy(default)
            overlay = pod.get(field, {}).get('resources', {})
            if set(overlay) - {'requests', 'limits'}:
                raise ValueError('Unsupported ProxyClass resource fields')
            # The operator replaces each nonempty map; it does not merge keys.
            for key in ('requests', 'limits'):
                if overlay.get(key):
                    result[key] = copy.deepcopy(overlay[key])
            return result

        template = {k: copy.deepcopy(pod[k]) for k in (
            'nodeName', 'nodeSelector', 'affinity', 'tolerations',
        ) if k in pod}
        template['containers'] = [{'name': 'tailscale', 'resources': resources(
            'tailscaleContainer', {'requests': {'cpu': '1m', 'memory': '1Mi'}},
        )}]
        template['initContainers'] = [{'name': 'sysctler', 'resources': resources('tailscaleInitContainer', {})}]
        replicas = cfg.get('replicas', 1)
        if not isinstance(replicas, int) or replicas < 1:
            raise ValueError('Connector capacity requires a positive replica count')
        results.append({
            'apiVersion': 'apps/v1', 'kind': 'StatefulSet',
            'metadata': {'name': 'connector-' + name, 'namespace': namespace, 'annotations': {CONNECTOR: name}},
            'spec': {'replicas': replicas, 'template': {'spec': template}},
        })
    return results


def resolve(workload, state):
    """Use the generated StatefulSet identity so an existing proxy is not counted twice."""
    name = workload.get('metadata', {}).get('annotations', {}).get(CONNECTOR)
    if not name:
        return workload
    namespace = workload['metadata']['namespace']
    candidates = []
    for obj in state:
        meta = obj.get('metadata', {})
        if obj.get('kind') != 'StatefulSet' or meta.get('namespace') != namespace:
            continue
        labels = meta.get('labels', {})
        if labels.get(PARENT_TYPE) == 'connector' and labels.get(PARENT) == name:
            candidates.append(obj)
        elif not labels and meta.get('name', '').startswith('ts-' + name + '-'):
            raise ValueError('Refresh the capacity snapshot with Connector identity labels before checking this proxy')
    if len(candidates) > 1:
        raise ValueError('Ambiguous generated Connector StatefulSet identity')
    if candidates:
        workload = copy.deepcopy(workload)
        workload['metadata']['name'] = candidates[0]['metadata']['name']
    return workload
