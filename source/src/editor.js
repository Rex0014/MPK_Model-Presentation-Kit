// Deck Builder editor. Plain DOM, no build step at runtime. The live preview is the same engine the exported file runs.
(function () {
'use strict';
const TYPES = DeckEngine.TYPES, SAMPLES = window.DECK_SAMPLES, esc = DeckEngine.esc;
const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const toList = x => Array.isArray(x) ? x : x ? [x] : [];
const pad = n => String(n).padStart(2, '0');
const fmtSize = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' kB';

// ---------- tiny DOM helper ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const ICON = {
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
  del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  dup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.1M12 19.3v2.1M4.3 4.3l1.5 1.5M18.2 18.2l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.3 19.7l1.5-1.5M18.2 5.8l1.5-1.5"/></svg>',
  moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
};
const iconBtn = (name, title, on, cls) => h('button', { class: cls || 'icon-b', type: 'button', title, 'aria-label': title, html: ICON[name], onclick: e => { e.stopPropagation(); on(e); } });

/* ---------- editor chrome theme ----------
   Greyscale only, and not part of the deck: the editor's two ramps live in
   editor.css, this just flips which one is in play and remembers the choice. */
const ED_THEME_KEY = 'deck-builder-editor-theme';
function setEdTheme(dark, save) {
  document.documentElement.dataset.edTheme = dark ? 'dark' : 'light';
  const b = $('btn-theme');
  if (b) { b.innerHTML = dark ? ICON.sun : ICON.moon; b.title = 'Editor theme: ' + (dark ? 'dark' : 'light') + ' — click for ' + (dark ? 'light' : 'dark'); }
  if (save) try { localStorage.setItem(ED_THEME_KEY, dark ? 'dark' : 'light'); } catch (e) { }
}
function initEdTheme() {
  let pref = null;
  try { pref = localStorage.getItem(ED_THEME_KEY); } catch (e) { }
  setEdTheme(pref ? pref === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  $('btn-theme').onclick = () => setEdTheme(document.documentElement.dataset.edTheme !== 'dark', true);
}

// ---------- state ----------
const ED = {
  deck: null, assets: {}, sel: 0,
  hist: [], fut: [], cur: '', savedSnap: '',
  fileName: null, handle: null,
  info: { parts: [], nodes: [], kind: 'none', meshes: 0, triangles: 0 },
  presenting: false, aspect: '16:9', engine: null,
};
const step = () => ED.sel >= 0 ? ED.deck.steps[ED.sel] : null;
const snap = () => JSON.stringify(ED.deck);

// ---------- toasts & dialogs ----------
function toast(msg, warn, ms) {
  const t = h('div', { class: 'toast' + (warn ? ' warn' : '') }, msg);
  $('toasts').append(t); setTimeout(() => t.remove(), ms || (warn ? 7000 : 3200));
}
function dialog(title, body, actions) {
  return new Promise(res => {
    const close = v => { bd.remove(); res(v); };
    const bd = h('div', { class: 'dialog-backdrop', onclick: e => { if (e.target === bd) close(null); } },
      h('div', { class: 'dialog', role: 'dialog' }, h('div', { class: 'dialog-title' }, title), h('div', { class: 'dialog-body' }, body),
        actions && actions.length ? h('div', { class: 'dialog-actions' }, actions.map(a => h('button', { class: 'btn ' + (a.primary ? 'btn-primary' : 'btn-secondary'), onclick: () => close(a.value) }, a.label))) : null));
    bd.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    document.body.append(bd);
    (bd.querySelector('.dlg-choices button, .btn-primary') || bd.querySelector('button')).focus();
    bd._close = close;
  });
}

// ---------- draft autosave (IndexedDB, best effort) ----------
const Draft = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open('deck-builder', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(this.db = r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  },
  async get() { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get('draft'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async put(v) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, 'draft'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
};
let draftT;
function saveDraftSoon() {
  clearTimeout(draftT);
  draftT = setTimeout(() => {
    const assets = {};
    for (const [id, a] of Object.entries(ED.assets)) assets[id] = { name: a.name, mime: a.mime, buf: a.buf || null, b64: a.buf ? null : a.b64 || null, size: a.size };
    Draft.put({ deck: snap(), assets, time: Date.now(), fileName: ED.fileName, savedSnap: ED.savedSnap }).catch(() => { });
  }, 1200);
}

// ---------- change tracking, undo ----------
let previewT, histT, listT;
function changed(opts = {}) {
  clearTimeout(previewT);
  previewT = setTimeout(() => ED.engine.setConfig(ED.deck, ED.assets), opts.now ? 0 : 140);
  clearTimeout(histT); histT = setTimeout(commit, 450);
  clearTimeout(listT); listT = setTimeout(renderList, 60);
  updateDirty(); saveDraftSoon();
}
function commit() {
  clearTimeout(histT);
  const s = snap();
  if (s === ED.cur) return;
  ED.hist.push(ED.cur); if (ED.hist.length > 200) ED.hist.shift();
  ED.cur = s; ED.fut = [];
  updateUndo();
}
function restore(s) {
  ED.deck = JSON.parse(s); ED.cur = s;
  if (ED.sel >= ED.deck.steps.length) ED.sel = ED.deck.steps.length - 1;
  ED.engine.setConfig(ED.deck, ED.assets);
  if (ED.sel >= 0) ED.engine.goTo(ED.sel, true);
  renderAll(); updateDirty(); saveDraftSoon();
}
function undo() { commit(); if (!ED.hist.length) return; ED.fut.push(ED.cur); restore(ED.hist.pop()); updateUndo(); }
function redo() { if (!ED.fut.length) return; ED.hist.push(ED.cur); restore(ED.fut.pop()); updateUndo(); }
function updateUndo() { $('btn-undo').disabled = !ED.hist.length && snap() === ED.cur; $('btn-redo').disabled = !ED.fut.length; }
function updateDirty() {
  $('doc-dirty').hidden = snap() === ED.savedSnap;
  $('doc-name').textContent = (ED.deck.title || 'Untitled') + (ED.fileName ? '  ·  ' + ED.fileName : '');
  document.title = (ED.deck.title || 'Untitled') + ' · Deck Builder';
  updateUndo();
}

// ---------- load a deck ----------
function loadDeck(deck, assets, fileName, opts = {}) {
  ED.deck = normalize(deck); ED.assets = assets || {};
  ED.fileName = fileName || null; ED.handle = opts.handle || null;
  ED.sel = ED.deck.steps.length ? 0 : -1;
  ED.cur = snap(); ED.hist = []; ED.fut = [];
  ED.savedSnap = opts.savedSnap != null ? opts.savedSnap : (opts.dirty ? '' : ED.cur);
  if (ED.engine) { ED.engine.state.orbited = false; ED.engine.state.overview = false; ED.engine.state.current = 0; ED.engine.setConfig(ED.deck, ED.assets); if (ED.sel >= 0) ED.engine.goTo(0, true); }
  renderAll(); updateDirty(); saveDraftSoon();
}
function normalize(d) {
  d = d || {};
  if (!Array.isArray(d.steps)) d.steps = [];
  d.settings = Object.assign({ autoSpin: true, showGrid: true, flightSeconds: 1.6, fadeAngle: 35 }, d.settings || {});
  d.theme = THEME.themeOf(d.theme);
  return d;
}

// ---------- selection ----------
function select(i, fly = true) {
  commit();
  ED.sel = i;
  if (i >= 0 && fly) ED.engine.goTo(i);
  renderList(); renderInspector();
}
function onEngineState(st) {
  const stage = $('stage');
  stage.classList.toggle('orbited', !!st.orbited && !ED.presenting);
  $('btn-capture').classList.toggle('attn', !!st.orbited && ED.sel >= 0);
  $('btn-capture').disabled = ED.sel < 0;
  $('btn-overview').textContent = st.overview ? 'Back to step' : 'Overview';
  $('btn-bare').textContent = st.bare ? 'Show slides' : 'Model only';
  $('view-notice').textContent = st.error || st.notice || (st.orbited && ED.sel >= 0 ? 'Camera moved. "Use this view" saves it to step ' + (ED.sel + 1) + '.' : '');
  $('present-count').textContent = st.steps.length ? pad(st.current + 1) + ' / ' + pad(st.steps.length) + ' · ' + (st.steps[st.current] && st.steps[st.current].title || '') : '';
  if (ED.presenting && !st.overview && st.current !== ED.sel && ED.deck && st.current < ED.deck.steps.length) {
    ED.sel = st.current; renderList(); if (!ED.presenting) renderInspector();
  }
}

// ---------- step operations ----------
function newStep(type) {
  const s = Object.assign({ type }, clone(SAMPLES.defaults[type] || {}));
  if (TYPES[type].place === 'side' && !TYPES[type].defSide) s.side = 'right';
  s.view = ED.engine.captureView(s);
  return s;
}
function addStep(type) {
  const at = ED.sel + 1;
  ED.deck.steps.splice(at, 0, newStep(type));
  changed({ now: true });
  setTimeout(() => select(at), 160);
}
function dupStep(i) { ED.deck.steps.splice(i + 1, 0, clone(ED.deck.steps[i])); changed({ now: true }); setTimeout(() => select(i + 1), 160); }
function delStep(i) {
  if (ED.deck.steps.length <= 1) { toast('A deck needs at least one step.', true); return; }
  ED.deck.steps.splice(i, 1);
  ED.sel = Math.min(i, ED.deck.steps.length - 1);
  changed({ now: true }); renderInspector();
  setTimeout(() => ED.engine.goTo(ED.sel), 160);
  toast('Step deleted. Ctrl+Z to undo.');
}
function moveStep(from, to) {
  if (to < 0 || to >= ED.deck.steps.length || from === to) return;
  const [s] = ED.deck.steps.splice(from, 1); ED.deck.steps.splice(to, 0, s);
  ED.sel = to; changed({ now: true }); renderInspector();
  setTimeout(() => ED.engine.goTo(to, true), 160);
}
function setType(s, type) {
  const d = clone(SAMPLES.defaults[type] || {});
  for (const k of Object.keys(d)) if (s[k] === undefined || (Array.isArray(d[k]) && !Array.isArray(s[k]))) s[k] = d[k];
  s.type = type;
  if (TYPES[type].place === 'side' && !s.side && !TYPES[type].defSide) s.side = 'right';
  changed({ now: true }); renderInspector();
}
function captureView() {
  const s = step(); if (!s) return;
  s.view = ED.engine.captureView(s);
  changed({ now: true });
  setTimeout(() => ED.engine.goTo(ED.sel, true), 150);
  renderInspector();
  toast('Saved the camera view to step ' + (ED.sel + 1) + '.');
}

// ---------- step list ----------
let dragFrom = -1;
function renderList() {
  const pane = $('steps-pane'), sc = pane.scrollTop;
  pane.innerHTML = '';
  const deckItem = h('div', { class: 'st-item st-deck' + (ED.sel < 0 ? ' sel' : ''), onclick: () => select(-1) },
    h('span', { class: 'st-num', html: '&#9881;' }), h('span', { class: 'st-txt' }, h('span', { class: 'st-title' }, 'Deck settings & model'), h('span', { class: 'st-type' }, ED.info.kind === 'file' ? ED.info.meshes + ' meshes' : ED.info.kind === 'builtin' ? 'Demo gearbox' : ED.info.kind === 'loading' ? 'Loading model…' : 'No model')));
  const list = h('ol', { class: 'st-list' });
  ED.deck.steps.forEach((s, i) => {
    const t = TYPES[s.type] ? s.type : 'card';
    const li = h('li', { class: 'st-item' + (i === ED.sel ? ' sel' : ''), draggable: 'true', onclick: () => select(i), title: s.title || '' },
      h('span', { class: 'st-num' }, pad(i + 1)),
      h('span', { class: 'st-txt' }, h('span', { class: 'st-title' }, s.title || (t === 'labels' ? toList(s.labels).map(l => l.text).join(', ') : '') || '(untitled)'), h('span', { class: 'st-type' }, TYPES[t].label + (s.notes ? ' · notes' : ''))),
      h('span', { class: 'st-acts' }, iconBtn('dup', 'Duplicate (Ctrl+D)', () => dupStep(i)), iconBtn('del', 'Delete (Del)', () => delStep(i))));
    li.addEventListener('dragstart', e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'step'); });
    li.addEventListener('dragover', e => {
      if (dragFrom < 0) return; e.preventDefault();
      const after = e.offsetY > li.offsetHeight / 2;
      list.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
      li.classList.add(after ? 'drop-after' : 'drop-before');
    });
    li.addEventListener('drop', e => {
      if (dragFrom < 0) return; e.preventDefault(); e.stopPropagation();
      const after = li.classList.contains('drop-after'); let to = i + (after ? 1 : 0); if (dragFrom < to) to--;
      const from = dragFrom; dragFrom = -1; moveStep(from, to);
    });
    li.addEventListener('dragend', () => { dragFrom = -1; list.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
    list.append(li);
  });
  const add = h('div', { class: 'st-add' }, h('button', { class: 'btn btn-secondary', onclick: e => typeMenu(e.currentTarget, addStep) }, '+ Add step'));
  const help = h('div', { class: 'st-help', html: 'Drag steps to reorder. <kbd>↑</kbd><kbd>↓</kbd> select · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Del</kbd> delete · <kbd>V</kbd> use view · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo' });
  pane.append(deckItem, list, add, help);
  pane.scrollTop = sc;
  const selEl = list.querySelector('.sel'); if (selEl && (selEl.offsetTop < pane.scrollTop || selEl.offsetTop > pane.scrollTop + pane.clientHeight - 40)) selEl.scrollIntoView({ block: 'nearest' });
}
function typeMenu(anchor, pick) {
  document.querySelectorAll('.type-menu').forEach(m => m.remove());
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'type-menu', role: 'menu' }, Object.entries(TYPES).map(([k, t]) => h('button', { type: 'button', onclick: () => { m.remove(); pick(k); } }, h('b', null, t.label), h('span', null, t.hint))));
  document.body.append(m);
  let top = r.top - m.offsetHeight - 6;
  if (top < 10) top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 10);
  m.style.left = Math.max(10, Math.min(r.left, innerWidth - 350)) + 'px'; m.style.top = Math.max(10, top) + 'px';
  m.querySelector('button').focus();
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  m.addEventListener('keydown', e => { if (e.key === 'Escape') m.remove(); });
}

// ---------- form helpers (bound to an object + key) ----------
function field(label, ...kids) { return h('div', { class: 'field' }, label != null ? h('label', null, label) : null, ...kids); }
function setOrDel(obj, key, v) { if (v === '' || v == null) delete obj[key]; else obj[key] = v; }
function txt(obj, key, ph, opts = {}) {
  return h('input', { class: 'input', type: 'text', value: obj[key] ?? '', placeholder: ph || '', oninput: e => { opts.keep ? obj[key] = e.target.value : setOrDel(obj, key, e.target.value); changed(); } });
}
function area(obj, key, ph, opts = {}) {
  const ta = h('textarea', { class: 'input' + (opts.code ? ' code' : ''), placeholder: ph || '', rows: opts.rows || 3, spellcheck: opts.code ? 'false' : 'true', oninput: e => { opts.keep ? obj[key] = e.target.value : setOrDel(obj, key, e.target.value); changed(); } });
  ta.value = obj[key] ?? '';
  if (opts.code) ta.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
  if (!opts.html) return ta;
  const wrap = (a, b) => () => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e); ta.setRangeText(a + sel + b, s, e, sel ? 'end' : 'select'); if (!sel) ta.setSelectionRange(s + a.length, s + a.length); ta.focus(); ta.dispatchEvent(new Event('input')); };
  const list = () => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || 'Item'; ta.setRangeText('<ul>' + sel.split('\n').filter(Boolean).map(l => '<li>' + l + '</li>').join('') + '</ul>', s, e, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
  const tools = h('div', { class: 'html-tools' },
    h('button', { type: 'button', title: 'Bold', onclick: wrap('<b>', '</b>'), html: '<b>B</b>' }), h('button', { type: 'button', title: 'Italic', onclick: wrap('<i>', '</i>'), html: '<i>I</i>' }),
    h('button', { type: 'button', title: 'Paragraph', onclick: wrap('<p>', '</p>') }, '¶'), h('button', { type: 'button', title: 'Bullet list (one item per line)', onclick: list }, '• list'),
    h('button', { type: 'button', title: 'Inline code', onclick: wrap('<code>', '</code>') }, '</>'), h('button', { type: 'button', title: 'Accent colour', onclick: wrap('<span style="color:var(--color-accent-04)">', '</span>') }, 'accent'));
  return h('div', null, tools, ta);
}
function num(obj, key, opts = {}) {
  return h('input', { class: 'input', type: 'number', step: opts.step || 'any', min: opts.min, max: opts.max, value: obj[key] ?? '', placeholder: opts.ph || 'auto',
    oninput: e => { const v = e.target.value === '' ? null : +e.target.value; setOrDel(obj, key, v != null && isFinite(v) ? v : null); changed(); } });
}
function seg(options, value, onPick) {
  const b = h('div', { class: 'seg-b', role: 'group' });
  for (const [v, label] of options) {
    const btn = h('button', { type: 'button', class: v === value ? 'on' : '' }, label);
    btn.onclick = () => { [...b.children].forEach(x => x.classList.toggle('on', x === btn)); onPick(v); };
    b.append(btn);
  }
  return b;
}
function check(label, value, onChange) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!value, onchange: e => onChange(e.target.checked) }), label);
}
function range(label, value, min, max, stepV, fmt, onChange) {
  const val = h('span', { class: 'val' }, fmt(value));
  return h('div', { class: 'field' }, h('label', null, label, val),
    h('input', { type: 'range', min, max, step: stepV, value, oninput: e => { val.textContent = fmt(+e.target.value); onChange(+e.target.value); } }));
}
function dropdown(options, value, onChange) {
  return h('select', { class: 'input', onchange: e => onChange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}
function section(title, ...kids) { return h('div', { class: 'in-sec' }, h('h6', null, title), ...kids); }
function sectionH(titleNode, ...kids) { return h('div', { class: 'in-sec' }, h('h6', null, ...[].concat(titleNode)), ...kids); }
const hint = t => h('p', { class: 'in-hint', html: t });

// ---------- deck palette ----------
const THEME = DeckEngine.theme;
const roleList = () => ED.deck.theme.roles;
const roleOf = key => roleList().find(r => r.key === key);
const roleOptions = (blank) => (blank ? [['', blank]] : []).concat(roleList().map(r => [r.key, r.label || r.key]));
// Every role publishes --color-<key>-01 … -NN; the swatch strip is that ramp.
function swatches(r, dark) {
  const list = THEME.ramp(r.base, r.shades, r.inter);
  if (r.invert && dark) list.reverse();
  return list.map((hex, i) => h('span', { class: 'sw', style: 'background:' + hex, title: '--color-' + r.key + '-' + pad(i + 1) + '  ' + hex }));
}
const row = (n, ...kids) => h('div', { class: 'in-row', style: '--n:' + n }, ...kids);

// A list of rows (objects or arrays) with move/delete and an add button.
function rowsEditor(arr, renderRow, make, addLabel, opts = {}) {
  const box = h('div', { class: 'rows' });
  const draw = () => {
    box.innerHTML = '';
    arr.forEach((it, i) => {
      const acts = h('div', { class: 'row-acts' },
        iconBtn('up', 'Move up', () => { if (i > 0) { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); changed(); draw(); } }),
        iconBtn('down', 'Move down', () => { if (i < arr.length - 1) { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); changed(); draw(); } }),
        iconBtn('del', 'Remove', () => { arr.splice(i, 1); changed(); draw(); }));
      box.append(h('div', { class: 'row', style: 'grid-template-columns:' + (opts.cols || '1fr') }, renderRow(it, i, acts)));
    });
    if (!opts.max || arr.length < opts.max) box.append(h('button', { class: 'btn btn-secondary btn-sm add-b', type: 'button', onclick: () => { arr.push(make()); changed(); draw(); } }, addLabel));
  };
  draw();
  return box;
}

