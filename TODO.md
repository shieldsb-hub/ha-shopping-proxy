# TODO — ha-shopping-proxy

> **Maintenance contract:** Reconciled at the end of any session that moves
> this domain's state. Grammar per
> [`ha-platform/DOC_STRATEGY.md`](https://github.com/shieldsb-hub/ha-platform/blob/main/DOC_STRATEGY.md)
> §TODO grammar. Cross-repo roll-up: `ha-platform/scripts/todo_report.sh`.

## Open

_Nothing outstanding — operational since 2026-05-08._

## Done

- [x] 2026-07-26 Unified sync button: the per-source Paprika button is now a generic cloud-download "Sync" button that pulls from every source at once. Route `/api/paprika/sync` → `/api/sync` pressing HA's `input_button.shopping_sync_all` (which fans out to Paprika + Alexa + future HA-side, so new sources never touch this public surface); old path kept as a legacy alias for cached PWA clients. Inline cloud-download SVG icon, toast + spin + delayed refresh so synced items appear. sw.js VERSION bumped (drops stale caches); unused paprika.png removed. Verified fan-out live (one press → both HA automations fired; a real Alexa item routed through).
- [x] 2026-07-14 Paprika sync button in the kiosk header: POST /api/paprika/sync gateway route (entity fixed server-side), official app icon, toast + spin; verified live (button → gateway → HA automation trigger)

_(prune freely — git history is the archive)_
