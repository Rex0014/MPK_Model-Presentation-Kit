/* Self-check for the stress join in src/stress.js: node test-stress.js
   Add --bench for timings on a synthetic 4M-point cloud. */
const assert = require('assert');
global.window = {};
global.TextDecoder = global.TextDecoder || require('util').TextDecoder;
require('./src/stress.js');
const { bake, quantise, dequantise } = window.StressBake;

const buf = s => Buffer.from(s, 'utf-8');
const run = (verts, chunks, opts) => bake(verts, chunks, opts);

(async () => {

// --- a vertex is found through float noise, and a point off the mesh is not
{
  const verts = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 0, 0, 10, 0]);  // two copies of (10,0,0): a seam
  const txt = '# von Mises, MPa\nx y z stress\n0 0 0 100\n10.0000004 0 0 250\n0 10 0 50\n99 99 99 999\n';
  const r = await run(verts, [buf(txt)], { tol: 1e-3 });
  assert.strictEqual(r.rows, 4, 'four numeric rows; the comment and the header are skipped');
  assert.strictEqual(r.skipped, 2);
  assert.strictEqual(r.pointsUsed, 3, 'the point at (99,99,99) is nowhere near the mesh');
  assert.deepStrictEqual([...r.hit], [1, 1, 1, 1], 'every vertex measured');
  assert.strictEqual(r.values[1], 250, 'both copies of the seam vertex get the value');
  assert.strictEqual(r.values[2], 250);
  assert.deepStrictEqual([r.lo, r.hi], [50, 250]);
}

// --- an unmeasured vertex stays unmeasured; it does not borrow a neighbour's value
{
  const verts = new Float32Array([0, 0, 0, 1, 0, 0]);
  const r = await run(verts, [buf('0 0 0 100\n')], { tol: 1e-3 });
  assert.deepStrictEqual([...r.hit], [1, 0]);
  assert.strictEqual(r.coverage, 0.5, 'coverage is the number that tells you the export went wrong');
  assert.strictEqual(dequantise(quantise(r.values, r.hit, 0, 100)[1], 0, 100), null, 'no data stays no data');
}

// --- several points on one vertex: the peak survives
{
  const r = await run(new Float32Array([0, 0, 0]), [buf('0 0 0 10\n0 0 0 400\n0 0 0 30\n')], { tol: 1e-3 });
  assert.strictEqual(r.values[0], 400);
}

// --- extra columns: a node id in front, the value last
{
  const verts = new Float32Array([0, 0, 0, 1, 2, 3]);
  const r = await run(verts, [buf('1001, 0, 0, 0, 77\n1002, 1, 2, 3, 88\n')], { tol: 1e-6, columns: [1, 2, 3, 4] });
  assert.deepStrictEqual([r.values[0], r.values[1]], [77, 88]);
}

// --- chunk boundaries may fall anywhere, including mid-number
{
  const verts = new Float32Array([0, 0, 0, 1, 2, 3]);
  const txt = buf('0 0 0 11\n1 2 3 22\n');
  for (let cut = 1; cut < txt.length; cut++) {
    const r = await run(verts, [txt.subarray(0, cut), txt.subarray(cut)], { tol: 1e-6 });
    assert.deepStrictEqual([r.values[0], r.values[1]], [11, 22], 'split at byte ' + cut);
  }
}

// --- against brute force on random data: the only real proof the grid is right
{
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const n = 800, verts = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) verts[i] = rnd() * 50;
  const tol = 3, pts = [];
  for (let i = 0; i < 1500; i++) pts.push([rnd() * 50, rnd() * 50, rnd() * 50, rnd() * 1000]);

  const want = new Float32Array(n), wantHit = new Uint8Array(n);
  for (const [x, y, z, v] of pts) for (let i = 0; i < n; i++) {
    const dx = verts[3 * i] - x, dy = verts[3 * i + 1] - y, dz = verts[3 * i + 2] - z;
    if (dx * dx + dy * dy + dz * dz <= tol * tol) { want[i] = wantHit[i] ? Math.max(want[i], v) : v; wantHit[i] = 1; }
  }
  const r = await run(verts, [buf(pts.map(p => p.join(' ')).join('\n') + '\n')], { tol });
  assert.deepStrictEqual([...r.hit], [...wantHit], 'same vertices matched as brute force');
  assert.deepStrictEqual([...r.values], [...want], 'same values as brute force');
  assert.ok(r.matched > n * 0.5 && r.matched < n, 'and the case is not degenerate: ' + r.matched + '/' + n);
}

// --- 16-bit storage round-trips well inside what a colour ramp can show
{
  const v = new Float32Array([0, 123.456, 320]), hit = new Uint8Array([1, 1, 1]);
  const q = quantise(v, hit, 0, 320);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(dequantise(q[i], 0, 320) - v[i]) < 320 / 65534, 'vertex ' + i);
}
console.log('stress join: ok');

// ---------- optional benchmark ----------
if (process.argv.includes('--bench')) {
  const side = 180, nv = side * side * 3;
  const verts = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    verts[3 * i] = (i % side) * 0.5; verts[3 * i + 1] = ((i / side) | 0) % side * 0.5; verts[3 * i + 2] = ((i / (side * side)) | 0) * 7;
  }
  const NP = 4e6, chunks = [];
  let t = Date.now(), lines = [];
  for (let i = 0; i < NP; i++) {
    const j = i % nv;
    lines.push(verts[3 * j].toFixed(4) + ' ' + verts[3 * j + 1].toFixed(4) + ' ' + verts[3 * j + 2].toFixed(4) + ' ' + (i % 997) + '\n');
    if (lines.length === 50000) { chunks.push(buf(lines.join(''))); lines = []; }
  }
  if (lines.length) chunks.push(buf(lines.join('')));
  const bytes = chunks.reduce((n, c) => n + c.length, 0);
  console.log('generated ' + (NP / 1e6) + 'M points, ' + (bytes / 1e6).toFixed(0) + ' MB of text, in ' + (Date.now() - t) + ' ms');
  t = Date.now();
  const r = await run(verts, chunks, { tol: 1e-3 });
  const ms = Date.now() - t;
  console.log('bake: ' + ms + ' ms (' + (NP / ms / 1000).toFixed(1) + 'M points/s)  coverage ' + (r.coverage * 100).toFixed(1) + '%  range ' + r.lo + '…' + r.hi);
  console.log('ships as ' + (quantise(r.values, r.hit, r.lo, r.hi).byteLength / 1e3).toFixed(0) + ' kB for ' + (nv / 1e3).toFixed(0) + 'k vertices (source text was ' + (bytes / 1e6).toFixed(0) + ' MB)');
}

})().catch(e => { console.error(e); process.exit(1); });
