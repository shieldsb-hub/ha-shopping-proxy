import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES, fetchLists, addItem, setStatus, setDescription, removeItem,
  syncSources, startOrder, orderStatus, harrisFarmCandidates,
  HF_CART_BASE, WOOLWORTHS_CART,
} from './api.js';
import { itemView, counts, readStatus, writeDesc } from './model.js';

const POLL_MS = 3000;
const TAG_CLASS = { ww: 't-ww', hf: 't-hf', decide: 't-decide', store: 't-store' };
const hfPrefKey = (name) => 'hf_pref_' + name.toLowerCase().trim();   // shared with the original app

// The original app's kitchen sink: "everything but the kitchen sink", i.e.
// pull from every source (Alexa, Paprika) at once.
const SinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12h20" /><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    <path d="M11 12V6a3 3 0 0 1 6 0v1.5" /><path d="M5.5 9h3" /><path d="M7 9v3" />
  </svg>
);

function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((msg, error = false, ms = 2600) => {
    setToast({ msg, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), ms);
  }, []);
  return [toast, show];
}

export default function App() {
  const [lists, setLists] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(() => new Set());
  const [sheet, setSheet] = useState(null);          // { entityId, uid }
  const [view, setView] = useState('list');
  const [status, setStatusLine] = useState(readStatus(null));
  const [syncBusy, setSyncBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [toast, showToast] = useToast();
  const listsRef = useRef({});

  const refresh = useCallback(async () => {
    const next = await fetchLists(listsRef.current);
    listsRef.current = next;
    setLists(next);
    setLoaded(true);
  }, []);

  const refreshStatus = useCallback(async () => {
    try { setStatusLine(readStatus(await orderStatus())); } catch { /* keep last */ }
  }, []);

  // List polling while visible, as the original app did.
  useEffect(() => {
    let timer = null;
    const start = () => { if (!timer) timer = setInterval(refresh, POLL_MS); };
    const stop = () => { clearInterval(timer); timer = null; };
    const onVis = () => (document.hidden ? stop() : (refresh(), refreshStatus(), start()));
    refresh().then(start);
    refreshStatus();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh, refreshStatus]);

  // Order status: every 4 s while a build runs, otherwise every 30 s.
  const busy = status.running || starting;
  useEffect(() => {
    const t = setInterval(refreshStatus, busy ? 4000 : 30000);
    return () => clearInterval(t);
  }, [busy, refreshStatus]);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (status.running) setStarting(false);
    if (wasRunning.current && !status.running) {
      refresh();
      showToast(status.problem || 'Order built. Check it in the Woolworths app.', !!status.problem, 4000);
    }
    wasRunning.current = status.running;
  }, [status.running]);   // eslint-disable-line react-hooks/exhaustive-deps

  const c = useMemo(() => counts(lists), [lists]);
  const findItem = (s) => s && (lists[s.entityId] || []).find((i) => i.uid === s.uid);

  async function toggle(entityId, item) {
    if (checking.has(item.uid)) return;
    const next = item.status === 'completed' ? 'needs_action' : 'completed';
    setChecking((s) => new Set(s).add(item.uid));
    try {
      await setStatus(entityId, item.uid, next);
      setTimeout(async () => {
        await refresh();
        setChecking((s) => { const n = new Set(s); n.delete(item.uid); return n; });
      }, 300);
    } catch (e) {
      console.error(e);
      setChecking((s) => { const n = new Set(s); n.delete(item.uid); return n; });
      showToast(next === 'completed' ? "Couldn't tick that off" : "Couldn't put that back", true);
    }
  }

  async function onSync() {
    setSyncBusy(true);
    showToast('Syncing lists…');
    try {
      const res = await syncSources();
      const sources = res?.sources || [];
      showToast(sources.length
        ? sources.map((s) => `${s.label}: ${s.reported ? String(s.result).replace(/\s+at \d{2}:\d{2}:\d{2}$/, '') : 'still running'}`).join(' · ')
        : 'Sync started', false, 4000);
      refresh();
      setTimeout(refresh, 2000);
    } catch (e) {
      console.error(e);
      showToast('Sync failed', true);
    } finally {
      setSyncBusy(false);
    }
  }

  async function onOrder() {
    if (busy) return;
    setStarting(true);
    try {
      await startOrder();
      showToast('Building your Woolworths order. This takes a minute or two.', false, 4000);
      setTimeout(refreshStatus, 2500);
      setTimeout(() => setStarting(false), 20000);
    } catch (e) {
      console.error(e);
      setStarting(false);
      showToast("The order couldn't start", true);
    }
  }

  const sheetItem = findItem(sheet);

  return (
    <>
      {view === 'list' ? (
        <ListView
          lists={lists} loaded={loaded} c={c} status={status} busy={busy}
          checking={checking} syncBusy={syncBusy}
          onSync={onSync} onOrder={onOrder} onToggle={toggle}
          onOpen={(entityId, uid) => setSheet({ entityId, uid })}
          onShowOrder={() => setView('order')}
          onAdd={async (text) => {
            try {
              await addItem(text);
              setTimeout(refresh, 500);
              setTimeout(refresh, 2000);
              return true;
            } catch (e) {
              console.error(e);
              showToast("Couldn't add that", true);
              return false;
            }
          }}
        />
      ) : (
        <OrderView
          lists={lists} status={status} busy={busy} onOrder={onOrder}
          onBack={() => setView('list')} refresh={refresh} showToast={showToast}
          onOpen={(entityId, uid) => setSheet({ entityId, uid })}
        />
      )}
      {sheetItem && (
        <ItemSheet
          entityId={sheet.entityId} item={sheetItem}
          onClose={() => setSheet(null)} refresh={refresh} showToast={showToast}
        />
      )}
      {toast && <div className={`toast${toast.error ? ' error' : ''}`}>{toast.msg}</div>}
    </>
  );
}