// Part chips: toggles names in arr. Shows the model's parts plus any names already in the list.
function partChips(get, set, opts = {}) {
  const known = ED.info.parts, cur = toList(get());
  const names = [...new Set([...(opts.all ? ['*'] : []), ...known, ...cur])];
  if (!names.length) {
    return h('div', null, h('input', { class: 'input', type: 'text', value: cur.join(', '), placeholder: 'part names, comma separated', oninput: e => { set(e.target.value.split(',').map(x => x.trim()).filter(Boolean)); changed(); } }),
      hint(ED.info.kind === 'none' ? 'Add a model in Deck settings to pick parts here.' : 'This model has no named parts yet. Name them in Deck settings → Parts.'));
  }
  const box = h('div', { class: 'chips' });
  for (const n of names) {
    const b = h('button', { type: 'button', class: 'chip' + (cur.includes(n) ? ' on' : '') + (!known.includes(n) && n !== '*' ? ' missing' : ''), title: known.includes(n) || n === '*' ? '' : 'Not found in the current model' }, n === '*' ? 'all' : n);
    b.onclick = () => {
      const list = toList(get()).slice(), k = list.indexOf(n);
      k >= 0 ? list.splice(k, 1) : list.push(n);
      set(list); b.classList.toggle('on', k < 0); changed(); opts.onChange && opts.onChange();
    };
    box.append(b);
  }
  return box;
}
function partSelect(value, onChange, opts = {}) {
  const names = [...new Set([...(opts.all ? ['*'] : []), ...ED.info.parts, ...(value ? [value] : [])])];
  if (!names.length) return h('input', { class: 'input', type: 'text', value: value || '', placeholder: 'part', oninput: e => onChange(e.target.value.trim()) });
  return dropdown([['', opts.none || '— part —'], ...names.map(n => [n, n === '*' ? 'all parts' : n])], value || '', onChange);
}

