/* Two editor-driven engine behaviours that have no browser in them:
     node test-links.js
   - a step link resolves by id, so moving steps cannot re-aim a button;
   - parts, groups and base materials are re-applied in place, which is what
     keeps naming a part from reloading (and re-smoothing) the whole model. */
const assert = require('assert');
global.window = { THREE: new Proxy({}, { get: () => function () { } }), THREE_ADDONS: {} };
global.document = { documentElement: {} };
require('./src/engine.js');
const { stepIndexOf, linksHtml } = window.DeckEngine.links;

// --- links resolve by id, fall back to an index, and drop when the target is gone ---
const steps = [{ id: 'aaa', title: 'Intro' }, { title: 'No id' }, { id: 'ccc', title: 'Detail' }];
assert.strictEqual(stepIndexOf(steps, 'ccc'), 2);
assert.strictEqual(stepIndexOf(steps, '1'), 1, 'a bare number still reads as an index');
assert.strictEqual(stepIndexOf(steps, 'gone'), -1);
assert.strictEqual(stepIndexOf(steps, ''), -1);
assert.strictEqual(stepIndexOf(steps, 9), -1, 'out of range is no link');

// moving the target keeps the link on it, which an index could not do
const moved = [steps[2], steps[0], steps[1]];
assert.strictEqual(stepIndexOf(moved, 'ccc'), 0, 'the id follows the step');

const html = linksHtml({ links: [{ to: 'ccc', label: 'See it' }, { to: 'aaa' }, { to: 'gone', label: 'Dead' }] }, steps);
assert.ok(html.includes('data-goto="2"') && html.includes('>See it<'));
assert.ok(html.includes('data-goto="0"') && html.includes('>Intro<'), 'no label falls back to the step title');
assert.ok(!html.includes('Dead'), 'a link to a deleted step is not drawn');
assert.strictEqual(linksHtml({}, steps), '', 'no links, no markup');

// --- the figure box: a ratio beats a height, and nothing set writes nothing ---
const { figVars, ratioOf } = window.DeckEngine.figure;
assert.strictEqual(ratioOf('16/9'), '16/9');
assert.strictEqual(ratioOf('16 : 9'), '16/9', 'a colon is the other way people write it');
assert.strictEqual(ratioOf('1.78'), '1.78', 'a bare number is already a ratio');
assert.strictEqual(ratioOf('16/0'), null, 'a zero side is not a ratio');
assert.strictEqual(ratioOf('wide'), null);
assert.strictEqual(ratioOf(''), null);

assert.strictEqual(figVars({}), '', 'an untouched step styles nothing, so an old deck is unchanged');
assert.ok(figVars({ imageH: 300 }).includes('--fig-h:300px'));
assert.ok(figVars({ imageH: 5000 }).includes('--fig-h:1200px'), 'out of range is clamped, not dropped');
const both = figVars({ imageH: 300, imageRatio: '4:3' });
assert.ok(both.includes('--fig-ar:4/3') && both.includes('--fig-h:auto') && both.includes('--fig-flex:none'),
  'a ratio takes the height and the flex-grow out of its way');
assert.ok(!both.includes('300px'), 'the height it replaced is not also written');
const rest = figVars({ imageW: 60, imageAlign: 'right', fit: 'contain' });
assert.ok(rest.includes('--fig-w:60%') && rest.includes('--fig-al:flex-end') && rest.includes('--fig-fit:contain'));
assert.ok(!figVars({ imageW: 100 }).includes('--fig-w'), 'full width is the default, not an override');
assert.ok(!figVars({ fit: 'drop-table' }).includes('--fig-fit'), 'only the three real object-fit values pass');

// --- the slide's own box: the type's by default, the step's when it says so ---
const { sizeOf, JUSTIFY } = window.DeckEngine.box;
const card = { w: 640, h: 440 };
assert.deepStrictEqual(sizeOf({}, card), { w: 640, h: 440, fit: false }, 'an untouched step is the type\u2019s own box');
assert.deepStrictEqual(sizeOf({ slideW: 900, slideH: 300 }, card), { w: 900, h: 300, fit: false });
assert.strictEqual(sizeOf({ slideW: 9999 }, card).w, 2000, 'out of range is clamped, not dropped');
assert.deepStrictEqual(sizeOf({ fitH: true }, card), { w: 640, h: 0, fit: true }, 'fitting the content leaves no floor');
assert.deepStrictEqual(sizeOf({ fitH: true, slideH: 300 }, card), { w: 640, h: 300, fit: true },
  'a height set alongside it stays as the minimum');
