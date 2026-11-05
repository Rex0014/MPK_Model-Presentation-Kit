/* Joining a stress point cloud onto the model's own vertices. Editor only —
   the exported deck ships the baked result, never this.

   The FEA mesh is the mesh we display, so this is a positional *join*, not an
   interpolation: every point already sits on a vertex that exists, and the only
   reason a lookup is needed is that exporters renumber and split vertices (STL
   writes three per triangle, GLB splits at normal seams). The tolerance is a
   weld tolerance, not a physical influence radius — widen it only if the file
   carries element centroids rather than nodal values, which `coverage` tells
   you straight away.

   Which side gets the index matters. The mesh is the bounded side (1e5
   vertices), the cloud is the massive one (1e7 points), so the hash is built
   over the MESH and the file streams through it: nothing ever holds the whole
   cloud. Interior nodes of a solid mesh fall out for free, because we only ask
   about surface vertices and so nothing asks about them. */
(function () {
'use strict';

// ---------- a sparse voxel hash over the mesh vertices ----------
const AXIS = 1e5;                        // cells per axis; keeps the packed key exact in a double
const key = (i, j, k) => (i * 131072 + j) * 131072 + k;

function buildIndex(verts, tol) {
  const n = verts.length / 3;
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = verts[3 * i], y = verts[3 * i + 1], z = verts[3 * i + 2];
    if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
    if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
  }
  const diag = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) || 1;
  /* One cell per tolerance — but never so many that the key overflows. A cell
     coarser than the tolerance only means more candidates to reject; the real
     distance check in near() is what makes the answer exact either way. */
  const cell = Math.max(tol, diag / AXIS);
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(((verts[3 * i] - mnx) / cell) | 0, ((verts[3 * i + 1] - mny) / cell) | 0, ((verts[3 * i + 2] - mnz) / cell) | 0);
    const b = map.get(k); if (b) b.push(i); else map.set(k, [i]);
  }
  return { verts, map, cell, tol, mnx, mny, mnz, n, diag, box: [mnx, mny, mnz, mxx, mxy, mxz] };
}

// Every vertex within tol of (x,y,z), as indices written into `out`.
function near(ix, x, y, z, out) {
  out.length = 0;
  const v = ix.verts, cell = ix.cell, t2 = ix.tol * ix.tol;
  const ci = ((x - ix.mnx) / cell) | 0, cj = ((y - ix.mny) / cell) | 0, ck = ((z - ix.mnz) / cell) | 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const bucket = ix.map.get(key(ci + a, cj + b, ck + c));
    if (!bucket) continue;
    for (let q = 0; q < bucket.length; q++) {
      const i = bucket[q], dx = v[3 * i] - x, dy = v[3 * i + 1] - y, dz = v[3 * i + 2] - z;
      if (dx * dx + dy * dy + dz * dz <= t2) out.push(i);
    }
  }
  return out;
}

// ---------- streaming parse: byte chunks in, rows out ----------
/* parseFloat on a slice rather than a hand-rolled float scanner: the stdlib is
   correct on every edge case and this is not where the time goes. A header row
   or a # comment yields NaN and is counted as skipped — no special case. */
const SEP = c => c === 32 || c === 9 || c === 44 || c === 59 || c === 13;
const F = [0, 0, 0, 0];
/* cols maps x, y, z and value onto whitespace-separated field positions, so a
   file with extra columns (node id first, say) needs no reshaping. */
function row(s, a, b, cols, onRow) {
  const last = Math.max(cols[0], cols[1], cols[2], cols[3]);
  let i = a, at = 0, got = 0;
  while (i < b && at <= last) {
    while (i < b && SEP(s.charCodeAt(i))) i++;
    const st = i;
    while (i < b && !SEP(s.charCodeAt(i))) i++;
    if (i === st) break;
    for (let c = 0; c < 4; c++) if (cols[c] === at) { F[c] = parseFloat(s.slice(st, i)); got++; }
    at++;
  }
  if (got < 4 || F[0] !== F[0] || F[1] !== F[1] || F[2] !== F[2] || F[3] !== F[3]) return false;
  onRow(F[0], F[1], F[2], F[3]);
  return true;
}