// ---------- assets ----------
const uid = () => 'a' + Math.random().toString(36).slice(2, 9);
async function addAsset(file) {
  const buf = await file.arrayBuffer(), id = uid();
  ED.assets[id] = { name: file.name, mime: file.type || mimeOf(file.name), buf, size: buf.byteLength };
  return id;
}
function mimeOf(name) {
  const e = name.split('.').pop().toLowerCase();
  return { stl: 'model/stl', glb: 'model/gltf-binary', gltf: 'model/gltf+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif' }[e] || 'application/octet-stream';
}
function assetSize(id) { const a = ED.assets[id]; return a ? (a.size || (a.buf ? a.buf.byteLength : a.b64 ? Math.round(a.b64.length * 0.75) : 0)) : 0; }
function pickFile(input, multiple) {
  return new Promise(res => {
    const el = $(input); el.value = ''; el.multiple = !!multiple;
    el.onchange = () => res([...el.files]); el.click();
  });
}
function imageField(s, key) {
  const src = s[key] ? ED.engine.assetUrl(s[key]) : '';
  const thumb = h('div', { class: 'img-thumb', style: src ? 'background-image:url("' + src.replace(/"/g, '%22') + '")' : '' }, src ? '' : 'No image');
  const set = async files => { const f = files.find(f => /^image\//.test(f.type) || /\.(png|jpe?g|svg|webp|gif)$/i.test(f.name)); if (!f) return; s[key] = 'asset:' + await addAsset(f); changed({ now: true }); renderInspector(); };
  const box = h('div', { class: 'img-field' }, thumb, h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
    h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => set(await pickFile('file-image')) }, s[key] ? 'Replace image…' : 'Choose image…'),
    s[key] ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { delete s[key]; changed({ now: true }); renderInspector(); } }, 'Remove') : null));
  box.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  box.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); set([...e.dataTransfer.files]); });
  return box;
}