// ─── list ───────────────────────────────────────────────────────────────

function OrderCard({ c, status, busy, onOrder, onShowOrder }) {
  const label = busy ? 'Building the Woolworths order · a minute or two'
    : status.placed ? `Order ${status.placed} placed${status.when ? ` · ${status.when}` : ''}`
    : status.when ? `Order built ${status.when}${status.subtotal ? ` · ${status.subtotal}` : ''}`
    : 'Not ordered yet';
  return (
    <div className="card ordercard">
      <div className="row">
        <span className="eyebrow">{label}</span>
        <button className="pill solid" disabled={busy || c.open === 0} onClick={onOrder}>
          {busy ? 'Ordering…' : status.when ? 'Update order' : 'Order'}
        </button>
      </div>
      {busy && <div className="progress"><i /></div>}
      {!busy && status.problem && <div className="problem">{status.problem}</div>}
      <div className="stats" onClick={onShowOrder} role="button" aria-label="See the order">
        <div className="stat"><div className="n">{c.ww}</div><div className="eyebrow l">Woolworths</div></div>
        <div className="stat"><div className="n">{c.hf}</div><div className="eyebrow l">Harris Farm</div></div>
        <div className={`stat${c.decide ? ' decide' : ''}`}><div className="n">{c.decide}</div><div className="eyebrow l">To decide</div></div>
        <div className="stat"><div className="n">{c.store}</div><div className="eyebrow l">In store</div></div>
      </div>
    </div>
  );
}

function ItemRow({ entityId, item, checking, onToggle, onOpen }) {
  const v = itemView(item);
  const done = item.status === 'completed';
  const cls = ['item', done && 'done', checking && 'checking', v.dest === 'decide' && 'decide'].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <button className="tap" onClick={() => onToggle(entityId, item)} aria-label={done ? `Put back ${item.summary}` : `Tick off ${item.summary}`}>
        <span className={`check${done ? ' done' : ''}`}>{done || checking ? '✓' : ''}</span>
        <span className="body">
          <span className="name">{item.summary}</span>
          {(v.tag || v.line) && (
            <span className="sub">
              {v.tag && <span className={`tag ${TAG_CLASS[v.dest]}`}>{v.tag}</span>}
              {v.line && <span>{v.line}</span>}
            </span>
          )}
        </span>
      </button>
      {!done && <button className="more" onClick={() => onOpen(entityId, item.uid)} aria-label={`Details for ${item.summary}`}>›</button>}
    </div>
  );
}

