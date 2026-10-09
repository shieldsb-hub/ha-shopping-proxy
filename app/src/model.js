// What each list item means for the order, read from its HA description.
//
// The description is JSON when anything has touched it:
//   ordered / ordered_at / variant_id   Harris Farm cart opened (the original
//                                       app's tag; HA ticks it off after 24 h)
//   ww                                  the Woolworths order engine's state
//                                       (satellite/woolies_run.py in ha-shopping)
// Plain-text descriptions are kept under "note" when written back.

export function parseDesc(desc) {
  if (desc && desc.trim().startsWith('{')) {
    try {
      const d = JSON.parse(desc);
      if (d && typeof d === 'object' && !Array.isArray(d)) return d;
    } catch { /* fall through */ }
  }
  return desc ? { note: desc } : {};
}

export const writeDesc = (d) => JSON.stringify(d);

// dest: ww | hf | decide | store | none   (amber is reserved for decide)
export function itemView(item) {
  const d = parseDesc(item.description);
  const ww = d.ww && typeof d.ww === 'object' ? d.ww : {};
  const base = { desc: d, ww };

  if (item.status === 'completed') {
    if (ww.state === 'ordered') {
      return { ...base, dest: 'done', line: `Ordered · Woolworths${ww.order ? ` #${ww.order}` : ''}` };
    }
    return { ...base, dest: 'done', line: d.ordered ? `Ordered · ${d.ordered}` : 'Ticked' };
  }
  if (d.ordered) {
    return { ...base, dest: 'hf', tag: 'Harris Farm', line: 'In the Harris Farm cart', hfOrdered: true };
  }
  switch (ww.state) {
    case 'in_cart': {
      const q = ww.quantity && ww.quantity > 1 ? ` × ${ww.quantity}` : '';
      return { ...base, dest: 'ww', tag: 'Woolworths', line: `${ww.product || 'In the cart'}${q}`, note: ww.note };
    }
    case 'choose':
      return { ...base, dest: 'decide', tag: 'Decide', line: ww.note || 'Not quite available at Woolworths' };
    case 'not_online':
      return { ...base, dest: 'decide', tag: 'Decide', line: ww.note || 'Not sold online at Woolworths' };
    case 'failed':
      return { ...base, dest: 'decide', tag: 'Decide', line: ww.note || "Woolworths couldn't add this" };
    case 'harris_farm':
      return { ...base, dest: 'hf', tag: 'Harris Farm',
               line: ww.hf?.product ? `${ww.hf.product}${ww.hf.price ? ` · $${Number(ww.hf.price).toFixed(2)}` : ''}` : 'From Harris Farm' };
    case 'in_store':
    case 'declined':
      return { ...base, dest: 'store', tag: 'In store', line: 'Buy at the shops' };
    case 'skipped':
      return { ...base, dest: 'store', tag: 'In store', line: 'Taken out of the Woolworths cart by hand' };
    default:
      return { ...base, dest: 'none', line: '' };
  }
}

export function counts(lists) {
  const c = { ww: 0, hf: 0, hfToSend: 0, decide: 0, store: 0, none: 0, open: 0 };
  for (const items of Object.values(lists)) {
    for (const it of items) {
      if (it.status === 'completed') continue;
      c.open += 1;
      const v = itemView(it);
      c[v.dest] += 1;
      if (v.dest === 'hf' && !v.hfOrdered) c.hfToSend += 1;
    }
  }
  return c;
}

// The order status line (input_text.woolworths_cart_status) is written by HA:
//   "10 Oct 06:42 syncing 2 items (run_id)"          build running
//   "10 Oct 06:43 ok: 1 in cart, 1 to choose, cart $11.87"
//   "... order W123 placed: 3 ticked off, 1 left for the shop"
//   "... sync not started: <why>" / "... needs_code: ..." / "... error: ..."
// Internal wording says "sync"; the family only ever sees "order".
export function readStatus(s) {
  const state = s?.state || '';
  const updated = s?.last_updated ? new Date(s.last_updated) : null;
  const ageMin = updated ? (Date.now() - updated.getTime()) / 60000 : Infinity;
  const m = state.match(/^(\d{1,2} \w{3} \d{2}:\d{2})\s+(.*)$/);
  const when = m ? m[1].split(' ').pop() : '';
  const body = m ? m[2] : state;
  const running = /^syncing \d+ items/.test(body) && ageMin < 40;
  const subtotal = (body.match(/cart (\$[\d.,]+)/) || [])[1] || '';
  let problem = '';
  if (/not started|needs_code|login_failed|blocked|error/.test(body)) {
    problem = /needs_code/.test(body) ? 'Woolworths wants a verification code; Ben has been told.'
      : /a sync is already running/.test(body) ? 'An order is already being built.'
      : /not started/.test(body) ? "The order couldn't start. Try again in a minute."
      : 'The last order build hit a problem; Ben has been told.';
  }
  const placed = (body.match(/order (\S+) placed/) || [])[1] || '';
  return { raw: state, when, running, subtotal, problem, placed, updated, ageMin };
}