// ---------- inspector ----------
function renderInspector() {
  const pane = $('insp'), sc = pane.scrollTop, keep = pane.dataset.for === String(ED.sel);
  pane.innerHTML = ''; pane.dataset.for = String(ED.sel);
  // Rendering may add empty containers (specs: [], view: {}); that isn't an edit, so don't let it count as one.
  const before = snap();
  if (ED.sel < 0) renderDeckInspector(pane); else renderStepInspector(pane, step(), ED.sel);
  const after = snap();
  if (after !== before) { if (ED.cur === before) ED.cur = after; if (ED.savedSnap === before) ED.savedSnap = after; updateDirty(); }
  if (keep) pane.scrollTop = sc;
}

function renderStepInspector(pane, s, i) {
  const type = TYPES[s.type] ? s.type : 'card', T = TYPES[type];
  pane.append(h('div', { class: 'in-head' }, h('h4', null, 'Step ' + (i + 1)),
    iconBtn('up', 'Move up', () => moveStep(i, i - 1)), iconBtn('down', 'Move down', () => moveStep(i, i + 1)),
    iconBtn('dup', 'Duplicate', () => dupStep(i)), iconBtn('del', 'Delete', () => delStep(i))));

  // Layout
  const lay = section('Layout',
    field('Slide type', dropdown(Object.entries(TYPES).map(([k, t]) => [k, t.label + ' — ' + t.hint]), type, v => setType(s, v))));
  if (T.place !== 'labels') {
    lay.append(field('Depth', seg([['front', 'In front of the model'], ['behind', 'Behind the model']], s.behind ? 'behind' : 'front',
      v => { setOrDel(s, 'behind', v === 'behind' || null); changed({ now: true }); renderInspector(); })));
    if (s.behind) lay.append(hint('The model is drawn over this slide. Occlusion is whole-slide, not per pixel, and a slide behind the model does not take clicks.'));
  }
  if (roleList().length > 1) lay.append(field('Accent colour',
    dropdown(roleOptions('Deck default — ' + ((roleOf(ED.deck.theme.accent) || {}).label || ED.deck.theme.accent)), s.accent || '',
      v => { setOrDel(s, 'accent', v || null); changed({ now: true }); })));
  if (T.place === 'side') {
    const cur = s.side || T.defSide || 'left';
    lay.append(field('Position on screen', seg([['left', 'Left'], ['right', 'Right'], ['center', 'Centre'], ['bottom', 'Bottom']], cur, v => { s.side = v; changed({ now: true }); })));
  } else if (T.place === 'pin') {
    lay.append(field('Callout points', seg([['right', 'Box right of part'], ['left', 'Box left of part']], s.side === 'left' ? 'left' : 'right', v => { s.side = v; changed({ now: true }); })));
  }
  pane.append(lay);

  // Content
  const c = section('Content');
  const k = () => field('Kicker', txt(s, 'kicker', 'Small line above the title'));
  const t = (ph) => field('Title', txt(s, 'title', ph || 'Title'));
  const b = (label, key = 'body', rows = 4) => field(label || 'Body (HTML allowed)', area(s, key, '', { html: true, rows }));
  const specs = (label) => field(label || 'Specs (label / value)', rowsEditor(s.specs || (s.specs = []), (r, j, acts) => [txt(r, 0, 'Label', { keep: true }), txt(r, 1, 'Value', { keep: true }), acts], () => ['', ''], '+ Row', { cols: '1fr 1fr auto' }));
  switch (type) {
    case 'title': c.append(k(), t(), b('Intro'), specs('Key figures (shown as a row)')); break;
    case 'section': c.append(k(), row(2, field('Big number', txt(s, 'number', pad(i + 1))), h('span')), t(), b('Subtitle', 'body', 2)); break;
    case 'end': c.append(k(), t('Questions'), b('Line under the title', 'body', 2)); break;
    case 'card': c.append(k(), t(), b(), field('Image (shown in the theme\'s duotone)', imageField(s, 'image')), specs()); break;
    case 'split': c.append(k(), t(), b('Left column'), b('Right column', 'body2'), field('Image (right column)', imageField(s, 'image')), specs('Specs (right column)')); break;
    case 'callout':
      if (!toList(s.focus).length) c.append(h('p', { class: 'in-warn' }, 'A callout points at its focus part. Pick one under 3D → Focus.'));
      c.append(k(), t(), b('Body', 'body', 3), specs()); break;
    case 'labels':
      c.append(t('Shown in the step list'), field('Labels', rowsEditor(s.labels || (s.labels = []), (l, j, acts) => [
        row(2, partSelect(l.part, v => { setOrDel(l, 'part', v); changed(); }), dropdown([['', 'Side: auto'], ['left', 'Left'], ['right', 'Right']], l.side || '', v => { setOrDel(l, 'side', v); changed(); })),
        row(2, txt(l, 'text', 'Label'), txt(l, 'note', 'Note (optional)')), acts], () => ({ part: '', text: 'Label' }), '+ Label')),
        hint('Each label is pinned to the centre of its part. With no part it points at the view centre.')); break;
    case 'metrics':
      c.append(k(), t(), b('Intro (optional)', 'body', 2), field('Figures', rowsEditor(s.stats || (s.stats = []), (m, j, acts) => [
        row(3, txt(m, 'value', 'Value'), txt(m, 'unit', 'Unit'), txt(m, 'label', 'Label')), txt(m, 'note', 'Note (optional)'), acts], () => ({ label: 'Metric', value: '0' }), '+ Figure', { max: 8 }))); break;
    case 'table': c.append(k(), t(), b('Intro (optional)', 'body', 2), field('Table', tableEditor(s))); break;
    case 'compare':
      c.append(k(), t(), b('Intro (optional)', 'body', 2), field('Columns', rowsEditor(s.columns || (s.columns = []), (col, j, acts) => [txt(col, 'title', 'Column title'), area(col, 'body', '', { html: true, rows: 3 }), acts], () => ({ title: 'Column', body: '' }), '+ Column', { max: 3 }))); break;
    case 'checklist':
      c.append(k(), t(), b('Intro (optional)', 'body', 2), field('Items', rowsEditor(s.items || (s.items = []), (it, j, acts) => [
        row(2, txt(it, 'text', 'Item'), dropdown([['open', 'Open'], ['done', 'Done'], ['risk', 'Risk'], ['blocked', 'Blocked'], ['info', 'Info']], it.status || 'open', v => { it.status = v; changed(); })),
        txt(it, 'note', 'Note (optional)'), acts], () => ({ text: 'Item', status: 'open' }), '+ Item'))); break;
    case 'code':
      c.append(k(), t(), row(2, field('Language label', txt(s, 'lang', 'python')), h('span')), field('Code', area(s, 'code', '', { code: true, keep: true, rows: 10 })), b('Caption', 'body', 2)); break;
    case 'image':
      c.append(k(), t(), field('Image', imageField(s, 'image')), field('Alt text', txt(s, 'imageAlt', 'Describe the image')),
        row(2, field('Fit', seg([['contain', 'Whole image'], ['cover', 'Fill frame']], s.fit === 'cover' ? 'cover' : 'contain', v => { s.fit = v; changed(); })), field('Theme tint', check('Duotone', s.duotone, v => { setOrDel(s, 'duotone', v || null); changed(); }))),
        b('Caption', 'body', 2)); break;
    case 'timeline':
      c.append(k(), t(), field('Milestones', rowsEditor(s.milestones || (s.milestones = []), (m, j, acts) => [
        row(2, txt(m, 'date', 'Date'), dropdown([['done', 'Done'], ['current', 'Current'], ['next', 'Upcoming']], m.status || 'next', v => { m.status = v; changed(); })),
        txt(m, 'title', 'Milestone'), txt(m, 'body', 'Note (optional)'), acts], () => ({ date: '', title: 'Milestone', status: 'next' }), '+ Milestone', { max: 8 }))); break;
    case 'caption': c.append(k(), t(), b('Caption', 'body', 2)); break;
  }
  pane.append(c);
  pane.append(render3D(s, i));
  pane.append(section('Speaker notes', area(s, 'notes', 'Shown with N when presenting the exported file', { rows: 3 })));
}