function ListView({ lists, loaded, c, status, busy, checking, syncBusy, onSync, onOrder, onToggle, onOpen, onShowOrder, onAdd }) {
  const [text, setText] = useState('');
  const ticked = CATEGORIES.flatMap(([eid]) => (lists[eid] || []).filter((i) => i.status === 'completed').map((i) => [eid, i]));
  async function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    if (!(await onAdd(t))) setText(t);
  }
  return (
    <div className="app">
      <div className="top">
        <h1>Shopping</h1>
        <div className="right">
          <span className="count">{c.open} {c.open === 1 ? 'item' : 'items'}</span>
          <button className={`iconbtn${syncBusy ? ' busy' : ''}`} onClick={onSync} disabled={syncBusy} aria-label="Sync lists from Alexa and Paprika" title="Sync lists from Alexa and Paprika"><SinkIcon /></button>
        </div>
      </div>

      <OrderCard c={c} status={status} busy={busy} onOrder={onOrder} onShowOrder={onShowOrder} />

      {loaded && c.open === 0 && ticked.length === 0 && <div className="empty">Nothing on the list</div>}

      {CATEGORIES.map(([entityId, name]) => {
        const items = (lists[entityId] || []).filter((i) => i.status !== 'completed');
        if (!items.length) return null;
        return (
          <section key={entityId}>
            <div className="aisle"><span className="eyebrow">{name}</span><span className="eyebrow">{items.length}</span></div>
            <div className="card items">
              {items.map((i) => <ItemRow key={i.uid} entityId={entityId} item={i} checking={checking.has(i.uid)} onToggle={onToggle} onOpen={onOpen} />)}
            </div>
          </section>
        );
      })}

      {ticked.length > 0 && (
        <section>
          <div className="aisle"><span className="eyebrow">Ticked · tap to put back</span><span className="eyebrow">{ticked.length}</span></div>
          <div className="card items">
            {ticked.map(([eid, i]) => <ItemRow key={i.uid} entityId={eid} item={i} checking={checking.has(i.uid)} onToggle={onToggle} onOpen={onOpen} />)}
          </div>
        </section>
      )}

      <div className="trial"><a className="eyebrow" href="/classic/">Classic app</a></div>

      <form className="addbar" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item…" enterKeyHint="done" autoCapitalize="sentences" />
        <button className="go" type="submit" aria-label="Add">+</button>
      </form>
    </div>
  );
}

// ─── item sheet ─────────────────────────────────────────────────────────

