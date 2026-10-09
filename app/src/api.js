// Everything goes through the gateway in api/proxy.ts, which injects the HA
// token and admits only the shopping lists, the kitchen-sink sync, the
// Woolworths order script and its status line, and Harris Farm search.

export const CATEGORIES = [
  ['todo.shopping_produce', 'Produce'],
  ['todo.shopping_bakery', 'Bakery'],
  ['todo.shopping_dairy', 'Dairy'],
  ['todo.shopping_meat_seafood', 'Meat & Seafood'],
  ['todo.shopping_pantry', 'Pantry'],
  ['todo.shopping_frozen', 'Frozen'],
  ['todo.shopping_beverages', 'Beverages'],
  ['todo.shopping_household', 'Household'],
  ['todo.shopping_other', 'Other'],
];

async function call(path, opts) {
  const r = await fetch(path, opts || {});
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${r.status} ${text.slice(0, 100)}`);
  }
  return r.json().catch(() => null);
}

const post = (path, body) => call(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Open and ticked items per list, one call each. A failed list keeps its
// last good contents rather than flashing empty.
export async function fetchLists(previous) {
  const pairs = await Promise.all(CATEGORIES.map(async ([entityId]) => {
    try {
      const r = await post('/api/services/todo/get_items?return_response=true',
        { entity_id: entityId, status: ['needs_action', 'completed'] });
      return [entityId, r?.service_response?.[entityId]?.items || []];
    } catch (e) {
      console.warn(`fetch ${entityId} failed`, e);
      return [entityId, previous?.[entityId] || []];
    }
  }));
  return Object.fromEntries(pairs);
}

export const addItem = (text) =>
  post('/api/services/todo/add_item', { entity_id: 'todo.shopping_list', item: text });

export const setStatus = (entityId, uid, status) =>
  post('/api/services/todo/update_item', { entity_id: entityId, item: uid, status });

export const setDescription = (entityId, uid, description) =>
  post('/api/services/todo/update_item', { entity_id: entityId, item: uid, description });

export const removeItem = (entityId, uid) =>
  post('/api/services/todo/remove_item', { entity_id: entityId, item: uid });

export const syncSources = () => call('/api/sync', { method: 'POST' });

export const startOrder = () => call('/api/order', { method: 'POST' });

export const orderStatus = () => call('/api/order/status');

// Harris Farm: search returns products in relevance order; each product's
// first variant carries the price and the id the cart permalink needs.
export async function harrisFarmCandidates(name, limit = 4) {
  let data;
  try {
    data = await call(`/api/harrisfarm/search?q=${encodeURIComponent(name.trim())}`);
  } catch (e) {
    console.warn('HF search failed for', name, e);
    return [];
  }
  // HF's search is loose ("watercress" also returns watermelon), so keep only
  // products whose title has a word starting with one of the item's words.
  const words = (name.toLowerCase().match(/[a-z]{3,}/g) || []);
  const relevant = (title) => {
    const t = title.toLowerCase();
    return words.some((w) => new RegExp(`\\b${w.replace(/s$/, '')}`).test(t));
  };
  const products = (data?.resources?.results?.products || [])
    .filter((p) => p.available !== false && relevant(p.title || ''));
  const top = products.slice(0, limit);
  const details = await Promise.all(top.map(async (p) => {
    try {
      const d = await call(`/api/harrisfarm/product/${encodeURIComponent(p.handle)}`);
      const v = (d?.product?.variants || [])[0];
      if (!v) return null;
      return { product: p.title, handle: p.handle, variant_id: String(v.id),
               price: parseFloat(v.price || p.price || '0') };
    } catch {
      return null;
    }
  }));
  return details.filter(Boolean);
}

export const HF_CART_BASE = 'https://www.harrisfarm.com.au/cart/';
export const WOOLWORTHS_CART = 'https://www.woolworths.com.au/shop/cart';