function tableEditor(s) {
  const tb = s.table || (s.table = { columns: ['A', 'B'], rows: [['', '']] });
  tb.columns = toList(tb.columns); tb.rows = toList(tb.rows);
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  const draw = () => {
    box.innerHTML = '';
    const n = tb.columns.length;
    const grid = h('div', { class: 'tbl-ed', style: 'grid-template-columns:repeat(' + n + ',minmax(70px,1fr)) 24px' });
    tb.columns.forEach((cname, j) => grid.append(h('input', { class: 'input hd', value: cname, oninput: e => { tb.columns[j] = e.target.value; changed(); } })));
    grid.append(iconBtn('x', 'Remove last column', () => { if (tb.columns.length > 1) { tb.columns.pop(); tb.rows.forEach(r => r.length = Math.min(r.length, tb.columns.length)); changed(); draw(); } }));
    tb.rows.forEach((r, ri) => {
      for (let j = 0; j < n; j++) grid.append(h('input', { class: 'input', value: r[j] ?? '', oninput: e => { r[j] = e.target.value; changed(); } }));
      grid.append(iconBtn('del', 'Remove row', () => { tb.rows.splice(ri, 1); changed(); draw(); }));
    });
    box.append(grid, h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { tb.rows.push(tb.columns.map(() => '')); changed(); draw(); } }, '+ Row'),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { tb.columns.push('Column'); tb.rows.forEach(r => r.push('')); changed(); draw(); } }, '+ Column'),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: pasteTable }, 'Paste from Excel…')));
  };
  const pasteTable = async () => {
    const ta = h('textarea', { class: 'input', rows: 8, placeholder: 'Paste cells copied from Excel or a CSV. The first row becomes the header.' });
    const p = dialog('Paste table', ta, [{ label: 'Cancel', value: false }, { label: 'Replace table', value: true, primary: true }]);
    setTimeout(() => ta.focus(), 30);
    if (!await p) return;
    const lines = ta.value.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (!lines.length) return;
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    const cells = lines.map(l => l.split(sep).map(x => x.trim().replace(/^"(.*)"$/, '$1')));
    const n = Math.max(...cells.map(r => r.length));
    tb.columns = Array.from({ length: n }, (_, j) => cells[0][j] || '');
    tb.rows = cells.slice(1).map(r => Array.from({ length: n }, (_, j) => r[j] || ''));
    changed(); draw();
  };
  draw();
  return box;
}

function render3D(s, i) {
  const sec = section('3D');
  const v = s.view || (s.view = {});
  // Camera
  sec.append(h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
    h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: captureView }, 'Use current view'),
    h('button', { class: 'btn btn-secondary btn-sm', type: 'button', title: 'Clear distance and target: the camera fits the focus parts', onclick: () => { delete v.distance; delete v.target; delete v.offset; changed({ now: true }); renderInspector(); } }, 'Auto-fit'),
    h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => ED.engine.goTo(i) }, 'Fly to step')),
    hint('Orbit the preview (drag, scroll, right-drag to pan), then <b>Use current view</b>.'),
    row(3, field('Azimuth °', num(v, 'azimuth', { step: 1, ph: '0' })), field('Elevation °', num(v, 'elevation', { step: 1, ph: '15' })), field('Distance', num(v, 'distance', { step: 0.1 }))));
  if (v.target) sec.append(h('div', { class: 'stat-line', style: 'display:flex;align-items:center;gap:6px' }, 'Pivot fixed at ' + v.target.map(x => x.toFixed(2)).join(', '), iconBtn('x', 'Clear pivot (use focus centre)', () => { delete v.target; changed({ now: true }); renderInspector(); })));

  // Focus & highlight
  sec.append(field('Focus — camera centres on these parts', partChips(() => s.focus, l => setOrDel(s, 'focus', l.length ? l : null), { onChange: () => { if (s.type === 'callout') renderInspector(); } })));
  const same = !Array.isArray(s.highlight);
  sec.append(field('Highlight', check('Same as focus', same, on => { if (on) delete s.highlight; else s.highlight = toList(s.focus).slice(); changed(); renderInspector(); }),
    same ? null : h('div', { style: 'margin-top:6px' }, partChips(() => s.highlight, l => { s.highlight = l; }), hint('None selected = nothing fades.'))));
  sec.append(field('Hide parts', partChips(() => s.hide, l => setOrDel(s, 'hide', l.length ? l : null))));

  // Colours
  const colors = s.colors || {};
  const cRows = Object.entries(colors).map(([p, col]) => ({ p, col }));
  const writeColors = () => { const m = {}; cRows.forEach(r => { if (r.p) m[r.p] = r.col; }); setOrDel(s, 'colors', Object.keys(m).length ? m : null); changed(); };
  sec.append(field('Recolour parts for this step', rowsEditor(cRows, (r, j, acts) => [partSelect(r.p, val => { r.p = val; writeColors(); }, { all: true }),
    h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(r.col) ? r.col : '#5980a6', oninput: e => { r.col = e.target.value; writeColors(); } }), acts],
    () => ({ p: '', col: '#5980a6' }), '+ Colour', { cols: '1fr auto auto' })));
  // keep rowsEditor's removals in sync
  const origSplice = cRows.splice.bind(cRows); cRows.splice = (...a) => { const r = origSplice(...a); writeColors(); return r; };

  // Explode & cut
  sec.append(range('Explode', +s.explode || 0, 0, 2, 0.05, x => x ? x.toFixed(2) + '×' : 'off', x => { setOrDel(s, 'explode', x || null); changed(); }));
  const cut = s.cut || {};
  const cutBox = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const drawCut = () => {
    cutBox.innerHTML = '';
    cutBox.append(field('Section cut', seg([['', 'Off'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], s.cut ? s.cut.axis : '', a => {
      if (!a) delete s.cut; else s.cut = Object.assign({ at: 50 }, s.cut || {}, { axis: a });
      changed({ now: true }); drawCut();
    })));
    if (s.cut) cutBox.append(range('Cut position', s.cut.at ?? 50, 0, 100, 1, x => Math.round(x) + ' %', x => { s.cut.at = x; changed(); }),
      check('Keep the other side', s.cut.flip, on => { setOrDel(s.cut, 'flip', on || null); changed(); }));
  };
  drawCut(); void cut;
  sec.append(cutBox);

  // Fine tuning
  const fine = h('details', null, h('summary', { class: 'in-hint', style: 'cursor:pointer' }, 'Fine tuning'),
    h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:8px' },
      row(3, field('Fit ×', num(v, 'fit', { step: 0.05, ph: '1' })), field('Side shift', num(v, 'shift', { step: 0.01, ph: 'auto' })), field('Bottom shift', num(v, 'shiftY', { step: 0.01, ph: 'auto' }))),
      hint('Fit scales the auto distance. Shift moves the model sideways (fraction of the screen) so the slide does not cover it.')));
  sec.append(fine);
  return sec;
}

/* The deck's palette: one base colour per role, nine shades each, generated by
   the same ramp the engine publishes as --color-<key>-100 … -900. Two slots say
   which role paints surfaces and which paints accents; a step can borrow a
   different role for its accent, and slide HTML can name any of them. */