function ItemSheet({ entityId, item, onClose, refresh, showToast }) {
  const v = itemView(item);
  const ww = v.ww;
  const aisle = (CATEGORIES.find(([e]) => e === entityId) || [])[1] || '';
  const [hf, setHf] = useState(null);
  const [choice, setChoice] = useState(() => (
    v.dest === 'hf' && ww.hf ? `hf:${ww.hf.variant_id}` : v.dest === 'store' ? 'store' : v.dest === 'ww' ? 'ww' : ''
  ));
  const [remember, setRemember] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    harrisFarmCandidates(item.summary).then((r) => { if (alive) setHf(r); });
    return () => { alive = false; };
  }, [item.summary]);

  const current = v.dest === 'hf' && ww.hf ? `hf:${ww.hf.variant_id}` : v.dest === 'store' ? 'store' : v.dest === 'ww' ? 'ww' : '';
  const hfPick = choice.startsWith('hf:') ? (hf || []).find((h) => `hf:${h.variant_id}` === choice) || (ww.hf && `hf:${ww.hf.variant_id}` === choice ? ww.hf : null) : null;

  async function save(newWw, msg, extra = {}) {
    setSaving(true);
    try {
      const d = { ...v.desc, ...extra, ww: newWw };
      if (extra.dropOrdered) { delete d.ordered; delete d.ordered_at; delete d.variant_id; delete d.dropOrdered; }
      await setDescription(entityId, item.uid, writeDesc(d));
      showToast(msg, false, 3200);
      onClose();
      setTimeout(refresh, 300);
    } catch (e) {
      console.error(e);
      showToast("Couldn't save that", true);
      setSaving(false);
    }
  }

  function apply() {
    if (choice === 'ww_suggest') {
      return save({ ...ww, decision: 'use_suggestion' }, 'Woolworths will add it on the next order');
    }
    if (choice === 'ww') {
      return save({ decision: 'route_ww' }, 'Back to Woolworths on the next order', { dropOrdered: true });
    }
    if (choice === 'store') {
      return save({ state: 'in_store', route: 'store', decision: 'in_store', remember },
        remember ? `${item.summary} will always stay on the list for the shops` : 'Left on the list for the shops');
    }
    if (hfPick) {
      try { localStorage.setItem(hfPrefKey(item.summary), hfPick.variant_id); } catch { /* private mode */ }
      return save({ state: 'harris_farm', route: 'hf', decision: 'route_hf', remember,
                    hf: { product: hfPick.product, variant_id: hfPick.variant_id, price: hfPick.price, handle: hfPick.handle } },
        remember ? `${item.summary} will always come from Harris Farm` : 'Added to the Harris Farm basket');
    }
    return null;
  }

  async function onRemove() {
    setSaving(true);
    try {
      await removeItem(entityId, item.uid);
      showToast(`Removed ${item.summary}`);
      onClose();
      setTimeout(refresh, 300);
    } catch (e) {
      console.error(e);
      showToast("Couldn't remove that", true);
      setSaving(false);
    }
  }

  const buttonLabel = choice === 'ww_suggest' ? 'Use this at Woolworths'
    : choice === 'ww' ? (current === 'ww' ? 'Keep at Woolworths' : 'Get it from Woolworths')
    : choice === 'store' ? 'Buy it in store'
    : hfPick ? 'Use Harris Farm' : 'Choose an option';
  const unchanged = choice === current && !remember;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={item.summary}>
        <div className="grab" />
        <div className="eyebrow">{aisle}{v.tag ? ` · ${v.tag}` : ''}</div>
        <h2>{item.summary}</h2>
        {v.line && <div className="why">{v.dest === 'ww' && ww.note ? ww.note : v.line}</div>}

        <div className="section eyebrow">Woolworths</div>
        {v.dest === 'ww' && (
          <>
            <button className={`card opt${choice === 'ww' ? ' sel' : ''}`} onClick={() => setChoice('ww')}>
              <span className="body"><span className="p">{ww.product}</span>
                <span className="m"><span className="tag t-ww">In the cart</span>{ww.price && <span>{ww.price}</span>}</span></span>
            </button>
            <div className="links" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
              <button onClick={() => save({ ...ww, decision: 'reject' }, 'The next order will swap it for something else')} disabled={saving}>Not this one</button>
            </div>
          </>
        )}
        {ww.suggest && v.dest === 'decide' && (
          <button className={`card opt${choice === 'ww_suggest' ? ' sel' : ''}`} onClick={() => setChoice('ww_suggest')}>
            <span className="body"><span className="p">{ww.suggest.product}</span>
              <span className="m"><span className="tag t-ww">Woolworths</span><span>closest match</span></span></span>
            {ww.suggest.price && <span className="price">{ww.suggest.price}</span>}
          </button>
        )}
        {v.dest !== 'ww' && !(ww.suggest && v.dest === 'decide') && (
          v.dest === 'none'
            ? <div className="loading">The next order will look for it at Woolworths.</div>
            : <button className={`card opt${choice === 'ww' ? ' sel' : ''}`} onClick={() => setChoice('ww')}>
                <span className="body"><span className="p">Get it from Woolworths</span>
                  <span className="m"><span className="tag t-ww">Woolworths</span><span>the next order looks for it</span></span></span>
              </button>
        )}

        <div className="section eyebrow">Harris Farm</div>
        {hf === null && <div className="loading">Checking Harris Farm…</div>}
        {hf && hf.length === 0 && <div className="loading">Not at Harris Farm online.</div>}
        {(hf || []).map((h) => (
          <button key={h.variant_id} className={`card opt${choice === `hf:${h.variant_id}` ? ' sel' : ''}`} onClick={() => setChoice(`hf:${h.variant_id}`)}>
            <span className="body"><span className="p">{h.product}</span>
              <span className="m"><span className="tag t-hf">Harris Farm</span></span></span>
            <span className="price">${h.price.toFixed(2)}</span>
          </button>
        ))}

        <div className="section eyebrow">Shops</div>
        <button className={`card opt${choice === 'store' ? ' sel' : ''}`} onClick={() => setChoice('store')}>
          <span className="body"><span className="p">Buy it in store</span>
            <span className="m"><span className="tag t-store">In store</span><span>stays on the list</span></span></span>
        </button>

        {(hfPick || choice === 'store') && (
          <div className="remember">
            <span>{hfPick ? `Always get ${item.summary.toLowerCase()} from Harris Farm` : `Always buy ${item.summary.toLowerCase()} in store`}</span>
            <button className={`sw${remember ? ' on' : ''}`} onClick={() => setRemember(!remember)} aria-pressed={remember} aria-label="Remember" />
          </div>
        )}

        <div className="actions">
          <button className="pill solid" disabled={saving || !choice || unchanged} onClick={apply}>{buttonLabel}</button>
        </div>
        <div className="links">
          <button onClick={onClose}>Cancel</button>
          <button onClick={onRemove} disabled={saving}>Remove from list</button>
        </div>
      </div>
    </>
  );
}

