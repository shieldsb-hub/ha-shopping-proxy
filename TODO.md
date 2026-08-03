# TODO — ha-shopping-proxy

> **Maintenance contract:** Reconciled at the end of any session that moves
> this domain's state. Grammar per
> [`ha-platform/DOC_STRATEGY.md`](https://github.com/shieldsb-hub/ha-platform/blob/main/DOC_STRATEGY.md)
> §TODO grammar. Cross-repo roll-up: `ha-platform/scripts/todo_report.sh`.

## Open

_Nothing outstanding — operational since 2026-05-08._

## Done

- [x] 2026-08-01 Sync button now reports what each source actually did. `/api/sync` used to return `{ok:true}` the instant the button was pressed, before either HA automation had run, so the kiosk could only ever say "Syncing…" and a sync that transferred nothing was indistinguishable from one that worked. That cost a real support round-trip on 2026-08-01: an item sat unsynced on a phone, the button was pressed three times in 40 seconds, and sync was reported broken while every layer was healthy. The endpoint now baselines each source's result helper, presses the button, and waits for those helpers to advance (~2.6 s when nothing transfers, ~4.7 s with a real Paprika transfer and its mark-back, 9 s ceiling), with the button disabled while it waits, which also stops the press-again loop. Reported **per source, never collapsed** into one verdict, since one source failing while the other works is exactly what needs to be visible; a source that never reports comes back `reported:false` and renders as "still running" rather than a zero, because the automations are `mode:single` and a press landing mid-poll is legitimately dropped. Accepted trade (Ben's call): this is the one place the gateway knows individual sources, eroding the "proxy never learns about sources" property the unified button was built for — a new source needs one `SYNC_SOURCES` entry plus its HA-side automation. Helpers are read server-side with the gateway's own token, so no new client-readable route opens, and the extra response fields are additive so cached older clients still behave. Verified against live HA: both sources "nothing new" in 2.63 s, and with a planted Paprika item, "Paprika: 1 item" alongside "Alexa: nothing new" in 4.66 s

- [x] 2026-07-26 Unified sync button: the per-source Paprika button is now a generic cloud-download "Sync" button that pulls from every source at once. Route `/api/paprika/sync` → `/api/sync` pressing HA's `input_button.shopping_sync_all` (which fans out to Paprika + Alexa + future HA-side, so new sources never touch this public surface); old path kept as a legacy alias for cached PWA clients. Inline cloud-download SVG icon, toast + spin + delayed refresh so synced items appear. sw.js VERSION bumped (drops stale caches); unused paprika.png removed. Verified fan-out live (one press → both HA automations fired; a real Alexa item routed through).
- [x] 2026-07-14 Paprika sync button in the kiosk header: POST /api/paprika/sync gateway route (entity fixed server-side), official app icon, toast + spin; verified live (button → gateway → HA automation trigger)

_(prune freely — git history is the archive)_
