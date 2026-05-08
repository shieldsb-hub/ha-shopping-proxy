// Edge function: path-scoped API gateway to Home Assistant.
//
// Phase 2 of ha-shopping-proxy. Replaces the Phase 1 transparent proxy
// (which couldn't auth HA's SPA — see PLAN.md / project memories).
//
// This gateway only allows the specific HA REST endpoints the custom
// kiosk UI needs, and only for entity_ids matching todo.shopping_*.
// Every allowed request is forwarded to the Nabu Casa URL with
// Authorization: Bearer <HA_TOKEN> injected. Everything else → 404.
//
// Required env vars (set in Vercel project settings, Production scope):
//   HA_URL    = https://wooaeilbttvus6etixtt2izabobprcoj.ui.nabu.casa
//   HA_TOKEN  = long-lived access token, ideally for the dedicated
//               kiosk HA user (non-admin, scoped to shopping lists)
//
// Allowlist:
//   GET  /api/states/todo.shopping_<cat>           — read one list's state
//   POST /api/services/todo/get_items              — fetch items in a list
//   POST /api/services/todo/add_item               — add to a list
//   POST /api/services/todo/update_item            — check/uncheck/edit
//   POST /api/services/todo/remove_item            — delete an item
//   POST /api/services/todo/remove_completed_items — clear all completed
//
// Body validation: every POST body must JSON-parse to an object whose
// `entity_id` (root key) is a string matching ^todo\.shopping_[a-z_]+$.
// Arrays of entity_ids and the target/data shape are rejected — the
// custom UI only uses the simple form.
//
// vercel.json rewrites /api/(.*) → /api/proxy so this single function
// handles every /api/* path; static files in public/ are served as-is
// for everything else (no rewrite catches them).

export const config = {
  runtime: 'edge',
};

const ENTITY_RE = /^todo\.shopping_[a-z_]+$/;

const STATE_PATH_RE = /^\/api\/states\/todo\.shopping_[a-z_]+$/;
const SERVICE_PATH_RE = /^\/api\/services\/todo\/(get_items|add_item|update_item|remove_item|remove_completed_items)$/;

type AllowDecision =
  | { kind: 'state' }
  | { kind: 'service' }
  | null;

function classifyRequest(method: string, pathname: string): AllowDecision {
  if (method === 'GET' && STATE_PATH_RE.test(pathname)) {
    return { kind: 'state' };
  }
  if (method === 'POST' && SERVICE_PATH_RE.test(pathname)) {
    return { kind: 'service' };
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
  if (!ENTITY_RE.test(eid)) {
    return { ok: false, reason: 'entity_id must match todo.shopping_*' };
  }
  return { ok: true, body: buf };
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
  const decision = classifyRequest(request.method, url.pathname);
  if (!decision) {
    return new Response('not found', { status: 404 });
  }

  let body: ArrayBuffer | null = null;
  if (decision.kind === 'service') {
    const v = await readAndValidateServiceBody(request);
    if (!v.ok) {
      return new Response(`forbidden: ${v.reason}`, { status: 403 });
    }
    body = v.body;
  }

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
  // Don't forward Set-Cookie (we're token-injecting, not session-based)
  // or content-encoding (fetch already decoded the body).

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
