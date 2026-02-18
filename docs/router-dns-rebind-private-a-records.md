# Router DNS Rebind Gotcha (Private A Records)

If you publish DNS records (via Cloudflare + external-dns) that point to private RFC1918 IPs (for example `10.0.0.231`),
some home routers will refuse to answer these queries from LAN clients.

## Symptom
- `https://someapp.khzaw.dev` works for some clients but not others.
- Browsers show DNS errors like "could not resolve host".
- Public resolvers return an answer:

```bash
dig @1.1.1.1 +short someapp.khzaw.dev
```

- Your router DNS returns `NOERROR` with an empty answer (or `NXDOMAIN`):

```bash
dig @10.0.0.1 someapp.khzaw.dev A +noall +comments +cmd
```

## Root Cause
Router-side DNS rebind protection or filtering of "public hostname -> private IP" responses.

Even if the router uses `1.1.1.1` for upstream DNS, it may still drop the response before returning it to clients.

## Fix
On the router DNS:
- Disable DNS rebind protection, or
- Add an allowlist/exception for `khzaw.dev` (or the specific hostname), or
- Ensure internal hostnames are served from an internal DNS view that allows private answers.

Client-side workarounds:
- Temporarily set DNS to `1.1.1.1`/`8.8.8.8`, or
- Add a `hosts` entry mapping the hostname to the ingress IP.