function renderPalette(pane) {
  const t = ED.deck.theme;
  const sec = section('Palette');
  sec.append(field('Presentation theme', seg([['light', 'Light'], ['dark', 'Dark']], t.dark ? 'dark' : 'light',
    v => { t.dark = v === 'dark'; changed({ now: true }); renderInspector(); })),
    hint('Dark reads the surface ramp backwards, so surfaces invert while the accents keep meaning the same colour. The editor has its own light/dark button in the top bar; it never touches this.'));

  const rows = h('div', { class: 'rows' });
  const rekey = () => {
    // Labels are what the user types; keys are what CSS and the steps address.
    const taken = {};
    t.roles.forEach(r => {
      let k = THEME.roleKey(r.label || r.key) || 'colour', n = 1;
      while (taken[k]) k = THEME.roleKey(r.label || r.key) + '-' + ++n;
      taken[k] = 1;
      if (k !== r.key) {
        ED.deck.steps.forEach(st => { if (st.accent === r.key) st.accent = k; });
        if (t.surface === r.key) t.surface = k;
        if (t.accent === r.key) t.accent = k;
        r.key = k;
      }
    });
  };
  t.roles.forEach((r, i) => {
    const strip = h('div', { class: 'ramp' });
    const drawStrip = () => { strip.innerHTML = ''; strip.append(...swatches(r, t.dark)); };
    drawStrip();
    rows.append(h('div', { class: 'row role-row' },
      h('input', { class: 'input', value: r.label || r.key, placeholder: 'name', title: 'Name of this colour. Slides address it as var(--color-' + r.key + '-700).',
        oninput: e => { r.label = e.target.value; }, onchange: () => { rekey(); changed({ now: true }); renderInspector(); } }),
      h('input', { type: 'color', value: (/^#[0-9a-f]{6}$/i.test(r.base) ? r.base : '#808080').toLowerCase(), title: 'Base colour',
        oninput: e => { r.base = e.target.value.toUpperCase(); drawStrip(); changed(); } }),
      h('label', { class: 'check', title: r.key === t.surface ? 'The surface role always flips — that flip is what dark mode is.' : 'On: the ramp reads backwards on a dark deck, so -04 stays readable trim and -05 stays a slab. Off: the colour means the same hue in both themes.' },
        h('input', { type: 'checkbox', checked: r.invert, disabled: r.key === t.surface,
          onchange: e => { r.invert = e.target.checked; drawStrip(); changed({ now: true }); } }), 'flip'),
      t.roles.length > 1 ? iconBtn('del', 'Remove this colour', () => {
        t.roles.splice(i, 1);
        ED.deck.steps.forEach(st => { if (st.accent === r.key) delete st.accent; });
        ED.deck.theme = THEME.themeOf(t);
        changed({ now: true }); renderInspector();
      }) : h('span'),
      strip));
  });
  rows.append(h('button', { class: 'btn btn-secondary btn-sm add-b', type: 'button', onclick: () => {
    THEME.addRole(t, { label: 'Colour ' + (t.roles.length + 1), base: '#C6373A', invert: true });
    changed({ now: true }); renderInspector();
  } }, '+ Colour'));
  sec.append(field('Colours — name, base, flip on dark', rows));

  sec.append(row(2,
    field('Surfaces use', dropdown(roleOptions(), t.surface, v => {
      t.surface = v;
      t.roles.forEach(r => { delete r.shades; delete r.invert; });
      ED.deck.theme = THEME.themeOf(t);
      changed({ now: true }); renderInspector();
    })),
    field('Accents use', dropdown(roleOptions(), t.accent, v => { t.accent = v; changed({ now: true }); renderInspector(); }))));
  sec.append(hint('<b>Surfaces</b> sets the page, panels, text and dividers — 11 shades, and it always flips. <b>Accents</b> sets kickers, rules, section backgrounds and highlights; every other role gets 5 shades around its base. Shades do the same job at the same position: <b>-04</b> is trim that reads against the page, <b>-05</b> a slab, <b>-01</b> what sits on that slab. A step can borrow a different role for its accent, and any colour is reachable straight from slide HTML: <code>&lt;b style="color:var(--color-' + t.accent + '-04)"&gt;</code>.'));
  pane.append(sec);
}

function renderDeckInspector(pane) {
  const d = ED.deck, st = d.settings;
  pane.append(h('div', { class: 'in-head' }, h('h4', null, 'Deck settings')));
  pane.append(section('Presentation', field('Title', txt(d, 'title', 'Shown top-left and as the file title')), field('Subtitle', txt(d, 'subtitle', 'Shown under the title')),
    range('Camera flight', st.flightSeconds ?? 1.6, 0.3, 4, 0.1, x => x.toFixed(1) + ' s', x => { st.flightSeconds = x; changed(); }),
    range('Fade slides when orbiting', st.fadeAngle ?? 35, 0, 90, 5, x => x ? 'after ' + x + '°' : 'never', x => { st.fadeAngle = x; changed({ now: true }); }),
    hint('Orbit away from a step\u2019s own view and its slide fades out, so the model is never hidden behind it \u2014 gone by half again as far. Drag, scroll and pan work over the whole view, slide included.'),
    h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap' }, check('Floor grid', st.showGrid !== false, on => { st.showGrid = on; changed(); }),
      check('Ghost other slides', !!st.ghosts, on => { setOrDel(st, 'ghosts', on || null); changed({ now: true }); }),
      d.model && d.model.builtin ? check('Spin gears', st.autoSpin !== false, on => { st.autoSpin = on; changed(); }) : null),
    hint('Only the current step\u2019s slide is shown. <b>Ghost other slides</b> leaves the rest faintly in space, the way the deck used to.')));
  renderPalette(pane);

  const m = d.model, info = ED.info;
  const ms = section('Model');
  const status = info.kind === 'loading' ? 'Loading…' : info.kind === 'none' ? 'No model. Slides float over an empty floor.' :
    info.meshes + ' meshes · ' + info.triangles.toLocaleString() + ' triangles · ' + (info.parts.length ? info.parts.length + ' named parts' : 'no named parts');
  ms.append(h('div', { class: 'stat-line' }, status));
  ms.append(h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
    h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => addModelFiles(await pickFile('file-model', true)) }, m && m.files ? 'Add files…' : 'Load STL / GLB…'),
    h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { d.model = { builtin: 'gearbox' }; changed({ now: true }); renderInspector(); } }, 'Demo gearbox'),
    m ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { d.model = null; changed({ now: true }); renderInspector(); } }, 'Remove model') : null));
  ms.append(hint('One STL per part gives you named parts straight away. A GLB keeps colours and node names: map nodes to parts below. Draco and meshopt compression are supported. STEP must be exported to STL or GLB first.'));

  if (m && m.files) {
    ms.append(field('Files', h('div', { class: 'rows' }, m.files.map((f, j) => h('div', { class: 'file-row' },
      h('div', { class: 'file-name', title: f.name }, f.name, h('small', null, fmtSize(assetSize(f.asset)))),
      h('input', { class: 'input', value: f.part || '', placeholder: /\.stl$/i.test(f.name) ? 'part name' : 'whole file = part', title: 'Part name for everything in this file', oninput: e => { setOrDel(f, 'part', e.target.value.trim()); changed(); } }),
      iconBtn('del', 'Remove file', () => { m.files.splice(j, 1); if (!m.files.length) d.model = null; changed({ now: true }); renderInspector(); }))))));
    ms.append(row(3,
      field('Up axis', seg([['y', 'Y up'], ['z', 'Z up (CAD)']], (m.upAxis || 'y').toLowerCase(), a => { m.upAxis = a; changed({ now: true }); })),
      field('Size', num(m, 'size', { step: 0.5, ph: '9' })),
      field('Edges', dropdown([['', 'Auto'], ['on', 'Always'], ['off', 'Never']], m.edges === true ? 'on' : m.edges === false ? 'off' : '', v => { if (v === 'on') m.edges = true; else if (v === 'off') m.edges = false; else delete m.edges; changed({ now: true }); }))));

    // Part mapping (GLB node names → part)
    const parts = m.parts || {};
    const pRows = Object.entries(parts).map(([name, subs]) => ({ name, subs: toList(subs).join(', ') }));
    const writeParts = () => { const o = {}; pRows.forEach(r => { if (r.name.trim()) o[r.name.trim()] = r.subs.split(',').map(x => x.trim()).filter(Boolean); }); setOrDel(m, 'parts', Object.keys(o).length ? o : null); changed({ now: true }); };
    const pr = rowsEditor(pRows, (r, j, acts) => [h('input', { class: 'input', value: r.name, placeholder: 'part name', oninput: e => { r.name = e.target.value; writeParts(); } }),
      h('input', { class: 'input', value: r.subs, placeholder: 'matches node names containing…', oninput: e => { r.subs = e.target.value; writeParts(); } }), acts],
      () => ({ name: 'part' + (pRows.length + 1), subs: '' }), '+ Part', { cols: '0.8fr 1.2fr auto' });
    const origSplice = pRows.splice.bind(pRows); pRows.splice = (...a) => { const r = origSplice(...a); writeParts(); return r; };
    const nodes = info.nodes || [];
    const pSec = section('Parts',
      hint('A part groups meshes so steps can focus, highlight, hide, recolour or label them. Node names are matched by "contains", case-insensitive.'), pr);
    if (nodes.length) pSec.append(field('Nodes found in the model', h('div', { class: 'chips' }, nodes.slice(0, 80).map(n => h('button', { class: 'chip', type: 'button', title: 'Add as a part', onclick: () => { pRows.push({ name: n.toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'part', subs: n }); writeParts(); renderInspector(); } }, n)))),
      h('button', { class: 'btn btn-secondary btn-sm add-b', type: 'button', onclick: () => { pRows.length = 0; nodes.forEach(n => pRows.push({ name: n.toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'part', subs: n })); writeParts(); renderInspector(); } }, 'One part per node'));
    pane.append(ms, pSec);

    // Base materials per part
    const mats = m.materials || {};
    const mRows = Object.entries(mats).map(([p, o]) => Object.assign({ p }, o));
    const writeMats = () => { const o = {}; mRows.forEach(r => { if (r.p) { const { p, ...rest } = r; o[p] = rest; } }); setOrDel(m, 'materials', Object.keys(o).length ? o : null); changed({ now: true }); };
    const mr = rowsEditor(mRows, (r, j, acts) => [partSelect(r.p, v => { r.p = v; writeMats(); }, { all: true }),
      h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#c4c8cd', oninput: e => { r.color = e.target.value; writeMats(); } }),
      h('input', { class: 'input', type: 'number', min: 0, max: 1, step: 0.05, value: r.metalness ?? '', placeholder: 'metal', title: 'Metalness 0–1', oninput: e => { setOrDel(r, 'metalness', e.target.value === '' ? null : +e.target.value); writeMats(); } }),
      h('input', { class: 'input', type: 'number', min: 0, max: 1, step: 0.05, value: r.roughness ?? '', placeholder: 'rough', title: 'Roughness 0–1', oninput: e => { setOrDel(r, 'roughness', e.target.value === '' ? null : +e.target.value); writeMats(); } }), acts],
      () => ({ p: '', color: '#c4c8cd' }), '+ Material', { cols: '1fr auto 64px 64px auto' });
    const origS2 = mRows.splice.bind(mRows); mRows.splice = (...a) => { const r = origS2(...a); writeMats(); return r; };
    pane.append(section('Base colours', hint('The model\'s own colours per part, for every step. Steps can still recolour on top.'), mr));
  } else pane.append(ms);

  // Export info
  const ids = usedAssets(), bytes = ids.reduce((n, id) => n + assetSize(id), 0);
  pane.append(section('Export', hint('Export writes one .html file with the engine, the model, images and fonts inside. It opens with a double-click in any modern browser, offline.'),
    h('div', { class: 'stat-line' }, 'Estimated file size: ' + fmtSize(runtimeSize(ids) + bytes * 4 / 3))));
}

