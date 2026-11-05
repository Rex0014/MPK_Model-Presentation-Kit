/* Self-check for part groups in engine.js: node test-groups.js
   Order matters — applyColors and the base-material lookup walk a mesh's tags
   and take the first hit, so the part's own name has to come before its groups. */
const assert = require('assert');
global.window = { THREE: new Proxy({}, { get: () => function () { } }), THREE_ADDONS: {} };
global.document = { documentElement: {} };
require('./src/engine.js');
const { tagsOf, tagged } = window.DeckEngine.groups;

const groups = { frame: ['tube', 'bracket'], moving: ['rod', 'tube'] };
assert.deepStrictEqual(tagsOf('tube', groups), ['tube', 'frame', 'moving'], 'own name first, then every group holding it');
assert.deepStrictEqual(tagsOf('rod', groups), ['rod', 'moving']);
assert.deepStrictEqual(tagsOf('motor', groups), ['motor'], 'a part in no group answers only to itself');
assert.deepStrictEqual(tagsOf(null, groups), [], 'an unnamed mesh answers to nothing');
assert.deepStrictEqual(tagsOf('rod', undefined), ['rod'], 'no groups declared is not an error');

// what focus / highlight / hide ask
const mesh = { tags: tagsOf('tube', groups) };
assert.ok(tagged(mesh, ['frame']), 'a group name reaches its members');
assert.ok(tagged(mesh, ['tube']), 'and so does the part name');
assert.ok(!tagged(mesh, ['rod', 'motor']), 'and nothing else does');
assert.ok(!tagged(mesh, []), 'an empty list matches nothing');

// what applyColors asks: the part's own entry wins over its group's
const pick = (m, map) => m.tags.reduce((v, t) => v ?? map[t], undefined) ?? map['*'];
assert.strictEqual(pick(mesh, { frame: '#f00', tube: '#0f0' }), '#0f0');
assert.strictEqual(pick(mesh, { frame: '#f00' }), '#f00');
assert.strictEqual(pick(mesh, { '*': '#00f', moving: '#0ff' }), '#0ff', 'a group beats the catch-all');
assert.strictEqual(pick({ tags: tagsOf('motor', groups) }, { frame: '#f00', '*': '#00f' }), '#00f');
console.log('groups: ok');
