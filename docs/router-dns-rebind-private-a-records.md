---
title: Private DNS And Rebind Protection
summary: Current diagnosis and safe exception model for private khzaw.dev records.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Private DNS And Rebind Protection

Private service hostnames may intentionally resolve to RFC1918 ingress or dedicated-edge VIPs. DNS resolvers and routers can reject those answers as DNS rebinding.

## Diagnosis

Compare each boundary:

```bash
dig @1.1.1.1 +short <private-host>
dig @10.0.0.233 +short <private-host>
dig @10.0.0.234 +short <private-host>
scutil --dns
```

Then query the resolver actually configured on the client. Query `10.0.0.1` only if the router is acting as that client's DNS proxy.

First rule out cached empty answers for new hostnames. ExternalDNS syncs every five minutes, and AdGuard, router, OS, and browser caches may recover at different times after publication. Compare authoritative/public resolution with each AdGuard, the router, and the actual client resolver. Clear only the affected cache through its authenticated administration surface; do not restart both DNS instances.

If the failure persists after publication and cache recovery, investigate rebind filtering. A private address resolving correctly at a public resolver does not alone distinguish filtering from a stale negative cache.

## Safe Fix

Prefer a scoped exception for `khzaw.dev` or the exact required hostnames. Do not disable DNS-rebind protection globally.

Permanent-public Tunnel hostnames are different. They should resolve to Cloudflare edge addresses. An RFC1918 answer for a permanently public hostname usually means DNS ownership is wrong.

## Verification

After changing resolver policy, flush the client cache and confirm DNS plus the actual HTTPS path. Use `curl --resolve` to separate resolver behavior from ingress behavior.
