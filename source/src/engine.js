/* Deck engine: impress.js-style steps flown through a three.js scene.
   One file, shared by the editor's live preview and by every exported deck.
   Input: a deck config (JSON) + an asset map { id: { name, mime, b64 | buf } }. No network, no fetch: runs from file://. */
(function () {
'use strict';
const T = window.THREE;
const { OrbitControls, CSS3DRenderer, CSS3DObject, RoomEnvironment, GLTFLoader, DRACOLoader, MeshoptDecoder, STLLoader, toCreasedNormals } = window.THREE_ADDONS;

const toList = x => Array.isArray(x) ? x : x ? [x] : [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = x => String(x).padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CORNERS = '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const D2R = Math.PI / 180;
// A step's model rotation, in degrees: [x, y, z] or { x, y, z }.
const rotOf = r => { const o = Array.isArray(r) ? { x: r[0], y: r[1], z: r[2] } : r || {}; return [o.x, o.y, o.z].map(d => (+d || 0) * D2R); };
// Embedded assets arrive base64-encoded (one <script data-asset> per file) and are decoded on first use.
const b64ToBuf = b64 => { const bin = atob(String(b64).trim()), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8.buffer; };
/* Slide supersampling. A CSS3D element is rasterised at its own CSS size and
   then stretched by the 3D transform, so a slide that lands wider on screen
   than it is in CSS goes soft. `zoom` is a layout-level scale — text re-lays
   out and re-rasterises instead of stretching — but it also multiplies the
   element's own transform, so it cannot go on the element CSS3DRenderer drives.
   It goes on a child instead: the wrapper is what gets transformed, the slide
   inside it is what gets zoomed, and `place()` sizes the wrapper to match.
   Quantised to quarters so small camera moves don't force a repaint. */
const CAN_ZOOM = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('zoom', '2');
const zoomFor = k => CAN_ZOOM ? Math.ceil(clamp(k, 1, 3) * 4) / 4 : 1;
function wrapSlide(el, w) {
  const wrap = document.createElement('div');
  wrap.className = 'sl-wrap';
  wrap.style.width = w + 'px';
  wrap.append(el);
  // Height stays auto: a slide whose content outgrows its design height still
  // sizes the wrapper, and CSS3DRenderer centres on the box it actually has.
  wrap.slide = el; wrap.designW = w; wrap.zoomK = 1;
  return wrap;
}
function zoomSlide(wrap, k) {
  if (wrap.zoomK === k) return;
  wrap.zoomK = k;
  wrap.slide.style.zoom = k === 1 ? '' : k;
  wrap.style.width = wrap.designW * k + 'px';
}

/* ── Theme ───────────────────────────────────────────────────────────────────
   One base hex per colour role, a ramp of shades out. The generator is a port
   of theme-maker (TM_Theme-Maker/typescript/src/ramp.ts): the base sits in the
   middle of the ramp and each RGB channel is interpolated outward from it to
   the margins — down to `inter`, up to `255 - inter` — so a ramp spans the
   whole range the margin allows whatever base it was given. The shades are then
   sorted by luminance, so -01 is always the lightest.

   Every colour in a deck is a role and goes through that ramp — there are no
   computed one-off colours. A role is theme-maker's RoleConfig: {key, label,
   base, shades, invert}. The surface role is a wide 11-shade family; the rest
   are tight 5-shade families around their base. `invert` reads a ramp backwards
   on dark, which is how a position keeps its job when the page flips: -04 is
   trim that reads against the page, -05 is a slab, -01 is what sits on a slab.
   A semantic colour that must mean the same hue in both themes (a warning, a
   pass/fail) leaves invert off, the library's default.

   Roles publish --color-<key>-01 … -NN, so one the user adds is addressable
   straight from slide HTML. Two slots alias a role into the names the
   stylesheets use: `surface` → --color-neutral-NN plus --color-bg/-surface/
   -text/-divider, `accent` → --color-accent-NN. --color-accent is an alias of
   --color-accent-04, not a colour of its own. */
const SURFACE_SHADES = 11, COLOUR_SHADES = 5, TRIM = 3;   // -04, the page-facing position
const MIN_SHADES = 3, MAX_SHADES = 15;                    // a role's own count; the aliases are resampled to the two above
const hexRgb = hex => { const h = String(hex || '').replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0); };
const rgbHex = rgb => '#' + rgb.map(c => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const relLum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function ramp(hex, count, inter) {
  count = count || COLOUR_SHADES; inter = inter == null ? 20 : inter;
  const rgb = hexRgb(hex);
  if (count < 2) return [rgbHex(rgb)];
  const half = (count - 1) / 2, out = [];
  for (let a = 0; a < count; a++) {
    const t = (a - half) / half;                 // -1 at the dark end, 0 at the base, +1 at the light end
    out.push(rgb.map(c => t < 0 ? c + (c - inter) * t : c + (255 - inter - c) * t));
  }
  // A channel already outside the margins steps the "wrong" way (a 0 channel
  // rises to `inter` at the dark end), so the raw ramp is not monotonic: the
  // luminance sort is what orders it. Array.prototype.sort is stable.
  return out.sort((x, y) => relLum(y) - relLum(x)).map(rgbHex);
}

/* The surface default is a mid-grey, and it no longer needs an `inter` of its
   own: the ramp reaches the margins from any base now, so the default margin of
   20 is what gives a paper-light page and an ink-dark text instead of pure
   white and pure black. Both accents invert because deck.css uses them as trim
   on the page; accent-2 is the second colour industry.css's components reach
   for. */
const THEME = {
  dark: false, surface: 'neutral', accent: 'accent',
  roles: [
    { key: 'neutral', label: 'Neutral', base: '#8C8C90', shades: SURFACE_SHADES, invert: true },
    { key: 'accent', label: 'Accent', base: '#C8AF4C', shades: COLOUR_SHADES, invert: true },
  ],
};
const roleKey = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* theme-maker's addRole, against a deck's theme instead of module state: the
   deck JSON is the store here, so the theme object is passed in and handed
   back. Returns the role as it was registered (its key may have been made
   unique), or null if there was nothing to register. */
function addRole(theme, role) {
  if (!theme || !role) return null;
  const want = roleKey(role.key || role.label) || 'colour';
  let key = want;
  for (let n = 2; theme.roles.some(r => r.key === key); n++) key = want + '-' + n;
  const r = Object.assign({ label: role.label || key, shades: COLOUR_SHADES, invert: false }, role, { key: key });
  theme.roles.push(r);
  return r;
}

function themeOf(theme) {
  const t = Object.assign({}, THEME, theme || {});
  t.roles = (Array.isArray(t.roles) ? t.roles : []).filter(r => r && roleKey(r.key)).map(r => Object.assign({}, r, { key: roleKey(r.key) }));
  if (!t.roles.length) t.roles = THEME.roles.map(r => Object.assign({}, r));
  const has = k => t.roles.some(r => r.key === k);
  if (!has(t.surface)) t.surface = t.roles[0].key;
  if (!has(t.accent)) t.accent = t.roles[t.roles.length > 1 ? 1 : 0].key;
  for (const r of t.roles) {
    /* `inter: 0` is what every deck built before the full-span ramp carries on
       its surface role — it was the workaround for a ramp bounded by the nearer
       end, and it now reads as "run all the way to pure black and white", which
       is not the paper-and-ink those decks were designed against. */
    if (r.inter === 0) delete r.inter;
    const isSurface = r.key === t.surface;
    // Being the surface is what makes a role wide, and it has to invert — that
    // flip is the whole of dark mode. Everything else follows its own config.
    // The shade count is the deck's to set; the slot only supplies the default.
    r.shades = clamp(Math.round(+r.shades || (isSurface ? SURFACE_SHADES : COLOUR_SHADES)), MIN_SHADES, MAX_SHADES);
    r.invert = isSurface ? true : !!r.invert;
  }
  return t;
}
const setRamp = (el, name, list) => list.forEach((hex, i) => el.style.setProperty('--color-' + name + '-' + pad(i + 1), hex));
/* An alias keeps its canonical length whatever its role's shade count is:
   deck.css and industry.css name --color-neutral-01 … -11 and --color-accent-01
   … -05 outright, so a shorter ramp is resampled rather than left with holes. */
const fit = (list, n) => list.length === n ? list : Array.from({ length: n }, (_, i) => list[Math.round(i * (list.length - 1) / (n - 1))]);
const trimOf = list => list[Math.min(TRIM, list.length - 1)];

function applyTheme(el, theme) {
  const t = themeOf(theme), ramps = {};
  for (const r of t.roles) {
    const list = ramp(r.base, r.shades, r.inter);
    ramps[r.key] = (r.invert && t.dark) ? list.reverse() : list;
  }
  const surf = ramps[t.surface], acc = ramps[t.accent], acc2 = ramps['accent-2'] || acc;
  const ink = surf[surf.length - 1], dark = relLum(hexRgb(surf[0])) < 128;
  for (const k of Object.keys(ramps)) setRamp(el, k, ramps[k]);
  setRamp(el, 'neutral', fit(surf, SURFACE_SHADES));
  setRamp(el, 'accent', fit(acc, COLOUR_SHADES));
  setRamp(el, 'accent-2', fit(acc2, COLOUR_SHADES));
  const set = (k, v) => el.style.setProperty(k, v);
  set('--color-accent', trimOf(acc));
  set('--color-accent-2', trimOf(acc2));
  set('--color-bg', surf[0]);
  set('--color-surface', surf[1]);
  set('--color-text', surf[Math.min(8, surf.length - 1)]);
  set('--color-divider', 'color-mix(in srgb, ' + surf[Math.min(8, surf.length - 1)] + ' 16%, transparent)');
  // Elevation is drawn from the ground: ink-tinted on a light page, ambient darkness on a dark one.
  set('--shadow-sm', dark ? '0 1px 2px rgba(0,0,0,.5)' : '0 1px 2px color-mix(in srgb, ' + ink + ' 14%, transparent)');
  set('--shadow-md', dark ? '0 3px 10px rgba(0,0,0,.55)' : '0 3px 10px color-mix(in srgb, ' + ink + ' 16%, transparent)');
  set('--shadow-lg', dark ? '0 12px 32px rgba(0,0,0,.6)' : '0 12px 32px color-mix(in srgb, ' + ink + ' 22%, transparent)');
  return Object.assign(t, { ramps: ramps, surf: surf, acc: acc, isDark: dark });
}

// GLB loader with meshopt + Draco. Both decoders run without fetch(), so compressed GLBs work from file://.
let _gltf;
function gltfLoader() {
  if (_gltf) return _gltf;
  const draco = new DRACOLoader();
  draco.setDecoderConfig({ type: 'js' });
  draco._loadLibrary = () => window.DRACO_DECODER_SRC ? Promise.resolve(window.DRACO_DECODER_SRC)
    : Promise.reject(new Error('This model is Draco-compressed but the Draco decoder is not included.'));
  _gltf = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  return _gltf;
}

/* Slide types.
   w/h: element size in CSS px. place: how the slide sits in 3D —
   side (a panel beside the model; side = left | right | center | bottom), center (always centred),
   pin (pinned to the focus point with a leader line), labels (several small tags pinned to parts).
   frac: share of the screen width a side panel may take. */
const TYPES = {
  title:     { w: 860,  h: 500, place: 'side', frac: 0.52, label: 'Title', hint: 'Cover slide: big heading, key figures.' },
  section:   { w: 760,  h: 440, place: 'center', label: 'Section', hint: 'Divider with a big number.' },
  chapters:  { w: 780,  h: 520, place: 'side', frac: 0.48, label: 'Chapters', hint: 'Agenda: a list of chapters, each able to jump to its step.' },
  card:      { w: 640,  h: 440, place: 'side', frac: 0.44, label: 'Card', hint: 'Text, optional image and specs.' },
  split:     { w: 920,  h: 480, place: 'side', frac: 0.58, label: 'Two columns', hint: 'Two text columns, image or specs on the right.' },
  callout:   { w: 600,  h: 300, place: 'pin', label: 'Callout', hint: 'Compact note pinned to a part.' },
  labels:    { w: 380,  h: 150, place: 'labels', label: 'Part labels', hint: 'Several tags, each pinned to a part.' },
  metrics:   { w: 860,  h: 420, place: 'side', frac: 0.55, label: 'Key figures', hint: 'Big numbers with units.' },
  table:     { w: 820,  h: 480, place: 'side', frac: 0.55, label: 'Table', hint: 'Columns and rows.' },
  compare:   { w: 920,  h: 480, place: 'side', frac: 0.58, label: 'Compare', hint: 'Two or three columns side by side.' },
  checklist: { w: 660,  h: 460, place: 'side', frac: 0.45, label: 'Checklist', hint: 'Items with a status.' },
  code:      { w: 760,  h: 480, place: 'side', frac: 0.5, label: 'Code', hint: 'Code block with line numbers.' },
  image:     { w: 820,  h: 560, place: 'side', frac: 0.55, label: 'Image', hint: 'Large picture with a caption.' },
  video:     { w: 900,  h: 580, place: 'side', frac: 0.58, label: 'Video', hint: 'Video with a caption; plays when the step is up.' },
  timeline:  { w: 1100, h: 300, place: 'side', defSide: 'bottom', label: 'Timeline', hint: 'Milestones along a line.' },
  caption:   { w: 900,  h: 140, place: 'side', defSide: 'bottom', label: 'Model view', hint: 'The model is the slide; a short caption strip.' },
  end:       { w: 760,  h: 440, place: 'center', label: 'End', hint: 'Closing slide.' },
};
const typeOf = s => TYPES[s && s.type] ? s.type : 'card';
/* A slide's own box, in design pixels, and where its content sits in it. The
   type gives the default shape; a step may pick its own width and height, or
   ask the height to follow the content — the one case layout() has to measure
   the slide rather than assume it. All unset means the type's own box, so an
   old deck is unchanged. */
const sizeOf = (s, t) => ({
  w: clamp(+s.slideW || t.w, 240, 2000),
  h: +s.slideH ? clamp(+s.slideH, 120, 1600) : s.fitH ? 0 : t.h,
  fit: !!s.fitH,
});
// Where the content sits when the slide is taller than it needs to be.
const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end', spread: 'space-between' };

/* A part is a name for some meshes; a group is a name for some parts. A mesh
   answers to its own part name and to every group that holds it, so focus,
   highlight, hide, colours and labels take either without knowing which. */
const tagsOf = (part, groups) => part ? [part, ...Object.keys(groups || {}).filter(g => toList(groups[g]).includes(part))] : [];
const tagged = (o, names) => o.tags.some(t => names.includes(t));
// A mesh's part: the one the loader gave it (one STL = one part), else the first
// part whose substrings appear in its own node name or an ancestor's.
function partOf(o, parts, keys) {
  if (o.userData.part) return o.userData.part;
  let names = ''; for (let p = o; p; p = p.parent) names += ' ' + (p.name || '').toLowerCase();
  return keys.find(key => toList(parts[key]).some(sub => String(sub) && names.includes(String(sub).toLowerCase()))) || null;
}
// What a re-tag depends on: everything about a model that is a name, a list or
// a colour rather than geometry.
const tagKeyOf = m => JSON.stringify(m ? [m.parts || 0, m.groups || 0, m.materials || 0] : null);
/* A part's base material, as the deck's override on top of the values the mesh
   arrived with. Both are written every time, so clearing an override restores
   the file's own material instead of needing the file parsed again. */
function applyBaseMat(mt, mo, mat0) {
  if (mt.color && mat0.color != null) mt.color.setHex(mat0.color);
  if (mat0.metalness !== undefined) mt.metalness = mat0.metalness;
  if (mat0.roughness !== undefined) mt.roughness = mat0.roughness;
  mt.opacity = mat0.opacity;
  if (!mo) return;
  if (mo.color && mt.color) mt.color.set(mo.color);
  if (mo.metalness !== undefined) mt.metalness = mo.metalness;
  if (mo.roughness !== undefined) mt.roughness = mo.roughness;
  if (mo.opacity !== undefined) mt.opacity = mo.opacity;
}

/* Stress colours: the scale every FEA post-processor uses, cold blue to hot
   red. Built through T.Color so it lands in the renderer's working colour
   space like every other colour here, and shared with the legend's gradient so
   the bar and the model can never drift apart. Scalar 0 in a baked field means
   "not measured", which reads as neutral grey rather than as a value. */
const FEA_HEX = ['#2a4b9b', '#00a8c6', '#41b24a', '#f0c419', '#d93a2b'];
let FEA = null, GREY = null;
function feaColor(t, out) {
  if (!FEA) { FEA = FEA_HEX.map(h => new T.Color(h)); GREY = new T.Color('#9a9a9e'); }
  const x = clamp(t, 0, 1) * (FEA.length - 1), i = Math.min(FEA.length - 2, Math.floor(x));
  return out.copy(FEA[i]).lerp(FEA[i + 1], x - i);
}
const fmtVal = v => !isFinite(v) ? '—' : Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01) ? v.toPrecision(3) : String(+v.toFixed(2));

// ---------- slide markup ----------
function head(s, i, n, cls) {
  return '<div class="sl-head' + (cls ? ' ' + cls : '') + '"><span>' + esc(s.kicker) + '</span><span>' + pad(i + 1) + ' / ' + pad(n) + '</span></div>';
}
function specsTable(s) {
  const rows = toList(s.specs).filter(r => r && (r[0] || r[1]));
  return rows.length ? '<table class="sl-specs">' + rows.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td>' + esc(v) + '</td></tr>').join('') + '</table>' : '';
}
function figure(src, s, cls) {
  return src ? '<figure class="blueprint ' + (cls || '') + '"' + figVars(s) + '>' + CORNERS + '<img src="' + esc(src) + '" alt="' + esc(s.imageAlt) + '"></figure>' : '';
}
/* Where a picture sits in its slide, as the three variables deck.css reads for
   every figure: height in px, width as a share of the column, and which edge it
   lines up with. Unset means the type's own default, so an old deck is unchanged. */
function figVars(s) {
  const v = [];
  // Two ways to size it: a fixed height, or an aspect ratio that lets the width decide.
  // A ratio wins, and takes the height and the flex-grow out of the way to do it.
  const ar = ratioOf(s.imageRatio);
  if (ar) v.push('--fig-ar:' + ar, '--fig-h:auto', '--fig-flex:none');
  else if (+s.imageH) v.push('--fig-h:' + clamp(+s.imageH, 40, 1200) + 'px');
  if (+s.imageW && +s.imageW < 100) v.push('--fig-w:' + clamp(+s.imageW, 10, 100) + '%');
  const al = { left: 'flex-start', center: 'center', right: 'flex-end' }[s.imageAlign];
  if (al) v.push('--fig-al:' + al);
  if (['cover', 'contain', 'fill'].includes(s.fit)) v.push('--fig-fit:' + s.fit);
  return v.length ? ' style="' + v.join(';') + '"' : '';
}
// "16/9", "16:9" or "1.78" \u2192 a CSS aspect-ratio; anything else is no ratio at all.
function ratioOf(r) {
  const m = /^\s*([\d.]+)\s*(?:[/:]\s*([\d.]+)\s*)?$/.exec(String(r ?? ''));
  if (!m || !(+m[1] > 0) || (m[2] !== undefined && !(+m[2] > 0))) return null;
  return m[2] === undefined ? String(+m[1]) : +m[1] + '/' + +m[2];
}
/* A step may point at another step. The target is held by id, not by index, so
   moving or inserting steps cannot silently re-aim a button; a numeric ref is
   still read as an index, which is what an older deck or a hand-edited JSON has. */
/* Already there. Two steps can differ only in their slide — same focus, same
   view, same rotation — and flying between them is not a shorter flight, it is
   a pointless one: the arc's radius bump has a floor, so the camera dollies out
   and back over the whole flightSeconds, with the controls disabled while it
   does. Position and target say it on their own; the spherical pair the flight
   interpolates in cannot differ if these do not. */
function sameView(cam, ctl, view, sx, sy) {
  const eps = Math.max(cam.position.distanceTo(ctl.target), 1) * 1e-4;
  return cam.position.distanceTo(view.pos) < eps && ctl.target.distanceTo(view.target) < eps
    && Math.abs((view.sx || 0) - sx) < 1e-4 && Math.abs((view.sy || 0) - sy) < 1e-4;
}
function stepIndexOf(steps, ref) {
  if (ref == null || ref === '') return -1;
  const byId = steps.findIndex(st => st && st.id && st.id === ref);
  if (byId >= 0) return byId;
  const n = +ref;
  return Number.isInteger(n) && n >= 0 && n < steps.length ? n : -1;
}
function linksHtml(s, steps) {
  const out = toList(s.links).map(l => {
    const j = l && stepIndexOf(steps, l.to);
    if (!(j >= 0)) return '';   // a link to a deleted step is dropped, not drawn dead
    return '<a class="sl-jump" data-goto="' + j + '" title="Go to step ' + pad(j + 1) + '">' + esc(l.label || steps[j].title || 'Step ' + pad(j + 1)) + '</a>';
  }).join('');
  return out ? '<div class="sl-links">' + out + '</div>' : '';
}
const body = (html, cls) => html ? '<div class="sl-body' + (cls ? ' ' + cls : '') + '">' + html + '</div>' : '';
const isNum = v => /^[\s\-+−±~≈<>]*[\d.,]+\s*[%a-zA-Zµ°·/²³]*\s*$/.test(String(v ?? ''));

const RENDER = {
  title(s, x) {
    const st = toList(s.specs).filter(r => r && (r[0] || r[1]));
    const cells = st.length ? '<div class="sl-figures" style="grid-template-columns:repeat(' + Math.min(4, st.length) + ',minmax(0,1fr))">' +
      st.map(([k, v]) => '<div><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('') + '</div>' : '';
    return CORNERS + x.head() + '<h1>' + esc(s.title) + '</h1>' + body(s.body) + cells;
  },
  section(s, x) {
    return CORNERS + x.head('on-dark') + '<div class="sl-bignum">' + esc(s.number ?? pad(x.i + 1)) + '</div><h2>' + esc(s.title) + '</h2>' + body(s.body);
  },
  /* An agenda. Each row may point at a step, and does it through the same
     id-keyed link plumbing as a jump button, so inserting steps cannot re-aim it. */
  chapters(s, x) {
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' + body(s.body) +
      '<ol class="sl-chap">' + toList(s.chapters).map((c, j) => {
        const k = stepIndexOf(x.steps, c.to);
        const inner = '<span class="n">' + esc(c.number ?? pad(j + 1)) + '</span><b>' + esc(c.title) + '</b>' +
          (c.note ? '<span class="note">' + esc(c.note) + '</span>' : '');
        return '<li class="st-' + esc(c.status || 'next') + '">' +
          (k >= 0 ? '<a data-goto="' + k + '">' + inner + '</a>' : '<span>' + inner + '</span>') + '</li>';
      }).join('') + '</ol>';
  },
  end(s, x) {
    return CORNERS + x.head('on-dark') + '<h1>' + esc(s.title || 'Questions') + '</h1>' + body(s.body);
  },
  card(s, x) {
    const fig = figure(x.url(s.image), s, 'sl-fig');
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' + (s.imageTop ? fig + body(s.body) : body(s.body) + fig) + specsTable(s);
  },
  split(s, x) {
    const fig = figure(x.url(s.image), s, 'sl-fig');
    const right = (s.imageTop ? fig + body(s.body2) : body(s.body2) + fig) + specsTable(s);
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2><div class="sl-cols"><div>' + body(s.body) + '</div><div>' + right + '</div></div>';
  },
  metrics(s, x) {
    const st = toList(s.stats);
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' + body(s.body) +
      '<div class="sl-stats" style="grid-template-columns:repeat(' + clamp(st.length > 4 ? Math.ceil(st.length / 2) : st.length, 1, 4) + ',minmax(0,1fr))">' +
      st.map(m => '<div><span class="lbl">' + esc(m.label) + '</span><span class="val">' + esc(m.value) + (m.unit ? '<small>' + esc(m.unit) + '</small>' : '') + '</span>' + (m.note ? '<span class="note">' + esc(m.note) + '</span>' : '') + '</div>').join('') + '</div>';
  },
  table(s, x) {
    const t = s.table || {}, cols = toList(t.columns), rows = toList(t.rows);
    const blank = v => v == null || /^\s*[-—–]?\s*$/.test(String(v));
    const num = cols.map((_, j) => j > 0 && rows.length > 0 && rows.some(r => !blank(r[j])) && rows.every(r => blank(r[j]) || isNum(r[j])));
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' + body(s.body) +
      '<table class="sl-table"><thead><tr>' + cols.map((c, j) => '<th' + (num[j] ? ' class="num"' : '') + '>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + cols.map((_, j) => '<td' + (num[j] ? ' class="num"' : '') + '>' + esc(r[j]) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  },
  compare(s, x) {
    const cols = toList(s.columns);
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' + body(s.body) +
      '<div class="sl-compare" style="grid-template-columns:repeat(' + clamp(cols.length, 1, 3) + ',minmax(0,1fr))">' +
      cols.map(c => '<div><h4>' + esc(c.title) + '</h4>' + body(c.body) + '</div>').join('') + '</div>';
  },
  checklist(s, x) {
    const ICON = { done: '✓', open: '', risk: '!', blocked: '×', info: 'i' };
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' + body(s.body) +
      '<ul class="sl-check">' + toList(s.items).map(it => {
        const st = ICON[it.status] !== undefined ? it.status : 'open';
        return '<li class="st-' + st + '"><span class="box">' + ICON[st] + '</span><span class="txt">' + esc(it.text) + (it.note ? '<small>' + esc(it.note) + '</small>' : '') + '</span>' +
          (it.status && it.status !== 'open' ? '<span class="tag">' + esc(st) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
  },
  code(s, x) {
    const lines = String(s.code ?? '').replace(/\s+$/, '').split('\n');
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' +
      '<div class="sl-code"><div class="lang">' + esc(s.lang || 'code') + '</div><pre>' + lines.map(l => '<span>' + (esc(l) || ' ') + '</span>').join('\n') + '</pre></div>' + body(s.body, 'sl-cap');
  },
  image(s, x) {
    const src = x.url(s.image);
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' +
      (src ? '<figure class="blueprint sl-bigfig"' + figVars(s) + '>' + CORNERS + '<img src="' + esc(src) + '" alt="' + esc(s.imageAlt) + '"></figure>'
        : '<div class="sl-bigfig sl-empty">No image</div>') + body(s.body, 'sl-cap');
  },
  /* Slides are real DOM, so a <video> here is a real video element: it plays in
     place, in 3D. showSlide() starts and stops it with the step. */
  video(s, x) {
    const src = x.url(s.video);
    const att = (s.controls === false ? '' : ' controls') + (s.loop === false ? '' : ' loop') + (s.sound ? '' : ' muted');
    return CORNERS + x.head() + '<h2>' + esc(s.title) + '</h2>' +
      (src ? '<figure class="blueprint sl-bigfig sl-vid"' + figVars(s) + '>' + CORNERS + '<video src="' + esc(src) + '"' + att + ' playsinline preload="metadata"></video></figure>'
        : '<div class="sl-bigfig sl-empty">No video</div>') + body(s.body, 'sl-cap');
  },
  timeline(s, x) {
    const ms = toList(s.milestones);
    return CORNERS + '<div class="sl-tl-top">' + x.head() + '<h3>' + esc(s.title) + '</h3></div>' +
      '<ol class="sl-tl" style="grid-template-columns:repeat(' + Math.max(1, ms.length) + ',minmax(0,1fr))">' +
      ms.map(m => '<li class="st-' + esc(m.status || 'next') + '"><span class="date">' + esc(m.date) + '</span><span class="dot"></span><b>' + esc(m.title) + '</b>' + (m.body ? '<span class="note">' + esc(m.body) + '</span>' : '') + '</li>').join('') + '</ol>';
  },
  caption(s, x) {
    return CORNERS + '<div class="sl-capl"><span class="k">' + esc(s.kicker) + '</span><h3>' + esc(s.title) + '</h3></div>' + body(s.body) +
      '<span class="sl-capn">' + pad(x.i + 1) + ' / ' + pad(x.n) + '</span>';
  },
};
function pinEl(w, h, inner, cls) {
  // Leader line anchored at the element's bottom-left corner; layout() pins that corner to the anchor point.
  const el = document.createElement('div');
  el.className = 'sl-pin ' + cls;
  el.style.width = w + 'px'; el.style.height = h + 'px';
  const k = w / 600;
  el.innerHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" fill="none" stroke-width="1.5"><polyline points="0,' + h + ' ' + 130 * k + ',' + (h - 130 * k) + ' ' + 210 * k + ',' + (h - 130 * k) + '"></polyline><circle cx="0" cy="' + h + '" r="' + 7 * Math.max(k, 0.8) + '"></circle><path d="M-14 ' + h + 'h28M0 ' + (h - 14) + 'v28" stroke-width="1"></path></svg>' +
    '<div class="blueprint sl-pinbox">' + inner + '</div>';
  el.hit = el.lastChild;
  return el;
}
function setPinSide(el, left) {
  if (el._left === left) return; el._left = left;
  el.firstChild.style.transform = left ? 'scaleX(-1)' : '';
  el.lastChild.style.left = left ? '0' : ''; el.lastChild.style.right = left ? '' : '0';
}

// ---------- engine ----------
class DeckEngine {
  constructor(host, opts, onState) {
    this.host = host; this.opts = opts || {}; this.onState = onState;
    // Theme vars land on the element that wraps everything the deck paints: the
    // document in an exported file, only the preview stage inside the editor.
    this.themeRoot = this.opts.themeRoot || host; this.theme = null;
    this.assets = this.opts.assets || {};
    this.state = { loading: true, error: null, notice: null, steps: [], current: 0, overview: false, bare: false, orbited: false, title: '', subtitle: '' };
    this.meshes = []; this.slides = []; this.highlight = []; this.hidden = [];
    this.modelInfo = { parts: [], nodes: [], meshes: 0, triangles: 0, kind: 'none' };
  }
  setState(p) { Object.assign(this.state, p); this.onState && this.onState(this.state, this); }
  start() {
    try { this.init(); } catch (e) { console.error(e); this.setState({ loading: false, error: String(e.message || e) }); }
  }
  destroy() {
    this.dead = true; cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.ro && this.ro.disconnect(); this.renderer && this.renderer.dispose();
    this.host.innerHTML = '';
  }

  init() {
    const host = this.host, w = host.clientWidth || 800, h = host.clientHeight || 450;
    const renderer = this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!this.opts.preserveDrawingBuffer });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.localClippingEnabled = true;
    renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block';
    /* Slides are DOM, the model is WebGL, and the two cannot interleave by depth
       inside one layer. So there are two CSS3D layers and the canvas sits between
       them: a slide marked `behind` goes in the back layer and the model, drawn on
       a transparent canvas above it, occludes it. Occlusion is per slide, not per
       pixel — a back slide is wholly behind the model, never half-way through it. */
    const mkCSS = () => { const r = new CSS3DRenderer(); r.setSize(w, h); r.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none'; return r; };
    const cssBack = this.cssBack = mkCSS();
    host.appendChild(cssBack.domElement);
    host.appendChild(renderer.domElement);
    const css = this.css = mkCSS();
    host.appendChild(css.domElement);

    // The stress legend is plain DOM over the lot: shown only while a step paints a field.
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'stress-legend'; this.legendEl.hidden = true;
    host.appendChild(this.legendEl);

    const scene = this.scene = new T.Scene(); this.cssScene = new T.Scene(); this.cssSceneBack = new T.Scene();
    const pmrem = new T.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new T.HemisphereLight(0xffffff, 0x8899aa, 0.5));
    const dl = new T.DirectionalLight(0xffffff, 1.1); dl.position.set(5, 8, 6); scene.add(dl);

    const camera = this.camera = new T.PerspectiveCamera(40, w / h, 0.1, 500);
    camera.position.set(-16, 8, 20);
    const controls = this.controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.5; controls.maxDistance = 90;
    controls.addEventListener('start', () => { if (!this.flight && !this.state.orbited) this.setState({ orbited: true }); });

    const grid = this.grid = new T.GridHelper(40, 40, 0x98989b, 0xd4d4d7);
    grid.material.transparent = true; grid.material.opacity = 0.6; scene.add(grid);

    // Section cut: one clipping plane shared by every model material; animated in tick().
    this.clip = new T.Plane(new T.Vector3(-1, 0, 0), 1e6);
    this.cut = { axis: 'x', flip: false, cur: 1e6, target: 1e6 };
    this.explode = { cur: 0, target: 0, last: 0 };
    // Model orientation per step, eased in tick(); `measured` is the angle set the mesh boxes were taken at.
    this.rot = { cur: [0, 0, 0], target: [0, 0, 0] };
    this.measured = null;
    this.model = new T.Group(); scene.add(this.model);

    this.applyConfig(this.opts.config, true);

    this.onKey = e => {
      if (this.opts.keys === false || this.keysOff) return;
      if (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return;
      this.handleKey(e);
    };
    window.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    // A slide whose height follows its content is measured, and text measured in
    // a fallback font is the wrong height. Lay out again once the real one lands.
    if (document.fonts) document.fonts.ready.then(() => { if (!this.dead && this.slides.length) this.layout(); });
    this.last = performance.now();
    const loop = now => { if (this.dead) return; this.raf = requestAnimationFrame(loop); this.tick(now); };
    this.raf = requestAnimationFrame(loop);
  }
  handleKey(e) {
    const k = e.key, n = this.slides.length;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(k)) { e.preventDefault(); this.next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(k)) { e.preventDefault(); this.prev(); }
    else if (k === 'o' || k === 'O' || k === 'Escape') this.toggleOverview();
    else if (k === 'Home') this.goTo(0);
    else if (k === 'End') this.goTo(n - 1);
    else if (k === 'm' || k === 'M') this.toggleBare();
    else if (k === 'r' || k === 'R') this.resetView();
    else return false;
    return true;
  }

  // Hot reload: slides are rebuilt every time; the model only when its config changed.
  setConfig(cfg, assets) {
    if (assets) this.assets = assets;
    if (!this.renderer) { this.opts.config = cfg; return; }
    this.applyConfig(cfg, false);
  }
  applyConfig(cfg, first) {
    if (!cfg || !Array.isArray(cfg.steps)) throw new Error('The deck data is missing or has no "steps" list.');
    this.cfg = cfg;
    this.props = Object.assign({}, cfg.settings || {}, this.opts.props || {});
    // Render resolution: device pixels per CSS pixel. Unset = the screen's own
    // ratio capped at 2; above that it is pure supersampling, which is what
    // cleans up the jagged silhouette of a coarse CAD mesh. Costs the square.
    const px = clamp(+this.props.resolution || Math.min(devicePixelRatio, 2), 0.5, 4);
    if (this.renderer.getPixelRatio() !== px) this.renderer.setPixelRatio(px);
    this.theme = applyTheme(this.themeRoot, cfg.theme);
    this.themeMeshes();
    /* Only geometry belongs in the reload key. `fields` are baked results;
       parts, groups and materials are names, lists and colours — all of them are
       re-applied to the meshes in place, so none may cost a model reload. */
    const key = JSON.stringify(cfg.model ? Object.assign({}, cfg.model, { fields: 0, parts: 0, groups: 0, materials: 0 }) : null);
    const tagKey = tagKeyOf(cfg.model);
    if (key !== this.modelKey) { this.modelKey = key; this.loadModelFromConfig(cfg.model || null); }
    else if (tagKey !== this.tagKey) { this.tagKey = tagKey; this.retagMeshes(cfg.model); }
    this.buildSlides();
    this.layout();
    const n = this.slides.length;
    const i = first ? this.initialIndex(n) : clamp(this.state.current, 0, Math.max(0, n - 1));
    this.setState({ loading: false, error: null, title: cfg.title || '', subtitle: cfg.subtitle || '', steps: cfg.steps });
    if (!n) { this.setState({ current: 0 }); this.fly(this.overviewView, true); return; }
    if (this.state.overview && !first) this.showOverview(true);
    else if (first || !this.state.orbited) this.goTo(i, first || !this.flight);
    else { this.applyStep(i); this.setState({ current: i }); }
  }
  initialIndex(n) {
    let idx = this.opts.startIndex || 0;
    if (this.opts.remember) {
      const h = parseInt((location.hash || '').slice(1), 10);
      if (h >= 1) idx = h - 1;
      else try { idx = parseInt(localStorage.getItem(this.storeKey()) || '0', 10); } catch (e) { }
    }
    return idx >= 0 && idx < n ? idx : 0;
  }
  storeKey() { return 'deck-step:' + location.pathname + ':' + (this.cfg.title || ''); }

  // ---------- assets ----------
  assetBuf(id) {
    const a = this.assets[id]; if (!a) return null;
    if (!a.buf && a.b64) a.buf = b64ToBuf(a.b64);
    return a.buf || null;
  }
  assetUrl(ref) {
    if (!ref) return '';
    if (!/^asset:/.test(ref)) return ref;
    const id = ref.slice(6), a = this.assets[id];
    if (!a) return '';
    if (!a.url) { const buf = this.assetBuf(id); if (!buf) return ''; a.url = URL.createObjectURL(new Blob([buf], { type: a.mime || 'application/octet-stream' })); }
    return a.url;
  }

  // ---------- slides ----------
  buildSlides() {
    // A detached <video> keeps playing, so stop the outgoing ones before dropping them.
    for (const sl of this.slides) { if (sl.vid) sl.vid.pause(); for (const p of sl.parts) p.obj.parent && p.obj.parent.remove(p.obj); }
    const steps = this.cfg.steps, n = steps.length;
    this.slides = steps.map((s, i) => {
      const type = typeOf(s), t = TYPES[type], parts = [];
      const x = { i, n, steps, head: cls => head(s, i, n, cls), url: r => this.assetUrl(r) };
      const click = e => {
        const a = e && e.target && e.target.closest && e.target.closest('[data-goto]');
        // A jump reports the step it lands on, so the editor's selection follows it too.
        if (a) { e.preventDefault(); e.stopPropagation(); const j = +a.dataset.goto; this.opts.onSlideClick && this.opts.onSlideClick(j); this.goTo(j); return; }
        this.opts.onSlideClick && this.opts.onSlideClick(i); if (this.state.overview || this.state.current !== i) this.goTo(i);
      };
      if (type === 'labels') {
        for (const lab of toList(s.labels)) {
          const el = pinEl(t.w, t.h, '<b>' + esc(lab.text) + '</b>' + (lab.note ? '<span>' + esc(lab.note) + '</span>' : ''), 'sl-label');
          this.slideAccent(el, lab.accent ? lab : s);
          el.hit.addEventListener('click', click);
          parts.push({ el, wrap: wrapSlide(el, t.w), hit: el.hit, label: lab });
        }
      } else if (type === 'callout') {
        const el = pinEl(t.w, t.h, x.head() + '<h3>' + esc(s.title) + '</h3>' + body(s.body) + specsTable(s) + linksHtml(s, steps), 'sl-callout');
        this.slideAccent(el, s);
        el.hit.addEventListener('click', click);
        parts.push({ el, wrap: wrapSlide(el, t.w), hit: el.hit });
      } else {
        const el = document.createElement('div');
        el.className = 'blueprint sl sl-' + type;
        this.slideAccent(el, s);
        const box = sizeOf(s, t);
        el.style.width = box.w + 'px'; el.style.minHeight = box.h + 'px';
        // Several types push their last block down with margin-top:auto, which
        // eats the free space before justify-content ever sees it. Placing the
        // content by hand means giving that space back.
        if (JUSTIFY[s.vAlign]) { el.style.setProperty('--sl-just', JUSTIFY[s.vAlign]); el.style.setProperty('--sl-auto', '0'); }
        el.innerHTML = RENDER[type](s, x) + linksHtml(s, steps);
        el.addEventListener('click', click);
        parts.push({ el, wrap: wrapSlide(el, box.w) });
      }
      const layer = s.behind ? this.cssSceneBack : this.cssScene;
      // CSS3DObject's constructor sets pointerEvents:auto inline, which outranks
      // the stylesheet; clear it so the camera gets the whole view and only the
      // .pickable descendants opt back in.
      for (const p of parts) { p.obj = new CSS3DObject(p.wrap); p.wrap.style.pointerEvents = 'none'; layer.add(p.obj); }
      return { cfg: s, type, parts, vid: parts[0] && parts[0].el.querySelector('video') };
    });
  }
  // A step may borrow another role for its accent: re-point --color-accent* on
  // that one slide element and every rule in deck.css follows.
  slideAccent(el, s) {
    const t = this.theme, key = roleKey(s.accent);
    if (!t || !key || key === t.accent || !t.ramps[key]) return;
    setRamp(el, 'accent', t.ramps[key]);
    el.style.setProperty('--color-accent', trimOf(t.ramps[key]));
  }
  // Highlight glow and edge lines follow the accent, whichever order the model
  // and the theme arrive in — swapIn and applyConfig both call this.
  themeMeshes() {
    const t = this.theme; if (!t) return;
    const em = new T.Color(t.acc[Math.min(1, t.acc.length - 1)]), ed = new T.Color(trimOf(t.acc));
    for (const o of this.meshes) {
      const mt = o.m.material;
      if (mt.emissive && !mt.emissiveMap) mt.emissive.copy(em);
      if (o.e) o.e.material.color.copy(ed);
    }
  }
  sideOf(s) {
    const t = TYPES[typeOf(s)];
    if (t.place === 'center' || t.place === 'labels') return 'center';
    if (t.place === 'pin') return s.side === 'left' ? 'left' : 'right';
    let side = s.side || t.defSide || 'left';
    if (!['left', 'right', 'center', 'bottom'].includes(side)) side = 'left';
    if ((side === 'left' || side === 'right') && (this.camera.aspect || 1.6) < 1.15) side = 'center';
    return side;
  }

  // ---------- model geometry queries ----------
  partBox(names, ex) {
    const box = new T.Box3(), tmp = new T.Box3();
    for (const o of this.meshes) if (tagged(o, names) && o.box) {
      tmp.copy(o.box); if (ex && o.wdir) tmp.translate(o.wdir.clone().multiplyScalar(ex));
      box.union(tmp);
    }
    return box;
  }
  partCenter(name, ex) { const b = this.partBox([name], ex); return b.isEmpty() ? null : b.getCenter(new T.Vector3()); }
  parts() { return [...new Set(this.meshes.map(o => o.part).filter(Boolean))]; }

  /* Re-derive part names, groups and base materials on the meshes already
     loaded. Naming a part used to go through the reload key, so every keystroke
     in the editor re-parsed the model and re-smoothed it; none of these three
     touches geometry. onModel only fires if the part list actually moved, so an
     edit the UI need not redraw for does not redraw it. */
  retagMeshes(m, quiet) {
    if (!this.meshes.length) return;
    m = m || {};
    const parts = m.parts || {}, keys = Object.keys(parts), groups = m.groups || {}, mats = m.materials || {};
    for (const o of this.meshes) {
      o.part = partOf(o.m, parts, keys);
      o.tags = tagsOf(o.part, groups);
      applyBaseMat(o.m.material, o.tags.reduce((v, t) => v ?? mats[t], undefined) || mats['*'], o.mat0);
      o.baseOp = o.m.material.opacity ?? 1;
      o.base = null;                                  // applyColors caches the restore colour, and it just changed
    }
    this.applyColors(((this.cfg.steps || [])[this.state.current] || {}).colors);
    if (quiet) return;                                // swapIn reports the whole model itself, a line later
    const was = (this.modelInfo && this.modelInfo.parts || []).join('\n'), now = this.parts();
    if (now.join('\n') === was) return;
    this.modelInfo = Object.assign({}, this.modelInfo, { parts: now });
    this.opts.onModel && this.opts.onModel(this.modelInfo);
  }

  // Camera view for a step. With "focus", the orbit pivot is the centre of those parts, the distance fits
  // them, and the projection is shifted so the pivot sits in the free part of the screen.
  viewFor(s) {
    const v = s.view || {}, type = typeOf(s), side = this.sideOf(s), focus = toList(s.focus), ex = +s.explode || 0;
    const target = new T.Vector3(); let rad = 0;
    if (focus.length) { const b = this.partBox(focus, ex); if (!b.isEmpty()) { b.getCenter(target); rad = b.getBoundingSphere(new T.Sphere()).radius; } }
    if (v.target) target.set(...v.target);
    if (v.offset) target.add(new T.Vector3(...v.offset));
    let sx = 0, sy = 0;
    if ((side === 'left' || side === 'right') && type !== 'callout') sx = (v.shift ?? (focus.length ? 0.2 : 0)) * (side === 'left' ? 1 : -1);
    else if (side === 'bottom') sy = v.shiftY ?? (focus.length ? 0.14 : 0.1);
    let d = v.distance;
    if (d == null) {
      if (rad) {
        const tanH = Math.tan(this.camera.fov * D2R / 2), a = this.camera.aspect || 1.6;
        const k = type === 'callout' ? 0.42 : type === 'labels' ? 0.5 : TYPES[type].place === 'center' ? 0.8 : side === 'center' ? 0.55 : side === 'bottom' ? 0.42 : Math.min(0.9, a * 0.5);
        d = Math.max(1.2, rad / (tanH * k) * (v.fit ?? 1));
      } else d = 12 * (v.fit ?? 1);
    }
    const az = (v.azimuth ?? 0) * D2R, el = (v.elevation ?? 15) * D2R;
    const pos = target.clone().add(new T.Vector3(d * Math.cos(el) * Math.sin(az), d * Math.sin(el), d * Math.cos(el) * Math.cos(az)));
    return { pos, target, sx, sy };
  }
  // The current camera, expressed as a step "view" (what "Use this view" writes).
  captureView(s) {
    const cam = this.camera, ctl = this.controls;
    const off = cam.position.clone().sub(ctl.target), d = off.length();
    const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
    const view = Object.assign({}, (s && s.view) || {});
    view.azimuth = r1(Math.atan2(off.x, off.z) / D2R);
    view.elevation = r1(Math.asin(clamp(off.y / d, -1, 1)) / D2R);
    view.distance = r2(d);
    delete view.fit;
    if (s) {
      const base = this.viewFor(Object.assign({}, s, { view: { azimuth: 0, elevation: 0, distance: 1 } })).target;
      if (base.distanceTo(ctl.target) > 0.01) { view.target = ctl.target.toArray().map(r2); delete view.offset; }
      else delete view.target;
    }
    return view;
  }

  // Slides float in space parallel to their view plane: panels between camera and object,
  // centred slides across the view, callouts and labels pinned to their anchor points.
  layout() {
    const cam = this.camera, tanH = Math.tan(cam.fov * D2R / 2), aspect = cam.aspect || 1.6, up = new T.Vector3(0, 1, 0);
    const H = this.host.clientHeight || 450;
    for (const sl of this.slides) {
      const s = sl.cfg; this.measureFor(s.rotate); sl.view = this.viewFor(s);
      const { pos, target, sx, sy } = sl.view, t = TYPES[sl.type], side = this.sideOf(s), ex = +s.explode || 0;
      const f = target.clone().sub(pos); const D = f.length() || 1; f.normalize();
      const r = f.clone().cross(up); if (r.lengthSq() < 1e-6) r.set(1, 0, 0); r.normalize();
      const u = r.clone().cross(f);
      /* A CSS3D slide is rasterised at its own CSS width and then stretched by the
         3D transform. Once a slide lands wider on screen than it is in CSS, that
         stretch is a blur — worst on the types whose design width is smallest
         relative to how much screen they take (section, caption, timeline). `zoom`
         re-lays the element out larger, which rasterises it crisply, so the
         transform is left scaling down. Scaling down was already sharp, hence the
         lower clamp of 1. */
      const place = (obj, p, wW, w, wrap, d) => {
        zoomSlide(wrap, zoomFor(wW / (2 * Math.max(d, 1e-3) * tanH) * H / w));
        obj.position.copy(p); obj.up.copy(u); obj.lookAt(p.clone().sub(f)); obj.scale.setScalar(wW / (w * wrap.zoomK));
      };
      /* Per-step placement, on top of whatever the type does by itself: `size`
         scales the slide's share of the view, `dx`/`dy` nudge it across and up
         in percent of the visible frame. Both default to the type's own layout,
         so a deck that sets neither looks exactly as it did. */
      const k = clamp(+s.size || 1, 0.4, 2.5), dxp = (+s.dx || 0) / 100, dyp = (+s.dy || 0) / 100;
      if (t.place === 'labels' || t.place === 'pin') {
        for (const p of sl.parts) {
          let anchor = target.clone(), left = side === 'left';
          if (p.label) {
            const c = p.label.part && this.partCenter(p.label.part, ex);
            if (c) anchor = c;
            if (p.label.offset) anchor.add(new T.Vector3(...p.label.offset));
            left = p.label.side ? p.label.side === 'left' : anchor.clone().sub(target).dot(r) < -1e-3;
          }
          const depth = Math.max(0.5, anchor.clone().sub(pos).dot(f));
          const vH = 2 * depth * tanH, hW = vH * (p.label ? 0.17 : 0.34) * k, wW = hW * t.w / t.h;
          setPinSide(p.el, left);
          place(p.obj, anchor.clone().addScaledVector(r, (left ? -1 : 1) * wW / 2 + dxp * vH * aspect).addScaledVector(u, hW / 2 + dyp * vH), wW, t.w, p.wrap, depth);
        }
        continue;
      }
      /* The slide's design box drives the on-screen one. A slide set to fit its
         content has no design height to drive it, so measure the height it
         actually has: as a share of its own width, which the element's zoom
         cancels out of and a raw offsetHeight would not. */
      const b = sizeOf(s, t), el0 = sl.parts[0].el;
      const designH = b.fit && el0.offsetWidth ? el0.offsetHeight / el0.offsetWidth * b.w : (b.h || t.h);
      const ratio = b.w / Math.max(designH, 1), ds = D * 0.5, visH = 2 * ds * tanH, visW = visH * aspect;
      let hW, offX = 0, offY = 0;
      if (t.place === 'center') hW = Math.min(visH * 0.66, visW * 0.8 / ratio) * k;
      else if (side === 'center') { hW = Math.min(visH * 0.62, visW * 0.88 / ratio) * k; offY = visH * 0.12; }
      else if (side === 'bottom') { hW = Math.min(visH * 0.4, visW * 0.86 / ratio) * k; offY = -(visH / 2 - hW / 2 - visH * 0.135); }
      else {
        const frac = t.frac || 0.44;
        hW = Math.min(visH * (frac > 0.5 ? 0.8 : 0.72), visW * frac / ratio) * k;
        offX = (visW / 2 - hW * ratio / 2 - visW * 0.05) * (side === 'left' ? -1 : 1); offY = -visH * 0.02;
      }
      offX += dxp * visW; offY += dyp * visH;
      offX -= sx * visW; offY -= sy * visH; // cancel the projection shift so the slide stays put on screen
      place(sl.parts[0].obj, pos.clone().addScaledVector(f, ds).addScaledVector(r, offX).addScaledVector(u, offY), hW * ratio, b.w, sl.parts[0].wrap, ds);
    }
    // back to the step on screen, not to whichever slide the loop ended on
    const cur = this.slides[this.state.current];
    this.measureFor(cur && cur.cfg.rotate);
    const box = new T.Box3();
    if (this.modelBox && !this.modelBox.isEmpty()) box.copy(this.modelBox); else box.setFromCenterAndSize(new T.Vector3(), new T.Vector3(6, 4, 6));
    this.slides.forEach(sl => { if (sl.type !== 'labels') sl.parts.forEach(p => box.expandByPoint(p.obj.position)); });
    const c = box.getCenter(new T.Vector3()), rad = box.getSize(new T.Vector3()).length() / 2;
    const fovMin = Math.min(cam.fov * D2R, 2 * Math.atan(tanH * aspect));
    const d = rad / Math.sin(fovMin / 2) * 0.95, az = 0.5, el = 0.55;
    this.overviewView = { sx: 0, sy: 0, target: c, pos: c.clone().add(new T.Vector3(d * Math.cos(el) * Math.sin(az), d * Math.sin(el), d * Math.cos(el) * Math.cos(az))) };
  }

  // Projection shift (fraction of the viewport) via the camera view offset; CSS3DRenderer honours it too.
  setShift(sx, sy) {
    this.sx = sx; this.sy = sy;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if ((sx || sy) && w && h) this.camera.setViewOffset(w, h, -sx * w, sy * h, w, h); else this.camera.clearViewOffset();
  }
  fly(view, instant) {
    if (!view) return;
    const cam = this.camera, ctl = this.controls;
    if (instant || sameView(cam, ctl, view, this.sx || 0, this.sy || 0)) {
      cam.position.copy(view.pos); ctl.target.copy(view.target); cam.lookAt(view.target); this.setShift(view.sx || 0, view.sy || 0);
      this.flight = null; ctl.enabled = true; return;
    }
    const s0 = new T.Spherical().setFromVector3(cam.position.clone().sub(ctl.target));
    const s1 = new T.Spherical().setFromVector3(view.pos.clone().sub(view.target));
    let dth = s1.theta - s0.theta; dth = ((dth + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const dur = (this.props.flightSeconds ?? 1.6) * 1000;
    this.flight = { t0: performance.now(), dur, fromT: ctl.target.clone(), toT: view.target.clone(), r0: s0.radius, r1: s1.radius, th0: s0.theta, dth, ph0: s0.phi, ph1: s1.phi,
      sx0: this.sx || 0, sx1: view.sx || 0, sy0: this.sy || 0, sy1: view.sy || 0, bump: Math.min(0.35, 0.08 + Math.abs(dth) * 0.12) };
    ctl.enabled = false;
  }

  goTo(i, instant) {
    const n = this.slides.length; if (!n) return;
    i = clamp(i, 0, n - 1);
    if (this.opts.remember) try { localStorage.setItem(this.storeKey(), String(i)); } catch (e) { }
    this.applyStep(i);
    this.setState({ current: i, overview: false, orbited: false });
    this.fly(this.slides[i].view, instant);
  }
  // Model state for a step: highlight, colours, hidden parts, section cut, explode; plus slide visibility.
  applyStep(i) {
    const sl = this.slides[i]; if (!sl) return;
    const c = sl.cfg;
    this.highlight = Array.isArray(c.highlight) ? c.highlight : toList(c.focus);
    this.hidden = toList(c.hide);
    this.setRotation(c.rotate);
    this.applyColors(c.colors);
    this.setStress(c.stress);
    this.setCut(c.cut);
    this.setExplode(+c.explode || 0);
    this.showSlides(i);
  }
  /* Only this step's slide is shown. `ghosts` leaves the others faintly in
     space; pinned types stay hidden either way, since a callout or a label off
     its own step is a leader line pointing at nothing. `bare` hides the lot, so
     the model can be looked at on its own without leaving the step. */
  showSlides(i) {
    if (this.state.bare) return this.slides.forEach(o => this.showSlide(o, 0));
    if (this.state.overview) return this.slides.forEach(o => this.showSlide(o, o.type === 'labels' ? 0 : 1));
    const ghost = this.props.ghosts ? (this.opts.dim ?? 0.14) : 0;
    this.slides.forEach((o, j) => this.showSlide(o, j === i ? 1 : (o.type === 'callout' || o.type === 'labels') ? 0 : ghost));
  }
  applyColors(map) {
    for (const o of this.meshes) {
      const mt = o.m.material; if (!mt.color) continue;
      o.base = o.base || mt.color.clone();
      const c = map && (o.tags.reduce((v, t) => v ?? map[t], undefined) ?? map['*']);
      o.tc = c && c !== 'original' ? new T.Color(c) : o.base.clone();
    }
  }
  /* A baked stress field: one 16-bit scalar per vertex, over every mesh in
     swapIn's order. Its length is the integrity check — a different vertex
     count means a different model, and painting it anyway would be inventing
     measurements. */
  fieldOf(fieldName) {
    const cfg = ((this.cfg.model || {}).fields || {})[fieldName];
    if (!cfg || !cfg.asset || !this.vertexCount) return null;   // no model yet: nothing to paint, and nothing to warn about
    const cache = this.fieldCache || (this.fieldCache = {});
    if (cache[cfg.asset] === undefined) {               // by asset, so a re-bake under the same name is seen
      const buf = this.assetBuf(cfg.asset);
      const q = buf && buf.byteLength >= 2 ? new Uint16Array(buf, 0, buf.byteLength >> 1) : null;
      cache[cfg.asset] = q && q.length === this.vertexCount ? q : null;
      if (!cache[cfg.asset]) console.warn('Stress field "' + fieldName + '": ' + (q ? q.length + ' values for ' + this.vertexCount + ' vertices' : 'no data') + ', ignoring.');
    }
    // Only the array is cached; the range and unit are read fresh, so editing them takes effect at once.
    const q = cache[cfg.asset];
    return q ? { q, lo: +cfg.lo || 0, hi: cfg.hi === undefined ? 1 : +cfg.hi, unit: cfg.unit || '' } : null;
  }
  /* Paint the field onto the meshes as a vertex-colour attribute and let
     material.color go white, so opacity, the clip plane, explode and the
     highlight fade all keep working exactly as they do without it. */
  setStress(st) {
    const f = st && st.field ? this.fieldOf(st.field) : null;
    if (!f) {
      if (this.stressOn) for (const o of this.meshes) {
        if (!o.stressWas) continue;
        o.stressWas = false;
        if (o.baseColorAttr) o.m.geometry.setAttribute('color', o.baseColorAttr); else o.m.geometry.deleteAttribute('color');
        o.m.material.vertexColors = o.baseVC; o.m.material.needsUpdate = true;
      }
      this.stressOn = false; this.showLegend(null); return;
    }
    const num = v => v === undefined || v === null || v === '' || isNaN(+v) ? null : +v;
    const lo = num(st.min) ?? f.lo, hi = num(st.max) ?? f.hi;
    const span = hi > lo ? hi - lo : 1, step = (f.hi - f.lo) / 65534, c = new T.Color();
    feaColor(0, c);                                     // forces the ramp (and GREY) to exist
    for (const o of this.meshes) {
      const g = o.m.geometry, n = o.vCount;
      let attr = o.stressAttr;
      if (!attr || attr.count !== n) attr = o.stressAttr = new T.BufferAttribute(new Float32Array(n * 3), 3);
      const arr = attr.array;
      for (let i = 0; i < n; i++) {
        const q = f.q[o.vOff + i];
        if (q) feaColor((f.lo + (q - 1) * step - lo) / span, c); else c.copy(GREY);
        arr[3 * i] = c.r; arr[3 * i + 1] = c.g; arr[3 * i + 2] = c.b;
      }
      attr.needsUpdate = true;
      if (!o.stressWas) { o.baseColorAttr = g.getAttribute('color') || null; o.baseVC = !!o.m.material.vertexColors; o.stressWas = true; }
      g.setAttribute('color', attr);
      if (!o.m.material.vertexColors) { o.m.material.vertexColors = true; o.m.material.needsUpdate = true; }
      o.tc = new T.Color(1, 1, 1);                      // tick() eases material.color here; white lets the vertex colours through
    }
    this.stressOn = true;
    this.showLegend({ lo, hi, unit: f.unit, label: st.field });
  }
  // The bar's gradient comes from the same array the meshes are painted from.
  showLegend(x) {
    const el = this.legendEl; if (!el) return;
    if (!x) { el.hidden = true; return; }
    const ticks = [];
    for (let i = 4; i >= 0; i--) ticks.push('<span>' + fmtVal(x.lo + (x.hi - x.lo) * i / 4) + '</span>');
    el.innerHTML = '<div class="sg-bar"></div><div class="sg-ticks">' + ticks.join('') + '</div>' +
      '<div class="sg-unit">' + esc(x.label) + (x.unit ? ' · ' + esc(x.unit) : '') + '</div>';
    el.firstChild.style.background = 'linear-gradient(to top,' + FEA_HEX.join(',') + ')';
    el.hidden = false;
  }
  setCut(cut) {
    const c = this.cut, box = this.modelBox;
    if (!box || box.isEmpty()) { c.cur = c.target = 1e6; return; }
    const size = box.getSize(new T.Vector3()), eps = Math.max(size.x, size.y, size.z) * 0.02;
    const open = (a, fl) => fl ? box.min[a] - eps : box.max[a] + eps;
    if (cut && ['x', 'y', 'z'].includes(cut.axis)) {
      const fl = !!cut.flip;
      if (cut.axis !== c.axis || fl !== c.flip || Math.abs(c.cur) > 1e5) { c.axis = cut.axis; c.flip = fl; c.cur = open(c.axis, fl); }
      c.target = box.min[c.axis] + (box.max[c.axis] - box.min[c.axis]) * clamp(cut.at ?? 50, 0, 100) / 100;
    } else c.target = Math.abs(c.cur) > 1e5 ? (c.cur = 1e6) : open(c.axis, c.flip);
  }
  setExplode(x) {
    this.explode.target = x;
  }
  // Lay the model over for this step. tick() eases toward the angles, but the boxes are
  // measured at the target, so framing, labels and the cut plane aim where the model lands.
  setRotation(r) {
    this.rot.target = rotOf(r);
    this.measureFor(r);
  }
  measureFor(r) {
    const a = rotOf(r);
    if (this.measured && a.every((v, i) => v === this.measured[i])) return;
    this.measure(a);
  }
  /* Mesh boxes, model box and explode directions, taken with the model at `at` and with the
     explode offsets undone, since partBox() adds the offset itself. Directions come out in
     each mesh's local frame, so they stay right as the model turns. */
  measure(at) {
    const meshes = this.meshes || [], model = this.model;
    if (!model) return;
    const keep = model.rotation.clone();
    for (const o of meshes) if (o.basePos) o.m.position.copy(o.basePos);
    if (at) model.rotation.set(at[0], at[1], at[2]);
    model.updateMatrixWorld(true);
    const mbox = new T.Box3();
    for (const o of meshes) { o.box = new T.Box3().setFromObject(o.m, true); mbox.union(o.box); }
    this.modelBox = mbox;
    // Explode directions: each part (or each unassigned mesh) moves away from the model centre.
    const mc = mbox.isEmpty() ? new T.Vector3() : mbox.getCenter(new T.Vector3()), groups = new Map();
    meshes.forEach((o, i) => { const key = o.part || '#' + i; if (!groups.has(key)) groups.set(key, new T.Box3()); groups.get(key).union(o.box); });
    for (const [key, b] of groups) groups.set(key, b.getCenter(new T.Vector3()).sub(mc));
    meshes.forEach((o, i) => { o.wdir = groups.get(o.part || '#' + i); });
    this.localDirs();
    this.measured = at ? at.slice() : [keep.x, keep.y, keep.z];
    model.rotation.copy(keep); model.updateMatrixWorld(true);
    this.explode.last = -1;   // positions were reset above: let tick() re-apply the offsets
  }
  showOverview(instant) {
    this.highlight = []; this.hidden = [];
    this.applyColors(null); this.setCut(null); this.setExplode(0);
    this.setState({ overview: true, orbited: false });
    this.showSlides(this.state.current);
    this.fly(this.overviewView, instant);
  }
  // Hide every slide and leave the camera alone: the point is to see what the
  // slide you are on is covering, so it stays on across steps until turned off.
  toggleBare() {
    if (!this.slides.length) return;
    this.setState({ bare: !this.state.bare });
    this.showSlides(this.state.current);
  }
  // Only the current slide (or every slide in overview) takes clicks, so faded slides never block orbiting.
  /* Sets a target, not a style: tick() eases toward it and multiplies in the
     orbit fade. Slides take clicks only in overview, where clicking one means
     "go to that step"; everywhere else the pointer belongs to the camera. */
  showSlide(sl, op) {
    sl.op = op;
    if (sl.cur === undefined) sl.cur = op;
    const pick = op >= 1 && this.state.overview;
    for (const p of sl.parts) p.wrap.classList.toggle('pickable', pick);
    // One video per slide at most, and only the step you are on: overview would play them all.
    if (sl.vid) {
      if (op >= 1 && !this.state.overview) { if (sl.cfg.autoplay !== false) sl.vid.play().catch(() => { }); }
      else sl.vid.pause();
    }
  }
  /* How far the camera has swung from this step's own view, as a 0..1 fade.
     Past `fadeAngle` degrees the slide starts going; it is gone half again as
     far. Not during a flight (the camera is on its way to the base view, so the
     deviation is meaningless) and not in overview (no step view to deviate
     from). 0 or unset turns it off. */
  slideFade() {
    const a = this.props.fadeAngle === undefined ? 35 : +this.props.fadeAngle;
    const sl = this.slides[this.state.current];
    if (!(a > 0) || !sl || this.flight || this.state.overview) return 1;
    const dev = this.camera.position.clone().sub(this.controls.target)
      .angleTo(sl.view.pos.clone().sub(sl.view.target)) / D2R;
    return 1 - clamp((dev - a) / Math.max(10, a * 0.5), 0, 1);
  }
  next() { if (!this.slides.length) return; this.state.overview ? this.goTo(this.state.current) : this.goTo(this.state.current + 1); }
  prev() { if (!this.slides.length) return; this.state.overview ? this.goTo(this.state.current) : this.goTo(this.state.current - 1); }
  toggleOverview() { if (!this.slides.length) return; this.state.overview ? this.goTo(this.state.current) : this.showOverview(); }
  resetView() { if (!this.slides.length) return; this.state.overview ? this.showOverview() : this.goTo(this.state.current); }

  resize() {
    const host = this.host; if (!host || !this.renderer) return;
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.css.setSize(w, h); this.cssBack.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.layout(); this.setShift(this.sx || 0, this.sy || 0);
    if (!this.state.orbited && !this.flight) this.fly(this.state.overview || !this.slides.length ? this.overviewView : this.slides[this.state.current].view, true);
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const cam = this.camera, ctl = this.controls;
    if (this.flight) {
      const f = this.flight, t = Math.min(1, (now - f.t0) / f.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      ctl.target.lerpVectors(f.fromT, f.toT, e);
      const r = (f.r0 + (f.r1 - f.r0) * e) * (1 + f.bump * Math.sin(Math.PI * e));
      const off = new T.Vector3().setFromSphericalCoords(r, f.ph0 + (f.ph1 - f.ph0) * e, f.th0 + f.dth * e);
      cam.position.copy(ctl.target).add(off); cam.lookAt(ctl.target);
      if (f.sx0 !== f.sx1 || f.sy0 !== f.sy1) this.setShift(f.sx0 + (f.sx1 - f.sx0) * e, f.sy0 + (f.sy1 - f.sy0) * e);
      if (t >= 1) { this.flight = null; ctl.enabled = true; }
    } else ctl.update();

    const k = 1 - Math.exp(-dt * 6), k2 = 1 - Math.exp(-dt * 3.5);
    // model rotation
    const rt = this.rot;
    if (rt.cur.some((v, i) => v !== rt.target[i])) {
      for (let i = 0; i < 3; i++) { const d = rt.target[i] - rt.cur[i]; rt.cur[i] = Math.abs(d) < 1e-4 ? rt.target[i] : rt.cur[i] + d * k2; }
      this.model.rotation.set(rt.cur[0], rt.cur[1], rt.cur[2]);
    }
    // explode
    const ex = this.explode;
    ex.cur += (ex.target - ex.cur) * k2; if (Math.abs(ex.target - ex.cur) < 1e-4) ex.cur = ex.target;
    if (ex.cur !== ex.last) { ex.last = ex.cur; for (const o of this.meshes) if (o.ldir) o.m.position.copy(o.basePos).addScaledVector(o.ldir, ex.cur); }
    // section cut
    const c = this.cut;
    if (Math.abs(c.cur) < 1e5) { c.cur += (c.target - c.cur) * k2; }
    this.clip.normal.set(0, 0, 0); this.clip.normal[c.axis] = c.flip ? 1 : -1; this.clip.constant = c.flip ? -c.cur : c.cur;
    this.grid.visible = this.props.showGrid ?? true;
    if (this.modelBox && !this.modelBox.isEmpty()) this.grid.position.y = this.modelBox.min.y - 0.3;

    const hl = this.highlight || [], any = hl.length > 0, hid = this.hidden || [];
    for (const o of this.meshes) {
      const on = tagged(o, hl), off = tagged(o, hid), mt = o.m.material;
      const tOp = off ? 0 : any && !on ? Math.min(o.baseOp, 0.16) : o.baseOp;
      const tEm = on && !off ? 0.45 : 0, tEdge = off ? 0 : on ? 0.95 : any ? 0.12 : o.baseEdge;
      mt.opacity += (tOp - mt.opacity) * k;
      if (o.tc) mt.color.lerp(o.tc, k);
      if (mt.emissiveIntensity !== undefined) mt.emissiveIntensity += (tEm - mt.emissiveIntensity) * k;
      mt.depthWrite = mt.opacity > 0.6;
      o.m.visible = mt.opacity > 0.005 || tOp > 0;
      if (o.e) o.e.material.opacity += (tEdge - o.e.material.opacity) * k;
    }
    const fade = this.slideFade();
    for (const sl of this.slides) {
      const want = (sl.op || 0) * fade;
      sl.cur += (want - sl.cur) * k2;
      if (Math.abs(want - sl.cur) < 0.004) sl.cur = want;
      if (sl.cur !== sl.shown) { sl.shown = sl.cur; for (const p of sl.parts) p.wrap.style.opacity = String(sl.cur); }
    }
    this.renderer.render(this.scene, cam);
    this.cssBack.render(this.cssSceneBack, cam);
    this.css.render(this.cssScene, cam);
  }

  // ---------- model ----------
  loadModelFromConfig(m) {
    const token = this.modelToken = {};
    if (!m || !toList(m.files).length) { this.swapIn(new T.Group(), [], { kind: 'none' }); return; }
    this.swapIn(new T.Group(), [], { kind: 'loading' });
    this.setState({ notice: 'Loading model…' });
    const t0 = performance.now();
    this.loadModel(m).then(([g, meshes, nodes]) => {
      if (token !== this.modelToken || this.dead) return;
      this.swapIn(g, meshes, { kind: 'file', nodes });
      console.info('Model loaded in ' + Math.round(performance.now() - t0) + ' ms, ' + this.modelInfo.triangles.toLocaleString() + ' triangles');
      this.setState({ notice: null });
    }).catch(err => {
      if (token !== this.modelToken) return;
      console.warn(err);
      this.setState({ notice: 'Model failed to load: ' + (err.message || err) });
    });
  }
  swapIn(model, meshes, info) {
    if (this.model) { this.scene.remove(this.model); this.model.traverse(o => { o.geometry && o.geometry.dispose(); if (o.material) toList(o.material).forEach(mt => mt.dispose()); }); }
    this.model = model; this.meshes = meshes; this.scene.add(model);
    model.rotation.set(0, 0, 0);
    this.rot = { cur: [0, 0, 0], target: [0, 0, 0] }; this.measured = null;
    let tris = 0, voff = 0;
    this.fieldCache = null;
    for (const o of meshes) {
      o.m.material.clippingPlanes = [this.clip];
      if (o.e) o.e.material.clippingPlanes = [this.clip];
      o.basePos = o.m.position.clone();
      // A baked stress field is one scalar per vertex over every mesh in this
      // order; the total is what proves a field still belongs to this model.
      o.vOff = voff; o.vCount = o.m.geometry.attributes.position.count; voff += o.vCount;
      tris += (o.m.geometry.index ? o.m.geometry.index.count : o.m.geometry.attributes.position.count) / 3;
    }
    this.vertexCount = voff;
    this.measure();
    this.explode.cur = this.explode.last = 0;
    this.cut.cur = this.cut.target = 1e6;
    /* A load takes seconds on a dense model and the names can be edited while it
       runs, so the config is the truth here, not the copy the load started from.
       Setting tagKey only once the meshes exist is also what stops an edit made
       mid-load from being counted as already applied. */
    this.tagKey = tagKeyOf(this.cfg && this.cfg.model);
    if (meshes.length) this.retagMeshes(this.cfg && this.cfg.model, true);
    this.modelInfo = { kind: info.kind, parts: this.parts(), nodes: info.nodes || [], meshes: meshes.length, triangles: Math.round(tris) };
    this.themeMeshes();
    if (this.slides.length) {
      this.layout();
      if (this.state.overview) this.showOverview(true);
      else { this.applyStep(this.state.current); if (!this.state.orbited) this.fly(this.slides[this.state.current].view, true); }
    }
    this.opts.onModel && this.opts.onModel(this.modelInfo);
  }
  localDirs() {
    this.model.updateMatrixWorld(true);
    const m3 = new T.Matrix3(), inv = new T.Matrix4();
    for (const o of this.meshes) {
      if (!o.wdir) continue;
      inv.copy(o.m.parent.matrixWorld).invert();
      o.ldir = o.wdir.clone().applyMatrix3(m3.setFromMatrix4(inv));
    }
  }


  async loadModel(m) {
    const files = toList(m.files), model = new T.Group(), list = [], parts = m.parts || {}, groups = m.groups || {}, nodes = [];
    for (const f of files) {
      const buf = this.assetBuf(f.asset);
      if (!buf) throw new Error('Missing data for ' + (f.name || f.asset));
      const ext = String(f.name || '').split('.').pop().toLowerCase();
      if (ext === 'stl') {
        const geo = new STLLoader().parse(buf.slice(0)); // STL carries face normals...
        const nrm = geo.attributes.normal; // ...but some exporters write zeros, which renders black
        if (nrm) { let bad = 0; for (let i = 0; i < nrm.count; i += Math.max(1, nrm.count >> 8)) if (!nrm.getX(i) && !nrm.getY(i) && !nrm.getZ(i)) bad++; if (bad) geo.computeVertexNormals(); }
        // Binary STL from some CAD tools carries per-face colours; use them when present.
        const mat = new T.MeshStandardMaterial({ color: f.color ? new T.Color(f.color) : geo.hasColors ? 0xffffff : 0xc4c8cd, vertexColors: !!geo.hasColors, metalness: 0.7, roughness: 0.35 });
        const mesh = new T.Mesh(geo, mat); mesh.name = f.part || f.name; mesh.userData.part = f.part || null;
        model.add(mesh);
        nodes.push(mesh.name);
      } else if (ext === 'glb' || ext === 'gltf') {
        const gltf = await gltfLoader().parseAsync(buf.slice(0), '');
        if (f.part) gltf.scene.traverse(o => { o.userData.part = f.part; });
        let top = gltf.scene.children;
        while (top.length === 1 && top[0].children.length > 1) top = top[0].children;
        top.forEach(o => o.name && nodes.push(o.name));
        model.add(gltf.scene);
      } else throw new Error('Unsupported model format: ' + (f.name || '?') + ' (use .stl or .glb)');
    }
    if ((m.upAxis || 'y').toLowerCase() === 'z') model.rotation.x = -Math.PI / 2;
    const wrap = new T.Group(); wrap.add(model);
    const box = new T.Box3().setFromObject(wrap), size = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
    const s = (m.size ?? 9) / (Math.max(size.x, size.y, size.z) || 1);
    wrap.scale.setScalar(s); wrap.position.copy(c).multiplyScalar(-s);
    const g = new T.Group(); g.add(wrap);
    // The cloud is in the file's coordinates, so a bake needs this frame, not the scaled/centred one.
    g.userData.modelRoot = model;
    const keys = Object.keys(parts);
    model.traverse(o => {
      if (!o.isMesh) return;
      o.material = (Array.isArray(o.material) ? o.material[0] : o.material).clone(); o.material.transparent = true; o.material.side = T.DoubleSide;
      if (o.material.emissive && !o.material.emissiveMap) { o.material.emissive = new T.Color('#5980a6'); o.material.emissiveIntensity = 0; }
      const part = partOf(o, parts, keys);
      let e = null;
      const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      // Edge extraction is the slowest step on dense CAD meshes; skip it above a triangle budget unless forced.
      if (m.edges === true || (m.edges !== false && tris <= (m.edgeMaxTriangles ?? 150000))) { e = new T.LineSegments(new T.EdgesGeometry(o.geometry, m.edgeAngle ?? 30), new T.LineBasicMaterial({ color: 0x416180, transparent: true, opacity: 0.4 })); o.add(e); }
      // Auto-smooth, Blender-style: weld co-located vertices and average their
      // normals, but only across edges whose faces meet below the crease angle,
      // so a faceted STEP export shades round while its hard edges stay hard.
      // ponytail: whole-mesh, no triangle budget — it is opt-in and off by default.
      if (m.smooth) o.geometry = toCreasedNormals(o.geometry, (+m.smooth) * Math.PI / 180);
      const tags = tagsOf(part, groups);
      const mat0 = { color: o.material.color ? o.material.color.getHex() : null, metalness: o.material.metalness, roughness: o.material.roughness, opacity: o.material.opacity ?? 1 };
      applyBaseMat(o.material, tags.reduce((v, t) => v ?? (m.materials || {})[t], undefined) || (m.materials || {})['*'], mat0);
      list.push({ m: o, e, part, tags, mat0, baseOp: o.material.opacity ?? 1, baseEdge: 0.4 });
    });
    return [g, list, nodes];
  }
}

window.DeckEngine = DeckEngine;
window.DeckEngine.TYPES = TYPES;
window.DeckEngine.esc = esc;
window.DeckEngine.groups = { tagsOf, tagged };
window.DeckEngine.links = { stepIndexOf, linksHtml };
window.DeckEngine.figure = { figVars, ratioOf };
window.DeckEngine.box = { sizeOf, JUSTIFY };
window.DeckEngine.flight = { sameView };
window.DeckEngine.theme = { ramp, themeOf, applyTheme, addRole, roleKey, defaults: THEME, surfaceShades: SURFACE_SHADES, colourShades: COLOUR_SHADES, minShades: MIN_SHADES, maxShades: MAX_SHADES };
})();
