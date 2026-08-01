// Edge function: path-scoped API gateway.
//
// Two upstreams are proxied:
//   1. Home Assistant (Nabu Casa cloud URL) — for shopping list CRUD via
//      HA's REST API. Token-injected on every forwarded request so the
//      kiosk needs no HA login.
//   2. Harris Farm Markets (Shopify storefront) — for product search +
//      variant lookup so the "Order" feature can build a Shopify cart
//      permalink. Read-only, no auth, no token. Browsers can't call HF
//      directly because HF doesn't return CORS headers; routing via this
//      gateway makes the call same-origin.
//
// Required env vars (Vercel project settings, Production scope):
//   HA_URL    = https://wooaeilbttvus6etixtt2izabobprcoj.ui.nabu.casa
//   HA_TOKEN  = long-lived access token for the dedicated kiosk HA user
//
// Allowlist:
//   GET  /api/states/todo.shopping_<cat>             — read one list's state
//   POST /api/services/todo/get_items                — fetch items in a list
//   POST /api/services/todo/add_item                 — add to a list
//   POST /api/services/todo/update_item              — check/uncheck/edit
//   POST /api/services/todo/remove_item              — delete an item
//   POST /api/services/todo/remove_completed_items   — clear all completed
//   POST /api/sync                                    — press the unified
//        "sync all sources" input_button in HA (entity fixed server-side;
//        client body ignored). Fans out to every source (Paprika, Alexa,
//        future) HA-side. /api/paprika/sync is a legacy alias for the same
//        press, kept for cached PWA clients from before the rename.
//        BLOCKS until each source reports what its run did, up to ~9 s,
//        returning {ok, pending, sources:[{key,label,result,reported}]}.
//        Older cached clients ignore the extra fields and still see
//        {ok:true}, so the change is backwards-compatible.
//   GET  /api/harrisfarm/search?q=<term>             — HF product search
//   GET  /api/harrisfarm/product/<handle>            — HF product details
//
// HA service-call body validation: JSON object whose `entity_id` (root
// key) is a string matching ^todo\.shopping_[a-z_]+$. Arrays and the
// target/data shape are rejected — the custom UI only uses the simple
// form. `description`, `item`, `status`, `due` are forwarded as-is.
//
// vercel.json rewrites /api/(.*) → /api/proxy so this single function
// handles every /api/* path; static files in public/ are served as-is
// for everything else.

export const config = {
  runtime: 'edge',
};

const HA_ENTITY_RE = /^todo\.shopping_[a-z_]+$/;
const HA_STATE_PATH_RE = /^\/api\/states\/todo\.shopping_[a-z_]+$/;
const HA_SERVICE_PATH_RE = /^\/api\/services\/todo\/(get_items|add_item|update_item|remove_item|remove_completed_items)$/;

const HF_BASE = 'https://www.harrisfarm.com.au';
const HF_PRODUCT_PATH_RE = /^\/api\/harrisfarm\/product\/([a-z0-9-]+)$/;
// Limit how many search results we ask HF for. Cuts payload size and
// avoids leaking arbitrary query terms into HF's logs.
const HF_SEARCH_LIMIT = 10;

// The HA input_button pressed by /api/sync. Hard-coded on the server so the
// public client can never press any other button. This one button fans out
// to every source (Paprika, Alexa, future) HA-side, so new sources never
// touch this public surface.
const SYNC_ALL_BUTTON = 'input_button.shopping_sync_all';

// Where each source reports what its last run actually did. /api/sync
// presses the button and then WAITS for these to advance, so the kiosk can
// say "Paprika: 1 item, Alexa: nothing new" instead of nothing at all.
//
// Before this, /api/sync returned {ok:true} the instant the button was
// pressed — before either automation had run — so a sync that transferred
// nothing looked exactly like one that worked. On 2026-08-01 that cost a
// support round-trip: an item was still sitting unsynced on a phone, the
// kiosk button got pressed three times in 40 seconds, and the sync was
// reported broken while every layer was healthy.
//
// This is the one place the gateway knows individual sources, which does
// erode the "proxy never learns about sources" property the unified button
// was built for. Accepted deliberately (Ben, 2026-08-01): per-source
// reporting is the whole point — a combined line would say something ran
// and never which. A new source needs one entry here plus its HA-side
// automation; nothing else on this surface changes.
//
// NOTE: these are read server-side with the gateway's own token. No new
// client-readable route is opened — HA_STATE_PATH_RE still admits only
// todo.shopping_*, and the client sees just the two result strings.
const SYNC_SOURCES = [
  { key: 'paprika', label: 'Paprika',
    entity: 'input_text.paprika_sync_result' },
  { key: 'alexa', label: 'Alexa',
    entity: 'input_text.alexa_list_sync_result' },
];

// Typical run is 1.5-4 s (shell_command → external API → todo adds). The
// deadline is a ceiling, not an expectation: we return as soon as every
// source has reported.
const SYNC_POLL_MS = 350;
const SYNC_DEADLINE_MS = 9000;

type Decision =
  | { kind: 'ha-state' }
  | { kind: 'ha-service' }
  | { kind: 'sync' }
  | { kind: 'hf-search'; q: string }
  | { kind: 'hf-product'; handle: string }
  | null;

function classifyRequest(request: Request, url: URL): Decision {
  const { method } = request;
  const { pathname } = url;

  if (method === 'GET' && HA_STATE_PATH_RE.test(pathname)) {
    return { kind: 'ha-state' };
  }
  if (method === 'POST' && HA_SERVICE_PATH_RE.test(pathname)) {
    return { kind: 'ha-service' };
  }
  if (method === 'POST' && (pathname === '/api/sync' ||
                            pathname === '/api/paprika/sync')) {
    return { kind: 'sync' };
  }
  if (method === 'GET' && pathname === '/api/harrisfarm/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || q.length > 100) return null;
    return { kind: 'hf-search', q };
  }
  const productMatch = method === 'GET' ? pathname.match(HF_PRODUCT_PATH_RE) : null;
  if (productMatch) {
    return { kind: 'hf-product', handle: productMatch[1] };
  }
  return null;
}