async function addModelFiles(files) {
  files = files.filter(f => /\.(stl|glb|gltf)$/i.test(f.name));
  if (!files.length) { toast('Choose .stl or .glb files. STEP files must be exported to STL or GLB from your CAD tool first.', true); return; }
  const gltfJson = files.find(f => /\.gltf$/i.test(f.name));
  if (gltfJson) toast(gltfJson.name + ': a .gltf with separate .bin/texture files can\'t be embedded. Export GLB (binary) instead.', true);
  const d = ED.deck;
  if (!d.model || !d.model.files) d.model = { files: [], upAxis: files.some(f => /\.stl$/i.test(f.name)) ? 'z' : 'y' };
  for (const f of files) {
    if (/\.gltf$/i.test(f.name)) continue;
    const id = await addAsset(f);
    const part = /\.stl$/i.test(f.name) ? f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^\w-]+/g, '-') : undefined;
    d.model.files.push(Object.assign({ asset: id, name: f.name }, part ? { part } : {}));
  }
  if (d.settings.autoSpin === undefined) d.settings.autoSpin = true;
  changed({ now: true });
  if (ED.sel >= 0) select(-1, false); else renderInspector();
  toast('Loading ' + files.map(f => f.name).join(', ') + '…');
}

// ---------- open ----------
async function openFile(file) {
  const text = await file.text();
  try {
    if (/\.html?$/i.test(file.name) || /^\s*<!doctype|^\s*<html/i.test(text)) {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const data = doc.getElementById('deck-data');
      if (!data) throw new Error('This HTML file was not exported by Deck Builder (no deck data inside).');
      const assets = {};
      doc.querySelectorAll('script[data-asset]').forEach(s => { const b64 = s.textContent.trim(); assets[s.dataset.asset] = { name: s.dataset.name, mime: s.dataset.mime, b64, size: Math.round(b64.length * 0.75) }; });
      await confirmReplace();
      loadDeck(JSON.parse(data.textContent), assets, file.name);
      toast('Opened ' + file.name + '.');
      return;
    }
    const json = text.trim().replace(/^[\s\S]*?^\s*window\.PRESENTATION\s*=\s*/m, '').replace(/;\s*$/, '');
    const deck = JSON.parse(json);
    if (!deck || !Array.isArray(deck.steps)) throw new Error('No "steps" list found in ' + file.name + '.');
    // Configs from a folder pack: model null meant the built-in gearbox; file references can't be read from here.
    const warn = [];
    if (deck.model === null || deck.model === undefined) deck.model = { builtin: 'gearbox' };
    else if (deck.model && !deck.model.builtin && (deck.model.src || (deck.model.files && deck.model.files.some(f => f.src)))) { warn.push('the model'); deck.model = null; }
    deck.steps.forEach(s => { if (s.image && !/^(asset:|data:|https?:)/.test(s.image)) { warn.push('image ' + s.image); delete s.image; } });
    await confirmReplace();
    loadDeck(deck, {}, null, { dirty: true });
    toast(warn.length ? 'Imported. Re-add ' + warn.join(', ') + ' here: a config file only points at files on disk.' : 'Imported ' + file.name + '.', !!warn.length);
  } catch (e) {
    if (e && e.message === 'cancel') return;
    console.error(e); toast('Could not open ' + file.name + ': ' + e.message, true);
  }
}
async function confirmReplace() {
  if (snap() === ED.savedSnap) return;
  const ok = await dialog('Replace the current deck?', 'It has changes that are not exported yet.', [{ label: 'Cancel', value: false }, { label: 'Replace', value: true, primary: true }]);
  if (!ok) throw new Error('cancel');
}
async function newDeck() {
  try { await confirmReplace(); } catch (e) { return; }
  const pick = await dialog('New presentation', h('div', { class: 'dlg-choices' },
    h('button', { type: 'button', onclick: () => document.querySelector('.dialog-backdrop')._close('blank') }, h('b', null, 'Blank'), h('span', null, 'One title step, no model. Load your STL/GLB in Deck settings.')),
    h('button', { type: 'button', onclick: () => document.querySelector('.dialog-backdrop')._close('demo') }, h('b', null, 'Demo deck'), h('span', null, 'Built-in gearbox with one step of every slide type.'))), []);
  if (!pick) return;
  loadDeck(clone(SAMPLES[pick]), {}, null);
  if (pick === 'blank') select(-1, false);
}

