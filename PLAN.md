# Shape B implementation plan

Picks up from the Shape A dead-end (`api/proxy.ts` as currently
deployed). Goal: ship public/no-login household access to the shopping
kiosk via a custom mini-UI + scoped API gateway, both at
`shopping.bkia.com.au`.

---

## What stays vs. what changes

| Component | Phase 1 (now) | Phase 2 (this plan) |
|---|---|---|
| `api/proxy.ts` | Forwards everything, injects token on every request | **Forwards only allowlisted paths**, returns 403 on everything else |
| `vercel.json` rewrites | `/(.*) → /api/proxy` | `/api/* → /api/proxy`; `/` and `/icon.png` served as static |
| Static UI | None | New `public/index.html` + `public/icon.png` — custom 9-category kiosk |
| Auth model | Header injection (broken on SPA) | Custom UI uses `fetch` to our `/api/*` paths; gateway injects token server-side. SPA never enters the picture. |
| `HA_TOKEN` source | Admin token from `secrets/.env` | **Dedicated `kiosk` HA user** (non-admin), long-lived token from that user's profile |
| Public URL | `ha-shopping-proxy.vercel.app` | `shopping.bkia.com.au` (DNS migrated from GitHub Pages → Vercel) |

---

## File layout after refactor

```
ha-shopping-proxy/
├── api/
│   └── proxy.ts            ← API gateway, allowlist-filtered
├── public/
│   ├── index.html          ← custom kiosk UI (vanilla JS + CSS)
│   ├── icon.png            ← teal cart, 180x180 (copy from ../ha-shopping-wrapper/)
│   ├── icon.svg            ← source for icon.png
│   └── manifest.json       ← optional, for full PWA-mode polish
├── vercel.json             ← rewrites + headers config
├── package.json
├── README.md
└── PLAN.md (this file — delete after Phase 2 ships)
```

---

## Step-by-step

### 1. Create the dedicated `kiosk` HA user (~5 min)

User-side action (HA UI, not Claude):

