# TV Channels (IPTV-Style): Tunarr and ErsatzTV

## Goal
Run a service that can present your Jellyfin media library as IPTV-style "channels" (scheduled programming).

## Tunarr (Primary)
- Deployment: `apps/tunarr/`
- URL: `https://tunarr.khzaw.dev`

### Persistence (Important)
Tunarr stores its state under:
- `/root/.local/share/tunarr`

To prevent channels/config from disappearing on pod restarts, Tunarr mounts an NFS-backed PVC:
- StorageClass: `truenas-nfs`
- Mount: `/root/.local/share/tunarr`

### Hardware Acceleration
Tunarr mounts the host GPU device:
- `hostPath: /dev/dri`

The HelmRelease also sets:
- `LIBVA_DRIVER_NAME=iHD`
- `LIBVA_DRIVERS_PATH=/usr/local/lib/x86_64-linux-gnu/dri`

## ErsatzTV (Alternative)
- Deployment: `apps/ersatztv/`
- URL: `https://ersatztv.khzaw.dev`

### Persistence
ErsatzTV stores config/state in `/config` and uses an NFS-backed PVC:
- StorageClass: `truenas-nfs`
- Mount: `/config`

### Media Access
ErsatzTV mounts the shared media library read-only from the existing PVC claim:
- Claim: `media`
- Mount: `/media` (read-only)

### Transcode Scratch
ErsatzTV uses an ephemeral scratch directory for temporary transcoding artifacts:
- `emptyDir` mounted at `/transcode`

This does not persist any state to node-local storage; it's only temporary scratch space.

### Hardware Acceleration (VAAPI)
ErsatzTV mounts the host GPU device:
- `hostPath: /dev/dri` (includes `renderD128`)

Configure VAAPI in the ErsatzTV UI (FFmpeg settings) to use VAAPI with the render node.

## Troubleshooting Notes
- If Tunarr channels/config "reset":
  - verify the pod is mounting the PVC at `/root/.local/share/tunarr`
  - verify the PVC is `Bound` and writable
- If VAAPI is missing in either service:
  - verify `/dev/dri` is mounted in the pod
  - verify the container user has permission to access `/dev/dri/renderD128`