// ─── order day ──────────────────────────────────────────────────────────

function OrderView({ lists, status, busy, onOrder, onBack, refresh, showToast, onOpen }) {
  const rows = CATEGORIES.flatMap(([eid]) => (lists[eid] || [])
    .filter((i) => i.status !== 'completed').map((i) => ({ eid, item: i, v: itemView(i) })));
  const ww = rows.filter((r) => r.v.dest === 'ww');
  const hfOpen = rows.filter((r) => r.v.dest === 'hf' && !r.v.hfOrdered);
  const hfSent = rows.filter((r) => r.v.hfOrdered);
  const decide = rows.filter((r) => r.v.dest === 'decide');
  const store = rows.filter((r) => r.v.dest === 'store');
  const fresh = rows.filter((r) => r.v.dest === 'none');

  // Harris Farm items routed by a remembered retailer have no product yet:
  // pick the household's last choice, else the best search match.
  const [resolved, setResolved] = useState({});
  useEffect(() => {
    let alive = true;
    hfOpen.filter((r) => !r.v.ww.hf && !resolved[r.item.uid]).forEach(async (r) => {
      const cands = await harrisFarmCandidates(r.item.summary, 3);
      let pref = null;
      try { pref = localStorage.getItem(hfPrefKey(r.item.summary)); } catch { /* private mode */ }
      const pick = cands.find((x) => x.variant_id === pref) || cands[0] || null;
      if (alive) setResolved((s) => ({ ...s, [r.item.uid]: pick || false }));
    });
    return () => { alive = false; };
  }, [hfOpen.map((r) => r.item.uid).join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps

  const hfPicks = hfOpen.map((r) => ({ ...r, pick: r.v.ww.hf || resolved[r.item.uid] || null }));
  const hfReady = hfPicks.filter((r) => r.pick && r.pick.variant_id);
  const hfTotal = hfReady.reduce((s, r) => s + (Number(r.pick.price) || 0), 0);

  function openHarrisFarm() {
    if (!hfReady.length) return;
    const url = HF_CART_BASE + hfReady.map((r) => `${r.pick.variant_id}:1`).join(',') + '?storefront=true';
    // Safari only allows window.open synchronously inside the tap.
    const w = window.open(url, '_blank');
    if (!w) window.location.href = url;
    const orderedAt = new Date().toISOString();
    Promise.all(hfReady.map((r) => {
      try { localStorage.setItem(hfPrefKey(r.item.summary), r.pick.variant_id); } catch { /* ignore */ }
      const d = { ...r.v.desc, ordered: 'Harris Farm', ordered_at: orderedAt, variant_id: r.pick.variant_id };
      return setDescription(r.eid, r.item.uid, writeDesc(d)).catch((e) => console.warn('tag failed', e));
    })).then(() => { refresh(); showToast(`${hfReady.length} item${hfReady.length === 1 ? '' : 's'} sent to Harris Farm`); });
  }

  async function skipHarrisFarm() {
    await Promise.all(hfOpen.map((r) => setDescription(r.eid, r.item.uid,
      writeDesc({ ...r.v.desc, ww: { state: 'in_store', route: 'store', decision: 'in_store' } })).catch(() => null)));
    showToast('Left on the list for the shops');
    refresh();
  }

  return (
    <div className="app">
      <button className="back" onClick={onBack}>‹ List</button>
      <div className="top"><h1>Order</h1><span className="count">{status.when ? `built ${status.when}` : ''}</span></div>

      <div className="card basket">
        <div className="hd"><span className="eyebrow">Woolworths</span>{ww.length > 0 && <span className="tag t-ww">In cart</span>}</div>
        <div className="hd" style={{ marginTop: 10 }}><span className="big">{ww.length} {ww.length === 1 ? 'item' : 'items'}</span><span className="big">{status.subtotal}</span></div>
        {busy && <div className="progress" style={{ marginTop: 12 }}><i /></div>}
        {ww.length > 0 && (
          <ul>{ww.map((r) => <li key={r.item.uid}><b>{r.item.summary}</b><span>{r.v.line}</span></li>)}</ul>
        )}
        {fresh.length > 0 && <div className="note">{fresh.length} new {fresh.length === 1 ? 'item' : 'items'} since the last build: {fresh.map((r) => r.item.summary).join(', ')}.</div>}
        <div className="btns" style={{ marginTop: 12 }}>
          <button className="pill" onClick={onOrder} disabled={busy}>{busy ? 'Ordering…' : status.when ? 'Update order' : 'Build order'}</button>
          <a className="pill solid" href={WOOLWORTHS_CART} target="_blank" rel="noreferrer">Check out in Woolworths</a>
        </div>
        {status.problem && <div className="note" style={{ color: 'var(--accent)' }}>{status.problem}</div>}
        <div className="note">Ticked off here automatically once the order is placed.</div>
      </div>

      {(hfOpen.length > 0 || hfSent.length > 0) && (
        <div className="card basket">
          <div className="hd"><span className="eyebrow">Harris Farm</span>{hfOpen.length > 0 && <span className="tag t-hf">Ready</span>}</div>
          {hfOpen.length > 0 && <div className="hd" style={{ marginTop: 10 }}><span className="big">{hfOpen.length} {hfOpen.length === 1 ? 'item' : 'items'}</span><span className="big">${hfTotal.toFixed(2)}</span></div>}
          {hfOpen.length > 0 && (
            <ul>{hfPicks.map((r) => (
              <li key={r.item.uid}><b>{r.item.summary}</b>
                <span>{r.pick ? `${r.pick.product}${r.pick.price ? ` · $${Number(r.pick.price).toFixed(2)}` : ''}` : r.pick === false ? 'not found at Harris Farm' : 'finding…'}</span></li>
            ))}</ul>
          )}
          {hfOpen.length > 0 && (
            <div className="btns">
              <button className="pill" onClick={skipHarrisFarm}>Skip this time</button>
              <button className="pill solid" onClick={openHarrisFarm} disabled={!hfReady.length}>Open Harris Farm cart</button>
            </div>
          )}
          {hfSent.length > 0 && <div className="note">Already in the Harris Farm cart: {hfSent.map((r) => r.item.summary).join(', ')}. Ticked off a day after it was sent.</div>}
          {hfOpen.length > 0 && <div className="note">Skip leaves these on the list for the shops.</div>}
        </div>
      )}

      {decide.length > 0 && (
        <div className="card basket">
          <div className="hd"><span className="eyebrow">To decide</span><span className="tag t-decide">{decide.length}</span></div>
          <ul style={{ marginBottom: 0 }}>{decide.map((r) => (
            <li key={r.item.uid} onClick={() => onOpen(r.eid, r.item.uid)} style={{ cursor: 'pointer' }}><b>{r.item.summary} ›</b><span>{r.v.line}</span></li>
          ))}</ul>
        </div>
      )}

      {store.length > 0 && (
        <div className="card basket">
          <div className="hd"><span className="eyebrow">In store</span><span className="tag t-store">{store.length}</span></div>
          <ul style={{ marginBottom: 0 }}>{store.map((r) => <li key={r.item.uid}><b>{r.item.summary}</b><span>{r.v.line}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}
