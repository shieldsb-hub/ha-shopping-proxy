# ha-shopping-proxy

Vercel Edge Function that fronts the family shopping list kiosk on Home
Assistant. Anyone with the proxy URL is silently logged in as a dedicated
read-only HA user (the `kiosk` user), so the household can use the
shopping list without per-user logins.

> ⚠️ Phase 1 status: deployed for testing as a transparent proxy with an
> injected token. Scoping ("can't access anything else") relies on the
> `kiosk` HA user's permissions — TBD as of this writing. Don't share the
> production URL widely until that's locked down.

## Architecture

- **`api/proxy.ts`** — single Edge Function that forwards every request
  to `${HA_URL}<original-path>` with `Authorization: Bearer ${HA_TOKEN}`
  injected. Strips client cookies and HA `Set-Cookie` headers.
- **`vercel.json`** — rewrites `/(.*) → /api/proxy` so the function
  handles every URL.
- **No frontend assets** — the wrapper page (cart icon) still lives in
  the sibling `ha-shopping-wrapper` repo until/unless we consolidate.

## Deploy

Connected to Vercel via "Import Git Repository" → this repo. Production
deploys on push to `main`. Two env vars must be set in Vercel project
settings (Production scope, marked as Secret):

| Var | Value |
|---|---|
| `HA_URL`   | `https://wooaeilbttvus6etixtt2izabobprcoj.ui.nabu.casa` |
| `HA_TOKEN` | Long-lived access token for the dedicated kiosk HA user |

## Known limitations

- **No WebSocket proxying.** Vercel Edge Functions don't support
  bidirectional WebSocket. HA's frontend will fail to open
  `/api/websocket`; the dashboard renders via REST but live updates need
  a manual refresh. Migrate to Cloudflare Workers if WS becomes blocking.
- **No path filtering yet.** Every path is proxied. Scope is enforced
  HA-side via the kiosk user's permissions. URL-typing to `/config` etc.
  should land on HA's own permission-denied screen.

## Related

- `../ha-shopping/` — HA-side packages, scripts, dashboard config
- `../ha-shopping-wrapper/` — static cart-icon landing page at
  shopping.bkia.com.au (GitHub Pages). Will eventually consolidate here.