/* chunks: anything for-await-able that yields Uint8Array (a File stream in the
   browser, an array of buffers in the test). */
/* A ReadableStream is only async-iterable in newer browsers, so read it the
   long way; anything else (an array of buffers, say) iterates as it is. */
async function* iterate(src) {
  if (!src || typeof src.getReader !== 'function') { yield* src; return; }
  const rd = src.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) return; yield value; }
}
async function parseChunks(chunks, cols, onRow, onProgress) {
  const dec = new TextDecoder('utf-8');
  let rest = '', rows = 0, skipped = 0, bytes = 0, since = 0;
  for await (const c of iterate(chunks)) {
    bytes += c.length ?? c.byteLength;
    const s = rest + dec.decode(c, { stream: true });
    let i = 0;
    for (;;) {
      const nl = s.indexOf('\n', i);
      if (nl < 0) { rest = s.slice(i); break; }
      row(s, i, nl, cols, onRow) ? rows++ : skipped++;
      i = nl + 1;
    }
    // Let the page paint: a 100 MB file is seconds of work on the main thread.
    // ponytail: good enough for an import button; move to a Worker if it ever runs during playback.
    if (++since >= 32) { since = 0; onProgress && onProgress(bytes); await new Promise(r => setTimeout(r)); }
  }
  if (rest.trim()) row(rest, 0, rest.length, cols, onRow) ? rows++ : skipped++;
  onProgress && onProgress(bytes);
  return { rows, skipped, bytes };
}

// ---------- the bake ----------
/* Several points can land on one vertex (duplicated at a seam, or a cloud denser
   than the mesh). Keep the largest: under-reporting a stress peak is the one
   error here that matters. */
async function bake(verts, chunks, opts = {}) {
  const ix = buildIndex(verts, opts.tol || 1e-5), n = ix.n;
  const cols = opts.columns || [0, 1, 2, 3];
  const values = new Float32Array(n), hit = new Uint8Array(n), out = [];
  let used = 0;
  const stat = await parseChunks(chunks, cols, (x, y, z, v) => {
    near(ix, x, y, z, out);
    if (out.length) used++;
    for (let q = 0; q < out.length; q++) {
      const i = out[q];
      values[i] = hit[i] ? Math.max(values[i], v) : v;
      hit[i] = 1;
    }
  }, opts.onProgress);
  let matched = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) if (hit[i]) { matched++; if (values[i] < lo) lo = values[i]; if (values[i] > hi) hi = values[i]; }
  if (!matched) { lo = 0; hi = 1; }
  return Object.assign({ values, hit, matched, vertices: n, coverage: n ? matched / n : 0, pointsUsed: used, lo, hi }, stat);
}

/* What actually ships. One scalar per vertex, 16-bit over the field's own
   range: 0.0015% of full scale, finer than a colour ramp resolves, and 2 bytes
   a vertex instead of hundreds of megabytes of source text. 0 is reserved for
   "not measured here", so an unmeasured vertex stays grey rather than borrowing
   a colour from somewhere it was never measured. */
function quantise(values, hit, lo, hi) {
  const q = new Uint16Array(values.length), s = hi > lo ? 65534 / (hi - lo) : 0;
  for (let i = 0; i < q.length; i++) q[i] = hit[i] ? 1 + Math.min(65534, Math.max(0, Math.round((values[i] - lo) * s))) : 0;
  return q;
}
const dequantise = (q, lo, hi) => q ? lo + (q - 1) * (hi - lo) / 65534 : null;

window.StressBake = { bake, quantise, dequantise, buildIndex, near, parseChunks };
})();