assert.strictEqual(JUSTIFY.spread, 'space-between');
assert.strictEqual(JUSTIFY.sideways, undefined, 'only the four placements are honoured');

// --- a step whose view is already on screen does not fly ---
const { sameView } = window.DeckEngine.flight;
const V = (x, y, z) => ({ x, y, z, distanceTo(o) { return Math.hypot(x - o.x, y - o.y, z - o.z); } });
const cam = { position: V(0, 4, 15) }, ctl = { target: V(0, 0, 0) };   // radius 15.5
const here = { pos: V(0, 4, 15), target: V(0, 0, 0) };
assert.strictEqual(sameView(cam, ctl, here, 0, 0), true, 'the same view is not a flight');
assert.strictEqual(sameView(cam, ctl, { pos: V(0, 4, 15.0001), target: V(0, 0, 0) }, 0, 0), true, 'float noise is not a flight either');
assert.strictEqual(sameView(cam, ctl, { pos: V(0, 4, 14.9), target: V(0, 0, 0) }, 0, 0), false, 'a dolly in is');
assert.strictEqual(sameView(cam, ctl, { pos: V(0, 4, 15), target: V(0.1, 0, 0) }, 0, 0), false, 'so is a pan');
// the projection shift is part of where the camera looks, so a slide moving from
// one side to the other has to fly even when the orbit around the model has not
assert.strictEqual(sameView(cam, ctl, { pos: V(0, 4, 15), target: V(0, 0, 0), sx: 0.2 }, 0, 0), false);
assert.strictEqual(sameView(cam, ctl, { pos: V(0, 4, 15), target: V(0, 0, 0), sx: 0.2 }, 0.2, 0), true);
// a camera sitting on its own target has no radius to scale the tolerance by
assert.strictEqual(sameView({ position: V(0, 0, 0) }, { target: V(0, 0, 0) }, { pos: V(0, 0, 0), target: V(0, 0, 0) }, 0, 0), true);

// --- parts / groups / materials re-applied without a reload ---
const mesh = (name, mat) => ({ m: { name, userData: {}, parent: null, material: Object.assign({ color: null, metalness: 0.1, roughness: 0.9, opacity: 1 }, mat) } });
const mk = o => Object.assign(o, { mat0: { color: null, metalness: o.m.material.metalness, roughness: o.m.material.roughness, opacity: o.m.material.opacity } });
const P = window.DeckEngine.prototype;
const eng = {
  meshes: [mk(mesh('HOUSING_01')), mk(mesh('Shaft_A'))],
  cfg: { steps: [{}] }, state: { current: 0 }, modelInfo: { parts: [], meshes: 2 }, opts: { onModel: info => eng.seen = info },
  applyColors: P.applyColors, parts: P.parts, retagMeshes: P.retagMeshes,
};
eng.retagMeshes({ parts: { housing: ['housing'], shaft: ['shaft'] }, groups: { drive: ['shaft'] } });
assert.deepStrictEqual(eng.meshes.map(o => o.part), ['housing', 'shaft'], 'node names are matched case-insensitively');
assert.deepStrictEqual(eng.meshes[1].tags, ['shaft', 'drive'], 'own part first, then its groups');
assert.deepStrictEqual(eng.seen.parts, ['housing', 'shaft'], 'the part list is reported once it moves');
assert.strictEqual(eng.seen.meshes, 2, 'and the rest of the model info is kept');

// a base material lands on the mesh, and clearing it restores the file's own values
eng.retagMeshes({ parts: { housing: ['housing'] }, materials: { housing: { metalness: 0.8, opacity: 0.5 } } });
assert.strictEqual(eng.meshes[0].m.material.metalness, 0.8);
assert.strictEqual(eng.meshes[0].baseOp, 0.5, 'opacity feeds the fade');
assert.strictEqual(eng.meshes[1].part, null, 'a part that was renamed away leaves its meshes unnamed');
eng.retagMeshes({ parts: { housing: ['housing'] } });
assert.strictEqual(eng.meshes[0].m.material.metalness, 0.1, 'the file\'s material comes back');
assert.strictEqual(eng.meshes[0].baseOp, 1);

// the loader's own part name wins over any substring match
eng.meshes[0].m.userData.part = 'given';
eng.retagMeshes({ parts: { housing: ['housing'] } });
assert.strictEqual(eng.meshes[0].part, 'given');

// quiet: a re-tag during a model load leaves the reporting to swapIn
eng.seen = null;
eng.retagMeshes({ parts: { housing: ['shaft'] } }, true);
assert.strictEqual(eng.seen, null, 'quiet says nothing');
assert.strictEqual(eng.meshes[1].part, 'housing', 'but still re-tags');

console.log('links + retag: ok');
