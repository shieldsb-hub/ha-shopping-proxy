// Edge function: transparent proxy to Home Assistant with token injection.
//
// Every incoming request is forwarded to the HA Nabu Casa URL, with an
// Authorization: Bearer <HA_TOKEN> header injected so the user (anyone
// with the proxy URL) is silently logged in as the dedicated kiosk HA
// user. The kiosk user's HA-side permissions are what scope what's
// reachable — the proxy itself is intentionally transparent.
//
// Deploy notes:
//   - Vercel project env vars (Production scope):
//       HA_URL    = https://wooaeilbttvus6etixtt2izabobprcoj.ui.nabu.casa
//       HA_TOKEN  = <long-lived access token for the kiosk HA user>
//   - vercel.json rewrites '/(.*)' to '/api/proxy', so this single function
//     handles every path. The original path is preserved on `request.url`.
//
// Known limitations:
//   - WebSockets (HA's /api/websocket) do NOT proxy through Vercel Edge
//     Functions. The frontend will show "connection lost" but the dashboard
//     still renders via REST. Live updates require manual refresh until we
//     migrate to a host that supports WS proxying (e.g. Cloudflare Workers).
//   - Set-Cookie headers from HA are stripped — we don't want HA session
//     cookies on the proxy domain (we're using bearer-token injection
//     instead). If HA's frontend tries to set CSRF/session cookies, they
//     won't persist; we re-inject the token on every request.

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request): Promise<Response> {
  const haUrl = process.env.HA_URL;
  const haToken = process.env.HA_TOKEN;
  if (!haUrl || !haToken) {
    return new Response('proxy misconfigured: HA_URL or HA_TOKEN missing', {
      status: 500,
    });
  }

  const incoming = new URL(request.url);
  const target = haUrl.replace(/\/$/, '') + incoming.pathname + incoming.search;

  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${haToken}`);
  // Don't forward host-header sniffing or Vercel-internal markers.
  headers.delete('host');
  headers.delete('x-forwarded-host');
  headers.delete('x-vercel-id');
  headers.delete('x-vercel-deployment-url');
  headers.delete('x-vercel-forwarded-for');
  // Don't forward client cookies — we're using injected bearer auth, and
  // forwarding stale cookies confuses HA's session layer.
  headers.delete('cookie');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(target, init);

  const respHeaders = new Headers(upstream.headers);
  // fetch decoded the body for us; let the platform recompute these.
  respHeaders.delete('content-encoding');
  respHeaders.delete('content-length');
  // Don't let HA set cookies on the proxy domain (would break our
  // bearer-token model and could leak across requests).
  respHeaders.delete('set-cookie');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
