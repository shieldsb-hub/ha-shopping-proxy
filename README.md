# ha-shopping-proxy

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
│  /                  → public/index.html     │  (custom kiosk SPA,
│  /icon.png|svg      → public/icon.{png,svg} │   ~1300 lines vanilla
│  /manifest.json     → public/manifest.json  │   HTML/CSS/JS, PWA-ready)
│  /api/*             → api/proxy.ts          │
│                                             │
│  api/proxy.ts allowlist:                    │
│    GET  /api/states/todo.shopping_<cat>     │   read list state
│    POST /api/services/todo/{get,add,        │   list mutations
│         update,remove,remove_completed}_*   │
│    GET  /api/harrisfarm/search?q=…          │   product search
│    GET  /api/harrisfarm/product/<handle>    │   product details
│                                             │
│  Body validation: entity_id must match      │
│  ^todo\.shopping_[a-z_]+$ — rejects calls   │
│  that target non-shopping todo lists.       │
└─────────────────────────────────────────────┘
```

## Required env vars

Vercel project → Settings → Environment Variables (Production scope, Secret):

| Var | Value |
|---|---|
| `HA_URL`   | `https://<nabu-casa-id>.ui.nabu.casa` |
| `HA_TOKEN` | Long-lived access token for the `kiosk` HA user |

## Deploy

Connected to Vercel via GitHub auto-import. Production deploys on push
to `main`. First-time setup is documented in [`../ha-garden-proxy/README.md`](../ha-garden-proxy/README.md)
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