async function readAndValidateServiceBody(
  request: Request,
): Promise<{ ok: true; body: ArrayBuffer } | { ok: false; reason: string }> {
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) {
    return { ok: false, reason: 'empty body' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'body must be a JSON object' };
  }
  const eid = (parsed as Record<string, unknown>).entity_id;
  if (typeof eid !== 'string') {
    return { ok: false, reason: 'entity_id must be a string' };
  }
  if (!HA_ENTITY_RE.test(eid)) {
    return { ok: false, reason: 'entity_id must match todo.shopping_*' };
  }
  return { ok: true, body: buf };
}

type SourceReading = { state: string; lastUpdated: string } | null;

async function readSyncSource(
  base: string,
  token: string,
  entity: string,
): Promise<SourceReading> {
  const r = await fetch(`${base}/api/states/${entity}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || typeof j.state !== 'string') return null;
  return { state: j.state, lastUpdated: String(j.last_updated || '') };
}

// Press, then wait for each source to report. Per source, never collapsed
// into one verdict: one source failing while the other worked is exactly
// what the caller needs to see. A source that never reports comes back
// reported:false rather than being guessed at — the automation is
// mode:single/max_exceeded:silent, so a press landing while its 15-min
// poll is mid-run is legitimately dropped and must not be shown as "0".
//
// The advance test is on last_updated, which works only because each
// result value carries the clock to seconds: two runs with the same
// outcome would otherwise write an identical string and HA would record
// no state change at all (see packages/shopping_paprika.yaml in
// ha-shopping).
async function pressSyncAndAwaitSources(
  base: string,
  token: string,
): Promise<Response> {
  const baselines = await Promise.all(
    SYNC_SOURCES.map((s) => readSyncSource(base, token, s.entity)),
  );

  const upstream = await fetch(`${base}/api/services/input_button/press`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ entity_id: SYNC_ALL_BUTTON }),
  });
  if (!upstream.ok) {
    return new Response(JSON.stringify({ ok: false, pending: false, sources: [] }), {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const sources = SYNC_SOURCES.map((s) => ({
    key: s.key, label: s.label, result: null as string | null, reported: false,
  }));
  const seen = baselines.map((b) => (b ? b.lastUpdated : ''));

  const deadline = Date.now() + SYNC_DEADLINE_MS;
  while (Date.now() < deadline && sources.some((s) => !s.reported)) {
    await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
    await Promise.all(SYNC_SOURCES.map(async (src, i) => {
      if (sources[i].reported) return;
      const now = await readSyncSource(base, token, src.entity);
      if (now && now.lastUpdated !== seen[i]) {
        sources[i].result = now.state;
        sources[i].reported = true;
      }
    }));
  }

  return new Response(
    JSON.stringify({
      ok: true,
      pending: sources.some((s) => !s.reported),
      sources,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

async function forwardToHA(
  request: Request,
  url: URL,
  body: ArrayBuffer | null,
  haUrl: string,
  haToken: string,
): Promise<Response> {
  const target = haUrl.replace(/\/$/, '') + url.pathname + url.search;
  const upstreamHeaders = new Headers();
  const ctype = request.headers.get('content-type');
  if (ctype) upstreamHeaders.set('content-type', ctype);
  const accept = request.headers.get('accept');
  if (accept) upstreamHeaders.set('accept', accept);
  upstreamHeaders.set('authorization', `Bearer ${haToken}`);

  const upstream = await fetch(target, {
    method: request.method,
    headers: upstreamHeaders,
    body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  const upCtype = upstream.headers.get('content-type');
  if (upCtype) responseHeaders.set('content-type', upCtype);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function forwardToHarrisFarm(target: string): Promise<Response> {
  const upstream = await fetch(target, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'follow',
  });

  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  // Browser won't actually need CORS since this is same-origin from
  // the kiosk's perspective, but cache hints help a tiny bit.
  responseHeaders.set('cache-control', 'public, max-age=300');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export default async function handler(request: Request): Promise<Response> {
  const haUrl = process.env.HA_URL;
  const haToken = process.env.HA_TOKEN;
  if (!haUrl || !haToken) {
    return new Response('proxy misconfigured: HA_URL or HA_TOKEN missing', {
      status: 500,
    });
  }

  const url = new URL(request.url);
  const decision = classifyRequest(request, url);
  if (!decision) {
    return new Response('not found', { status: 404 });
  }

  if (decision.kind === 'ha-state') {
    return forwardToHA(request, url, null, haUrl, haToken);
  }
  if (decision.kind === 'ha-service') {
    const v = await readAndValidateServiceBody(request);
    if (!v.ok) {
      return new Response(`forbidden: ${v.reason}`, { status: 403 });
    }
    return forwardToHA(request, url, v.body, haUrl, haToken);
  }
  if (decision.kind === 'sync') {
    return pressSyncAndAwaitSources(haUrl.replace(/\/$/, ''), haToken);
  }
  if (decision.kind === 'hf-search') {
    const target = `${HF_BASE}/search/suggest.json?q=${encodeURIComponent(decision.q)}&resources%5Btype%5D=product&resources%5Blimit%5D=${HF_SEARCH_LIMIT}`;
    return forwardToHarrisFarm(target);
  }
  if (decision.kind === 'hf-product') {
    const target = `${HF_BASE}/products/${decision.handle}.json`;
    return forwardToHarrisFarm(target);
  }
  return new Response('not found', { status: 404 });
}