1. HA → Settings → People → Users → Add user
2. Username: `kiosk`. Display name: `Kiosk (shared)`. Password: a long
   random string (we won't ever type it again).
3. **Administrator: OFF.**
4. Save.
5. Log out, log back in as `kiosk` (this is the only time we'll need
   the password).
6. Profile (bottom-left avatar) → Long-Lived Access Tokens → Create
   Token, name it `ha-shopping-proxy`. Copy the token immediately
   (HA shows it once).
7. Log out, log back in as the admin user.
8. (Optional) Settings → Dashboards → set per-dashboard visibility so
   `kiosk` only sees the shopping-list dashboard. Note: this is best-
   effort — kiosk can still construct other dashboard URLs by hand;
   the strong scope comes from non-admin role + the API gateway
   allowlist below.

Update Vercel env var `HA_TOKEN` to the new kiosk-user token (Settings
→ Environment Variables → edit `HA_TOKEN` → paste → Save → Redeploy).

### 2. Refactor `api/proxy.ts` as path-scoped gateway (~30 min)

Replace the current full-forward logic with an allowlist. Pseudocode:

```typescript
const ALLOWED = [
  // Read state of any todo.shopping_* entity
  /^\/api\/states\/todo\.shopping_[a-z_]+$/,
  // Read all states (UI's first load) — but filter the response
  // server-side to only return todo.shopping_* entities. (See note
  // below — easier to just NOT allow this and have UI fetch each
  // entity individually.)
  // Specific service calls
  /^\/api\/services\/todo\/get_items$/,
  /^\/api\/services\/todo\/add_item$/,
  /^\/api\/services\/todo\/update_item$/,
  /^\/api\/services\/todo\/remove_item$/,
];

function isAllowed(pathname: string, method: string): boolean {
  // Service POSTs only; state GETs only.
  // ...
}
```

If not allowed → return `403`. If allowed → forward with token
injected, same as before. Keep the existing strip-cookies / strip-host
hygiene.

**Subtle point:** `add_item`, `update_item`, `remove_item` accept any
`entity_id` in the JSON body. Need to also validate body — only allow
`entity_id` matching `^todo\.shopping_[a-z_]+$`. Otherwise a kiosk user
who knows our endpoint could add items to other todo lists, even non-
shopping ones. Probably fine for our threat model (it's the household)
but easy to add and worth doing.

### 3. Build the custom UI (~2 hrs)

Single `public/index.html`. Layout mirrors current HA dashboard:

- Header: "Shopping" title
- Inbox card: text input + "Add" button → `POST
  /api/services/todo/add_item` with `entity_id=todo.shopping_list,
  item=<text>`. The HA-side routing automation handles split +
  classification automatically. (No JS-side parsing needed; the
  multi-input feature already lives in `packages/shopping.yaml`.)
- 9 category cards (Produce, Bakery, Dairy, Meat & Seafood, Pantry,
  Frozen, Beverages, Household, Other), each with:
  - Title + emoji (mirror existing dashboard `CATEGORIES` config in
    `ha-shopping/scripts/push_shopping.py`)
  - List of items with tap-to-check-off interaction → `POST
    /api/services/todo/update_item` with `status=completed`
  - Hidden when empty (CSS `:empty` or JS toggle)
- Live updates: poll `GET /api/states/todo.shopping_<cat>` for each
  of the 9 + inbox every 3 seconds. Update DOM in place.
- Apple-touch-icon meta + standalone PWA mode (copy from current
  `ha-shopping-wrapper/index.html`).

Vanilla JS — no framework needed for this scope. ~200 lines of JS,
~100 lines of CSS, ~50 lines of HTML.

**Same-origin redirect from cart icon:** Because the wrapper landing
+ kiosk UI live at the same origin (shopping.bkia.com.au), tapping
the Home Screen icon → standalone mode → loads kiosk → no cross-origin
redirect → no Safari address-bar reveal. This fixes the lingering
"the URL bar shows nabu.casa after launch" caveat we flagged in the
GitHub Pages wrapper.

### 4. Migrate `shopping.bkia.com.au` from GH Pages → Vercel (~15 min)

**One DNS change + one Vercel config change:**

a. In Vercel project settings → Domains → Add `shopping.bkia.com.au`.
   Vercel will display the required DNS record (typically a CNAME to
   `cname.vercel-dns.com.`).

b. At partnerconsole.net → Manage `bkia.com.au` → Zone Manager →
   edit the existing `shopping` CNAME record. Change value from
   `shieldsb-hub.github.io.` to `cname.vercel-dns.com.` (or whatever
   Vercel specifies). Save.

c. Wait 5–30 min for propagation. Vercel auto-issues TLS cert.

d. In GH Pages settings (`shieldsb-hub/ha-shopping-wrapper`) → Pages →
   remove the custom domain entry. The repo can stay (kept as backup /
   reference) or be archived. Both are fine.

### 5. Verify on phone (~10 min)

1. Delete the existing teal-cart Home Screen icon (it points at the GH
   Pages version which now 404s on the dashboard path).
2. Safari → `https://shopping.bkia.com.au/` → should load the new
   custom UI directly (no SPA, no login, no nabu.casa URL).
3. Add to Home Screen → cart icon captured.
4. Tap icon → opens in standalone mode → custom UI loads → can add and
   check off items.
5. Test from a guest's phone (no HA app installed) — should "just
   work" without any login prompt.

---

## Open decisions to make in next session

1. **Poll interval.** 3s is responsive enough for shopping-trolley use.
   Could go 5s to be lighter. Pollable via env var.
2. **Body validation.** Should `entity_id` be strict-allowlisted to
   the 10 known entities (`todo.shopping_list` + 9 category lists)
   or just regex-matched on the prefix? Strict is safer.
3. **Rate limiting.** Probably skip for v1 — Vercel's free-tier
   defaults are fine for household traffic, and we're not exposed to
   the open internet's worst offenders.
4. **WebSocket.** Worth migrating to Cloudflare Workers for real-time
   updates? Probably not — polling at 3s is fine for a kiosk and
   avoids the NS-migration overhead.
5. **What to do with `ha-shopping-wrapper`.** After migration, the
   GitHub Pages site is dead. Options: archive the repo, or delete it.
   Archive preserves git history for the experiment that taught us
   how iOS captures icons.

---

## Time estimate (cold-start next session)

- Step 1 (kiosk user + token): 5 min
- Step 2 (proxy refactor + path filter): 30 min
- Step 3 (custom UI): 2 hrs (the bulk)
- Step 4 (DNS migration): 15 min + propagation wait
- Step 5 (phone verify): 10 min

**Total: ~3 hrs of focused work.** Plan to do it in two sessions if
needed: session A = 1 + 2 + 4 (~50 min, ships path-scoped gateway with
DNS already pointed); session B = 3 + 5 (~2 hrs, builds and verifies UI).
