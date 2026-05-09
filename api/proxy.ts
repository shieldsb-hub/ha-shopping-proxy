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

type Decision =
  | { kind: 'ha-state' }
  | { kind: 'ha-service' }
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
