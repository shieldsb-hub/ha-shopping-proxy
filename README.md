# ha-shopping-proxy

> **Maintenance contract:** Updated when scope, deploy commands, or
> top-level structure changes.
>
> Docs follow [`ha-platform/DOC_STRATEGY.md`](https://github.com/shieldsb-hub/ha-platform/blob/main/DOC_STRATEGY.md).

Vercel Edge Function + custom kiosk SPA that fronts the family shopping
list at **shopping.bkia.com.au**. Anyone with the URL is silently logged
in as a dedicated kiosk HA user (`kiosk`, non-admin) and lands on a
purpose-built shopping UI — no HA chrome, no path to anything else in
the instance.

The path-scoped gateway forwards a strict allowlist to Home Assistant
with `Authorization: Bearer ${HA_TOKEN}` injected; everything else
returns 403/404.

## Architecture

```
shopping.bkia.com.au  (Cloudflare DNS → Vercel)
   │
   ▼
┌─────────────────────────────────────────────┐
│  Vercel project: ha-shopping-proxy          │
│                                             │
│  /                  → public/index.html     │  (React + Vite app,
│  /assets/*          → public/assets/        │   built from app/;
│  /classic/          → previous vanilla app  │   PWA via sw.js)
│  /icon.png|svg      → public/icon.{png,svg} │
│  /manifest.json     → public/manifest.json  │
│  /api/*             → api/proxy.ts          │
│                                             │
│  api/proxy.ts allowlist:                    │
│    GET  /api/states/todo.shopping_<cat>     │   read list state
│    POST /api/services/todo/{get,add,        │   list mutations
│         update,remove,remove_completed}_*   │
│    POST /api/sync                           │   press HA's unified
│         (entity fixed server-side;          │   "sync all sources"
│          /api/paprika/sync = legacy alias)  │   button (M7 + M8 +…)
│         blocks ≤9 s for each source's       │   then report what
│         result, then returns them per       │   each source did
│         source, never collapsed             │
│    GET  /api/harrisfarm/search?q=…          │   product search
│    GET  /api/harrisfarm/product/<handle>    │   product details
│    POST /api/order                          │   run the Woolworths
│         (script fixed server-side)          │   cart build (satellite)
│    GET  /api/order/status                   │   its status line only
│                                             │
│  Body validation: entity_id must match      │
│  ^todo\.shopping_[a-z_]+$ — rejects calls   │
│  that target non-shopping todo lists.       │
└─────────────────────────────────────────────┘
```

## The app (React + Vite, since 2026-10-10)

The family app at `/` is a React + Vite build in the Controller's Atelier
look (`app/`; approved mockups in the git-ignored `design/`). Build with
`cd app && npm install && npm run build`: Vite builds into `app/dist/`
(ignored) and the script copies `index.html` and `assets/` into `public/`,
which is committed so Vercel stays zero-config. `public/sw.js` gives the
offline fallback; hashed `/assets/*` are cached on first fetch.

The previous vanilla app is kept at `/classic/` as a fallback; the service
worker leaves it to the network. `/next/` (the trial path) redirects to `/`.

## Required env vars

Vercel project → Settings → Environment Variables (Production scope, Secret):

| Var | Value |
|---|---|
| `HA_URL`   | `https://<nabu-casa-id>.ui.nabu.casa` |
| `HA_TOKEN` | Long-lived access token for the `kiosk` HA user |

## Deploy

Connected to Vercel via GitHub auto-import. Production deploys on push
to `main`. First-time setup is documented in [`../ha-garden-proxy/README.md`](https://github.com/shieldsb-hub/ha-garden-proxy/blob/main/README.md)
— same pattern step-for-step (sibling project mirrors this one).

## Known limitations

- **No WebSocket.** Vercel Edge doesn't support WS upgrade. The kiosk
  polls REST instead. Acceptable here — shopping list isn't latency-
  sensitive. Port to Cloudflare Workers if you ever need real-time.
- **Single HA user.** All shoppers share the `kiosk` identity. HA
  history shows every list change as a `kiosk` action. If you want
  per-shopper attribution, would need a separate auth layer.

## Related

- `../ha-shopping/` — HA-side packages, scripts, dashboard config,
  category-routing automations
- `../ha-shopping-wrapper/` — older static cart-icon landing page at
  shopping.bkia.com.au (GitHub Pages). Superseded by the SPA in this
  repo; the wrapper repo can be deprecated when convenient.
- `../ha-garden-proxy/` — sibling kiosk pattern for the irrigation
  system at garden.bkia.com.au. Same architecture (path-scoped gateway
  + custom SPA), different domain.