// ---------- export ----------
function usedAssets() {
  const ids = new Set(), d = ED.deck;
  if (d.model && d.model.files) d.model.files.forEach(f => f.asset && ids.add(f.asset));
  JSON.stringify(d.steps, (k, v) => { if (typeof v === 'string' && v.startsWith('asset:')) ids.add(v.slice(6)); return v; });
  return [...ids].filter(id => ED.assets[id]);
}
function needsDraco(ids) {
  return ids.some(id => {
    const a = ED.assets[id]; if (!a || !/\.glb$/i.test(a.name || '')) return false;
    if (a.draco !== undefined) return a.draco;
    return a.draco = (() => { try {
      let u8;
      if (a.buf) u8 = new Uint8Array(a.buf, 0, Math.min(a.buf.byteLength, 4e6));
      else { const bin = atob(a.b64.slice(0, 5.4e6 - (5.4e6 % 4))); u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); }
      const dv = new DataView(u8.buffer, u8.byteOffset), len = dv.getUint32(12, true);
      return new TextDecoder().decode(u8.subarray(20, 20 + Math.min(len, u8.length - 20))).includes('KHR_draco_mesh_compression');
    } catch (e) { return true; } })();
  });
}
const rt = id => document.getElementById(id).textContent;
function runtimeSize(ids) { return rt('rt-css').length + rt('rt-three').length + rt('rt-engine').length + rt('rt-player').length + (needsDraco(ids) ? rt('rt-draco').length : 0); }
function bufToB64(buf) {
  const u8 = new Uint8Array(buf), parts = [];
  for (let i = 0; i < u8.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)));
  return btoa(parts.join(''));
}
function buildExport() {
  const d = clone(ED.deck), ids = usedAssets();
  const attr = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const parts = ['<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="Deck Builder">\n<title>', esc(d.title || 'Presentation'), '</title>\n<style>', rt('rt-css'), '</style>\n</head>\n<body>\n',
    document.getElementById('rt-hud').innerHTML, '\n<script>', rt('rt-three'), '<\/script>\n'];
  if (needsDraco(ids)) parts.push('<script>', rt('rt-draco'), '<\/script>\n');
  parts.push('<script type="application/json" id="deck-data">', JSON.stringify(d).replace(/</g, '\\u003c'), '<\/script>\n');
  for (const id of ids) {
    const a = ED.assets[id];
    if (!a.b64) a.b64 = bufToB64(a.buf);
    parts.push('<script type="application/octet-stream" data-asset="', attr(id), '" data-name="', attr(a.name), '" data-mime="', attr(a.mime), '">', a.b64, '<\/script>\n');
  }
  parts.push('<script>', rt('rt-engine'), '<\/script>\n<script>', rt('rt-player'), '<\/script>\n</body>\n</html>\n');
  return new Blob(parts, { type: 'text/html' });
}
const slug = s => (String(s || 'presentation').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'presentation') + '.html';
async function exportDeck(saveAs) {
  commit();
  let blob;
  try { blob = buildExport(); } catch (e) { console.error(e); toast('Export failed: ' + e.message, true); return; }
  const name = ED.fileName || slug(ED.deck.title);
  if (window.showSaveFilePicker) {
    try {
      if (!ED.handle || saveAs) ED.handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Presentation (HTML)', accept: { 'text/html': ['.html'] } }] });
      const w = await ED.handle.createWritable(); await w.write(blob); await w.close();
      ED.fileName = ED.handle.name; return saved(blob);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.warn('Save picker unavailable, downloading instead.', e); ED.handle = null;
    }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  ED.fileName = name; saved(blob, true);
}
function saved(blob, downloaded) {
  ED.savedSnap = snap(); updateDirty(); saveDraftSoon();
  toast((downloaded ? 'Downloaded ' : 'Saved ') + ED.fileName + ' (' + fmtSize(blob.size) + '). Double-click it to present.');
}

// ---------- present ----------
function present(on) {
  if (on === ED.presenting) return;
  ED.presenting = on;
  document.body.classList.toggle('presenting', on);
  if (on) { commit(); ED.engine.goTo(Math.max(0, ED.sel)); if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { }); }
  else { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); renderAll(); }
  fitStage();
  onEngineState(ED.engine.state);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && ED.presenting) present(false); });

// ---------- preview frame ----------
function fitStage() {
  const frame = $('frame'), stage = $('stage'), W = frame.clientWidth, H = frame.clientHeight;
  if (ED.presenting || ED.aspect === 'fill') { stage.style.width = W + 'px'; stage.style.height = H + 'px'; return; }
  const [a, b] = ED.aspect.split(':').map(Number), m = 20;
  let w = W - 2 * m, hh = w * b / a;
  if (hh > H - 2 * m) { hh = H - 2 * m; w = hh * a / b; }
  stage.style.width = Math.max(100, Math.floor(w)) + 'px'; stage.style.height = Math.max(60, Math.floor(hh)) + 'px';
}

// ---------- keyboard ----------
addEventListener('keydown', e => {
  const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (document.querySelector('.dialog-backdrop')) return;
  if (ED.presenting) {
    if (e.key === 'Escape') { e.preventDefault(); present(false); }
    else ED.engine.handleKey(e);
    return;
  }
  if (mod && k === 's') { e.preventDefault(); exportDeck(e.shiftKey); return; }
  if (mod && k === 'enter') { e.preventDefault(); present(true); return; }
  if (mod && k === 'o') { e.preventDefault(); $('btn-open').click(); return; }
  if (typing) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 'd') { e.preventDefault(); if (ED.sel >= 0) dupStep(ED.sel); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && ED.sel >= 0) { e.preventDefault(); delStep(ED.sel); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); select(Math.min(ED.deck.steps.length - 1, ED.sel + 1)); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); select(Math.max(ED.sel <= 0 ? -1 : 0, ED.sel - 1)); }
  else if (k === 'v' && ED.sel >= 0) captureView();
  else if (k === 'r') ED.engine.resetView();
  else if (k === 'o') ED.engine.toggleOverview();
});

// ---------- drag & drop files anywhere ----------
addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('dragging'); } });
addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
addEventListener('drop', async e => {
  document.body.classList.remove('dragging');
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])]; if (!files.length) return;
  e.preventDefault();
  const deckFile = files.find(f => /\.(html?|json|js)$/i.test(f.name));
  if (deckFile) return openFile(deckFile);
  const models = files.filter(f => /\.(stl|glb|gltf)$/i.test(f.name));
  if (models.length) return addModelFiles(models);
  const img = files.find(f => /^image\//.test(f.type));
  const s = step();
  if (img && s && ['card', 'split', 'image'].includes(s.type)) { s.image = 'asset:' + await addAsset(img); changed({ now: true }); renderInspector(); return; }
  if (img) { toast('Select a Card, Two-column or Image step to drop an image on it.', true); return; }
  toast('Drop .stl / .glb models, images, or an exported deck (.html).', true);
});

function renderAll() { renderList(); renderInspector(); }

// ---------- boot ----------
async function boot() {
  $('btn-new').onclick = newDeck;
  $('btn-open').onclick = async () => { const [f] = await pickFile('file-open'); if (f) openFile(f); };
  $('btn-undo').onclick = undo; $('btn-redo').onclick = redo;
  initEdTheme();
  $('btn-export').onclick = () => exportDeck(false);
  $('btn-present').onclick = () => present(true);
  $('btn-capture').onclick = captureView;
  $('btn-reset').onclick = () => ED.engine.resetView();
  $('btn-overview').onclick = () => ED.engine.toggleOverview();
  $('btn-bare').onclick = () => ED.engine.toggleBare();
  $('aspect').onchange = e => { ED.aspect = e.target.value; try { localStorage.setItem('deck-builder-aspect', ED.aspect); } catch (x) { } fitStage(); };
  try { const a = localStorage.getItem('deck-builder-aspect'); if (a) { ED.aspect = a; $('aspect').value = a; } } catch (x) { }
  new ResizeObserver(fitStage).observe($('frame')); fitStage();

  let draft = null;
  try { draft = await Draft.get(); } catch (e) { }
  ED.deck = normalize(clone(SAMPLES.demo)); ED.cur = ED.savedSnap = snap();
  ED.engine = new DeckEngine($('stage'), {
    config: ED.deck, assets: ED.assets, keys: false, dim: 0.14,
    onSlideClick: i => { if (!ED.presenting && i !== ED.sel) { ED.sel = i; renderList(); renderInspector(); } },
    onModel: info => { ED.info = info; renderList(); if (ED.sel < 0 || document.activeElement === document.body || !$('insp').contains(document.activeElement)) renderInspector(); },
  }, onEngineState);
  ED.engine.start();
  window.editor = ED;
  if (draft && draft.deck && draft.deck !== JSON.stringify(SAMPLES.demo)) {
    const when = new Date(draft.time).toLocaleString();
    loadDeck(JSON.parse(draft.deck), draft.assets || {}, draft.fileName, { savedSnap: draft.savedSnap || '' });
    toast('Restored your last session (' + when + '). Use New for a fresh deck.');
  } else loadDeck(clone(SAMPLES.demo), {}, null);
}
boot();
})();
