# Resource Advisor Apply Plan

- Generated at: `2026-02-16T10:05:35Z`
- Metrics window: `14d`
- Coverage estimate: `1.77` days
- Selected changes: **1**
- Skipped candidates: **28**

## Node Constraint Gates

- CPU budget (`requests`): `5940.0m`
- Memory budget (`requests`): `25039.3Mi`
- Current CPU requests: `3205.0m`
- Current Memory requests: `10320.0Mi`
- Projected CPU requests: `3186.0m`
- Projected Memory requests: `10368.0Mi`

## Selected Changes

| Release | Container | CPU req | CPU new | Mem req | Mem new | Reason |
|---|---|---:|---:|---:|---:|---|
| jellyseerr | main | 75m | 56m | 192Mi | 240Mi | upsize_within_budget |

## Skipped Candidates

- `insufficient_data_for_downsize`: 11
- `insufficient_data_for_upsize`: 9
- `not_allowlisted`: 8

