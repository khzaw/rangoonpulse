---
title: Exposure CLI
summary: Usage guide for the native Rust CLI, including kubectl access, share commands, defaults, JSON output, and troubleshooting.
status: active
owner: homelab
last_reviewed: 2026-11-03
---

# Exposure CLI

`exposure` manages the public shares shown on the Control Panel's Exposure Control page. The CLI and GUI use the same API, share state, expiry rules, and audit history. Changes made through either interface appear in the other after refresh.

[Quick start](#quick-start) · [Commands](#commands) · [Share settings](#share-settings) · [JSON and scripting](#json-and-scripting) · [Local binary](#local-binary) · [Troubleshooting](#troubleshooting)

## Quick start

Run the installed Rust binary in the existing exposure-control pod:

```bash
kubectl -n default exec deployment/exposure-control -c main -- exposure list
```

The client machine needs `kubectl`, a working cluster context, and permission to read the Deployment, select its pod, and execute commands in it. It needs no repository checkout, Rust toolchain, or Node installation. The pod must be running; its CLI calls the server's loopback API.

For remote cluster access, follow [agent access](./agent-access.md). To inspect the current context and exec permission:

```bash
kubectl config current-context
kubectl auth can-i create pods/exec -n default
```

For shorter commands in a POSIX shell, define this helper:

```sh
exposure() {
  kubectl -n default exec deployment/exposure-control -c main -- exposure "$@"
}
```

The examples below use that helper. They also work with a locally installed `exposure` binary.

```bash
exposure list --active
exposure show bookorbit
exposure enable bookorbit
exposure disable bookorbit
```

**`enable` defaults to no exposure-control authentication and no expiry.** Supply `--for` to set a duration or `--auth cloudflare-access` to require Access.

## Commands

```text
exposure [--url <origin>] [--json] <command>
```

| Command | Purpose | Options |
| --- | --- | --- |
| `list` | List configured shares and their effective state | `--active` |
| `show <service>` | Inspect one service | — |
| `enable <service>` | Enable or update a share | `--for`, `--until-disabled`, `--auth` |
| `disable <service>` | Close one share | — |
| `disable-all --yes` | Close every share | `--yes` is required |
| `audit [service]` | Read recent events, optionally filtered by service | `--limit` |

Use the service ID from `list`, such as `bookorbit`, rather than its display name or hostname. IDs contain lowercase letters, digits, and hyphens.

These global options can appear before or after the command:

| Option | Behavior |
| --- | --- |
| `--json` | Print the API response envelope as JSON |
| `--url <origin>` | Override the API origin and `EXPOSURE_CONTROL_URL` |

`-h` or `--help` shows command help. The top-level `-V` or `--version` flag shows the CLI version.

```bash
exposure --help
exposure enable --help
exposure audit --help
exposure --version
```

### List and inspect

```bash
exposure list
exposure list --active
exposure show bookorbit
```

The table shows the service ID, state (`public` or `off`), authentication mode, expiry, and public URL. An enabled share without expiry displays `until disabled`. `show` also displays the description, upstream target, and last update time.

`--active` includes only effectively enabled shares. An expired share is excluded immediately, even if the periodic reconciler has not yet cleared its saved enabled flag. Enabling a share opens the configured route; it does not prove that the upstream application is healthy or that all public DNS and Tunnel wiring exists.

### Disable shares

```bash
exposure disable bookorbit
exposure disable-all --yes
```

Disabling clears the enabled state and expiry. It retains the saved authentication setting. `disable-all` is the emergency close action for all shares and reports how many saved enabled entries it disabled; that count can include entries already past their expiry.

### Read audit history

```bash
exposure audit
exposure audit bookorbit
exposure audit bookorbit --limit 50
```

Events are newest first. `--limit` accepts `1` through `100` and defaults to `20`. The server returns its latest 100 events across the Control Panel; service filtering and the requested limit are applied to that window. A filtered result can therefore contain fewer entries than the limit, including none, even when older matching events exist.

## Share settings

### Defaults

```bash
exposure enable bookorbit
```

This enables BookOrbit with `authMode: none` and no expiry. It remains enabled until disabled. These are explicit CLI defaults sent to the API, independent of the server's defaults for API callers that omit those fields.

Each `enable` call reapplies the selected settings. Re-enabling a share with no flags resets it to no authentication and indefinite duration. An explicit duration starts a new expiry countdown from the time of the request.

### Duration

```bash
exposure enable bookorbit --for 15m
exposure enable bookorbit --for 90m
exposure enable bookorbit --for 2h
exposure enable bookorbit --until-disabled
```

Durations use `m` for minutes or `h` for hours. The accepted range is 15 minutes through 24 hours, in 15-minute increments. `1.5h` is also valid; `16m`, `25h`, and a duration without a unit are rejected.

`--until-disabled` makes the default indefinite duration explicit. It cannot be combined with `--for`.

### Authentication

```bash
exposure enable bookorbit --auth none
exposure enable immich --auth cloudflare-access
exposure enable immich --for 2h --auth cloudflare-access
```

| Mode | Exposure-control behavior |
| --- | --- |
| `none` | Does not require a Cloudflare Access assertion header; this is the CLI default |
| `cloudflare-access` | Requires the Access assertion header on requests to the enabled share |

Authentication and duration are independent: `--auth cloudflare-access` alone still enables an indefinite share. Application logins and externally configured Cloudflare policies continue to apply in either mode. The CLI does not create or modify Access applications or policies. See the [share-host authentication contract](./share-host-authentication.md) for the trust boundary and external setup.

## JSON and scripting

Use `--json` for structured output. JSON goes to stdout; errors go to stderr.

```bash
exposure list --active --json | jq -r '.services[].publicUrl'
exposure show bookorbit --json | jq '.service | {enabled, authMode, expiresAt}'
exposure audit bookorbit --json | jq '.entries[] | {ts, action}'
```

These examples require `jq` on the client machine. JSON response envelopes are:

| Command | Response fields |
| --- | --- |
| `list` | `services`: array of service snapshots |
| `show`, `enable`, `disable` | `service`: one service snapshot |
| `disable-all` | `disabled`: count; `services`: updated snapshots |
| `audit` | `entries`: array of audit events |

Snapshots include the public URL, effective `enabled` state, saved `desiredEnabled` state, authentication mode, expiry, and update time. `expiresAt: null` means no expiry; check `enabled` as well to determine whether the share is currently public.

| Exit code | Meaning |
| --- | --- |
| `0` | Success, including help and version output |
| `1` | API, connection, response, or output failure |
| `2` | Command usage or argument validation error |

For a mutation whose result matters to a script, keep the command separate from any pipeline and check its status:

```sh
if exposure enable bookorbit --for 2h --json > share-result.json; then
  jq '.service | {id, enabled, expiresAt}' share-result.json
else
  exit 1
fi
```

When using the `kubectl` helper, Kubernetes connection or exec failures can also produce a nonzero status before the CLI starts.

## Local binary

The `kubectl` workflow needs no local build. To build a native binary for direct API access from a checkout:

```bash
cd apps/exposure-control/cli
cargo build --release --locked
./target/release/exposure list
```

Rustup selects the crate's pinned toolchain from `rust-toolchain.toml`. The built executable needs no Rust or Node installation at runtime. An optional local installation is available with `cargo install --locked --path .`; use a shell without the `kubectl` helper when invoking that installed binary directly.

### API origin

The local binary defaults to `https://controlpanel.khzaw.dev`, reachable over LAN or Tailscale. Inside the pod, `EXPOSURE_CONTROL_URL` is configured as `http://127.0.0.1:8080`.

Origin selection, in order of precedence:

1. `--url <origin>`
2. `EXPOSURE_CONTROL_URL`
3. The built-in private Control Panel origin

```bash
./target/release/exposure --url https://controlpanel.khzaw.dev list
EXPOSURE_CONTROL_URL=http://127.0.0.1:8080 ./target/release/exposure list
```

Use an HTTP(S) origin with no credentials, path, query, or fragment. Pass `https://controlpanel.khzaw.dev`, not a URL ending in `/api/services`. Requests have a ten-second timeout, refuse redirects, require JSON responses, and limit response bodies to 1 MiB.

### Port-forward fallback

If private ingress is unavailable, forward the existing Service:

```bash
kubectl -n default port-forward service/exposure-control 8080:8080
```

In another terminal, use a local binary:

```bash
exposure --url http://127.0.0.1:8080 list
```

Run this in a shell without the `kubectl` helper. The helper executes inside the pod; the local binary connects to the port forwarded on the client machine.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Kubernetes connection or context error | Check `kubectl config current-context` and the [cluster access guide](./agent-access.md) |
| `Forbidden` from `kubectl exec` | Check Deployment/pod read permissions and `pods/exec` permission in `default` |
| No running pod or container not found | Inspect `kubectl -n default get pods -l app.kubernetes.io/name=exposure-control`; use container `main` |
| `service not found` | Run `exposure list` and use the exact service ID |
| Invalid duration or conflicting options | Use 15-minute increments from `15m` to `24h`; choose `--for` or `--until-disabled` |
| Expected JSON, redirect, or connection failure | Check the API origin and private connectivity; a login page or share hostname is not the operator API |
| Share is enabled but the public URL fails | Check the upstream app, public DNS, Tunnel route, and any Access policy using the [public-edge guide](./public-edge-and-exposure-control.md) |

For a server-side failure, inspect the existing deployment:

```bash
kubectl -n default rollout status deployment/exposure-control
kubectl -n default logs deployment/exposure-control -c main --tail=50
```

## Implementation and delivery

The CLI source is in [`apps/exposure-control/cli/`](../apps/exposure-control/cli/). The server owns state transitions, expiry, authentication enforcement, and audit persistence. Both the CLI and GUI send requests to that API.

For image builds, digest promotion, and the init-container mount, see [CLI image delivery](./public-edge-and-exposure-control.md#cli-image-delivery).
