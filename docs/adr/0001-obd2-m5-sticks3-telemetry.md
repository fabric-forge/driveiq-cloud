# ADR-0001: Live OBD-II telemetry via OBDLink CX + M5Stack StickS3

Status: **Proposed** — hardware pairing decided, ingestion details open
(see "Open questions" below).
Date: 2026-09-09

## Context

`driveiq-cloud` (Phase 1, per `MIGRATION_PLAN.md`) only holds data a human
enters or imports after the fact — vehicle record, maintenance log,
reminders, CARFAX import. There is no live signal from the car itself:
fault codes, trip stats, sensor readings while driving. This ADR covers
adding that path: an in-car device that reads OBD-II data and pushes it to
the backend, as a new track alongside (not blocking, not blocked by) the
existing Phase 2/3 RAG and CARFAX work.

Two hardware pieces had to be chosen together, not independently, because
they constrain each other:

- **OBD-II adapter**: OBDLink CX. It's the only device in the OBDLink
  lineup that speaks Bluetooth *Low Energy* — the rest of the line is
  Bluetooth Classic or USB/Wi-Fi. Its BLE service is documented (OBDLink
  support KB): service UUID `FFF0`, notify characteristic `FFF1`, write
  characteristic `FFF2`, max MTU 247 bytes, **no** BLE queued-writes support
  (payloads over the negotiated MTU must be chunked by the client, not
  handed to the stack to split).
- **Collector device**: M5Stack StickS3 (ESP32-S3-PICO-1-N8R8; 240 MHz
  dual-core, 8 MB PSRAM, 8 MB flash, Wi-Fi 4, **BLE 5 only — no Bluetooth
  Classic**, 1.14" IPS screen, 250 mAh battery). The ESP32-S3 family dropped
  Bluetooth Classic entirely, so it can only pair with an OBD-II adapter
  that speaks BLE — which is exactly why the CX (not a Classic-BT ELM327
  clone) was the adapter pick. This was confirmed as a non-issue rather
  than a compromise: BLE is OBDLink's own actively-supported path (it's
  what their iOS app uses), not a fallback.

Connectivity: the StickS3 joins the **phone's Wi-Fi hotspot** as a client
station — it has no SIM of its own. That means reachability to
`driveiq-api.ry-ops.dev` depends on the phone being in the car, its hotspot
on, and having cellular signal; this is a real, expected failure mode, not
an edge case.

## Decision

Adopt this chain for live telemetry:

```
OBDLink CX (BLE, FFF0/FFF1/FFF2) → M5Stack StickS3 (ESP32-S3, BLE client)
   → phone Wi-Fi hotspot (StickS3 as Wi-Fi station)
   → HTTPS → driveiq-api.ry-ops.dev (existing Hono Worker) → D1
```

- The StickS3 acts as a BLE central, connects to the CX, negotiates MTU,
  and speaks standard ELM327 AT/OBD-II PID request-response over the
  FFF1/FFF2 characteristics, chunking any write over the negotiated MTU
  itself (the CX won't do it for us).
- It relays parsed readings to a new endpoint on the existing
  `driveiq-cloud` Worker (mirroring the CRUD pattern already used for
  vehicle/maintenance/reminders — see routes in `README.md`), not to a new
  service. No new backend deployment target.
- This lands as **Phase 4** relative to `MIGRATION_PLAN.md`'s Phase 1–3
  roadmap: independent of RAG (Phase 2) and CARFAX/uploads (Phase 3), and
  does not block or get blocked by either.
- **Auth departs from decision #3 in `MIGRATION_PLAN.md`.** That decision
  put Cloudflare Access in front of the Worker for *human* access and
  explicitly deleted the old JWT/user system on the assumption that all
  callers are a browser going through Access. A firmware device can't do
  an Access browser flow, so the telemetry endpoint needs its own
  device-credential check, scoped narrowly to that one route — not a
  reintroduction of the old multi-user auth surface. Concrete mechanism is
  an open question below, but the principle (single-device credential,
  least privilege, not a general API-key system) is decided.

## Consequences

- Unlocks live fault codes / trip data feeding the dashboard and Aiana,
  beyond the static specs and after-the-fact records Phase 1–3 cover.
- StickS3's extra RAM/flash (vs. the smaller PLUS2 originally considered)
  buys headroom to run the BLE client, Wi-Fi/TLS stack, local buffering,
  and the on-device screen concurrently without it being a fight for
  memory — the reason it was picked over the classic-ESP32 M5 sticks.
- New always-on ingestion surface on the Worker that isn't gated by
  Cloudflare Access — needs its own hardening (rate limiting, payload
  validation, narrow device-token scope) since it's now a 24/7 unattended
  network entrant, unlike every existing route.
- 250 mAh battery is bridge power only (BLE/Wi-Fi reconnect gaps), not
  standalone runtime — device needs constant 12 V-to-USB power in the
  vehicle.
- Introduces a firmware build (new dev surface: toolchain choice,
  flashing/OTA story) that doesn't exist anywhere in the DriveIQ ecosystem
  today.
- Reachability is only as good as "phone in car, hotspot on, cellular up"
  — telemetry gaps during hotspot dropouts are expected, not a bug, so the
  design has to tolerate and backfill them rather than assume a live link.

## Alternatives considered

- **M5StickC PLUS2** (classic ESP32 — BLE + Bluetooth Classic + Wi-Fi,
  smaller/cheaper). Rejected: the BLE-only limitation of the StickS3 isn't
  a real cost against the CX, so PLUS2's Classic-BT fallback buys nothing,
  while StickS3's much larger RAM/flash and faster CPU are a real gain for
  running BLE + Wi-Fi/TLS + buffering + display together.
- **M5Stack Core2 / CoreS3** (bigger screen). Rejected for v1: no
  requirement yet for a rich on-device display; bulkier for a unit meant
  to sit tucked near the OBD port rather than be looked at while driving.
- **Generic Wi-Fi ELM327 dongle instead of OBDLink CX.** Rejected: would
  need the StickS3 to join the dongle's own Wi-Fi AP, but it also needs to
  be on the phone's hotspot to reach the backend — one radio can't serve
  both without a bridge/relay layer. BLE-to-adapter + Wi-Fi-to-phone keeps
  the two links independent. Generic ELM327 BLE/Wi-Fi clones also vary
  widely in protocol reliability; OBDLink's BLE behavior is documented and
  commercially supported.

## Open questions / spikes

- **Firmware home**: new repo (e.g. `fabric-forge/driveiq-stick`) vs. a
  subfolder somewhere existing. Leaning toward a new repo, mirroring how
  `sferic-collector`/`sferic-sticks3` split host-side collector from
  device firmware — but not decided.
- **BLE facts above are from public OBDLink support docs, not yet verified
  against a physical CX.** Confirm FFF0/FFF1/FFF2, the 247-byte MTU
  ceiling, and the no-queued-writes behavior against real hardware before
  the BLE client is written.
- **Device auth mechanism**: burned-in static token at flash time vs. a
  provisioning step that issues a rotating credential. Needs a decision
  before the endpoint ships, not after.
- **Telemetry schema**: which PIDs, sample interval, single-reading vs.
  batched POSTs to the backend — needs its own D1 migration, sized with
  retention/downsampling in mind from the start (continuous telemetry can
  dwarf the row counts of every Phase 1–3 table combined if unbounded).
