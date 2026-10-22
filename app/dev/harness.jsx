// harness.jsx — the family app on canned HA responses, for screenshots
// and design work without touching the real lists. Served by `npm run dev`
// at /dev/harness.html; never part of the build (vite only bundles
// index.html).
//
//   ?busy=1      an order build in flight (and the sink syncing)
//   ?sheet=N     open the item sheet on the Nth "›" button (0-based)
//   &pick=N      ...and choose its Nth option
//   ?order=1     open the Order screen
//   ?empty=1     an empty list
//
// Every write answers {} and changes nothing, so taps are safe.

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import '../src/styles.css';

const q = new URLSearchParams(location.search);
const j = (o) => JSON.stringify(o);
let n = 0;
const it = (summary, desc, status = 'needs_action') => ({ uid: `u${n++}`, summary, status, description: desc ? j(desc) : undefined });

const LISTS = q.has('empty') ? {} : {
  'todo.shopping_produce': [
    it('Bananas', { ww: { state: 'in_cart', product: 'Cavendish Bananas', quantity: 6 } }),
    it('Baby spinach', { ww: { state: 'harris_farm', hf: { product: 'Baby Spinach 120g', price: 3.99, variant_id: '41', handle: 'baby-spinach' } } }),
    it('Coriander', { ww: { state: 'choose', note: 'Only the 2-pack at Woolworths', suggest: { product: 'Woolworths Coriander Bunch 2 Pack', price: '$5.00' } } }),
    it('Avocados'),
  ],
  'todo.shopping_dairy': [
    it('Milk', { ww: { state: 'in_cart', product: 'Dairy Farmers Full Cream Milk 3L', price: '$5.40' } }),
    it('Greek yoghurt', { ww: { state: 'in_cart', product: 'Chobani Plain Greek Yogurt 907g' } }),
  ],
  'todo.shopping_bakery': [
    it('Sourdough', { ww: { state: 'in_store' } }),
  ],
  'todo.shopping_pantry': [
    it('Olive oil', { ww: { state: 'in_cart', product: 'Cobram Estate Extra Virgin Olive Oil 750ml' } }),
    it('Arborio rice', { ww: { state: 'not_online' } }),
  ],
  'todo.shopping_household': [
    it('Dishwasher tablets', { ww: { state: 'in_cart', product: 'Finish Quantum Ultimate 46 pack' } }),
  ],
  'todo.shopping_other': [
    it('Eggs', { ww: { state: 'ordered', order: 'W1184' } }, 'completed'),
    it('Butter', null, 'completed'),
  ],
};

const STATUS = q.has('busy')
  ? { state: '22 Oct 06:42 syncing 9 items (r1)', last_updated: new Date(Date.now() - 30000).toISOString() }
  : { state: '22 Oct 06:43 ok: 5 in cart, 2 to choose, cart $64.20', last_updated: new Date(Date.now() - 600000).toISOString() };

const HF = [
  { title: 'Coriander Bunch', handle: 'coriander', price: '2.99' },
  { title: 'Coriander Roots On', handle: 'coriander-roots', price: '3.49' },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  const u = new URL(url, location.href);
  const ok = (body) => new Response(j(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (!u.pathname.startsWith('/api/')) return realFetch(url, opts);
  if (u.pathname === '/api/services/todo/get_items') {
    const eid = JSON.parse(opts.body).entity_id;
    return ok({ service_response: { [eid]: { items: LISTS[eid] || [] } } });
  }
  if (u.pathname === '/api/order/status') return ok(STATUS);
  if (u.pathname === '/api/harrisfarm/search') return ok({ resources: { results: { products: HF } } });
  if (u.pathname.startsWith('/api/harrisfarm/product/')) {
    const h = decodeURIComponent(u.pathname.split('/').pop());
    const p = HF.find((x) => x.handle === h) || HF[0];
    return ok({ product: { variants: [{ id: h.length * 7, price: p.price }] } });
  }
  if (u.pathname === '/api/sync') return new Promise(() => {});   // stays "Syncing…"
  return ok({});
};

createRoot(document.getElementById('root')).render(<App />);

// Scenes that need a tap: wait for the first render, then press.
const press = (sel, i = 0) => {
  const t = setInterval(() => {
    const els = document.querySelectorAll(sel);
    if (els.length > i) { clearInterval(t); els[i].click(); }
  }, 50);
};
if (q.has('sheet')) press('.item .more', Number(q.get('sheet')));
if (q.has('pick')) press('.opt', Number(q.get('pick')));
if (q.has('order')) press('.seeorder');
if (q.has('busy')) press('.iconbtn', 1);
