/* Self-check for the theme in engine.js: node test-theme.js
   The expected ramps come from theme-maker itself (WEB_ThemeMaker/typescript,
   rampFromHex(base, shades, inter)), so this fails if the port here drifts from
   the library. */
const assert = require('assert');
global.window = { THREE: new Proxy({}, { get: () => function () { } }), THREE_ADDONS: {} };
global.document = { documentElement: {} };
require('./src/engine.js');
const { ramp, themeOf, applyTheme, addRole, roleKey, surfaceShades, colourShades } = window.DeckEngine.theme;

// applyTheme writes into anything with a style.setProperty; collect what it wrote.
const grab = t => { const e = { style: { v: {}, setProperty(k, x) { this.v[k] = x; } } }; applyTheme(e, t); return e.style.v; };

// --- the generator, against the library's own output ---
assert.deepStrictEqual(ramp('#8C8C90', 11, 0),
  ['#E8E8E9', '#D1D1D3', '#BABABC', '#A3A3A6', '#8C8C90', '#75757A', '#5E5E64', '#47474D', '#303037', '#191921', '#02020B']);
assert.deepStrictEqual(ramp('#5980A6', 5, 20), ['#7CB6C9', '#5980A6', '#374B84', '#141561', '#00003F']);
assert.deepStrictEqual(ramp('#C6373A', 5, 20), ['#D9494D', '#C6373A', '#B42627', '#A11414', '#8F0301']);

// --- role normalisation: the surface slot is what makes a role wide and invertible ---
assert.strictEqual(roleKey(' My Brand! '), 'my-brand');
const plain = themeOf({});
assert.deepStrictEqual(plain.roles.map(r => [r.key, r.shades, r.invert]),
  [['neutral', surfaceShades, true], ['accent', colourShades, true], ['accent-2', colourShades, true]]);
assert.strictEqual(themeOf({ roles: [], surface: 'nope' }).surface, 'neutral', 'falls back to the defaults');
assert.strictEqual(themeOf({ roles: [{ key: 'Brand X', base: '#111111' }], accent: 'gone' }).accent, 'brand-x',
  'a missing slot role points at what exists');
const swapped = themeOf({ surface: 'accent', roles: [{ key: 'neutral', base: '#8C8C90' }, { key: 'accent', base: '#5980A6' }] });
assert.deepStrictEqual(swapped.roles.map(r => [r.key, r.shades, r.invert]),
  [['neutral', colourShades, false], ['accent', surfaceShades, true]], 'the shape follows the slot, not the name');

// --- addRole, theme-maker's own entry point ---
const reg = themeOf({});
assert.deepStrictEqual(addRole(reg, { label: 'Warning', base: '#C98A1F' }),
  { label: 'Warning', shades: colourShades, invert: false, base: '#C98A1F', key: 'warning' },
  'a registered role defaults to a 5-shade family that does not flip');
assert.strictEqual(addRole(reg, { label: 'Warning', base: '#111111' }).key, 'warning-2', 'keys are kept unique');
assert.strictEqual(grab(reg)['--color-warning-02'], '#C98A1F');

// --- published variables ---
const light = grab({}), dark = grab({ dark: true });
assert.strictEqual(light['--color-neutral-01'], '#E8E8E9');
assert.strictEqual(light['--color-neutral-11'], '#02020B');
assert.strictEqual(light['--color-bg'], '#E8E8E9');
assert.strictEqual(light['--color-text'], '#303037');
assert.strictEqual(dark['--color-bg'], '#02020B', 'dark reads the surface ramp backwards');
assert.strictEqual(dark['--color-text'], '#BABABC', 'and lands on the mirror of the light theme\'s text shade');

assert.strictEqual(light['--color-accent-02'], '#5980A6', 'the hex the user picked sits at -02');
assert.strictEqual(light['--color-accent'], light['--color-accent-04'], '--color-accent is an alias, not a colour of its own');
assert.strictEqual(light['--color-accent-04'], '#141561', 'trim reads dark against a light page');
assert.strictEqual(dark['--color-accent-04'], '#5980A6', 'and light against a dark one, because the role flips');
assert.strictEqual(dark['--color-accent-05'], light['--color-accent-01'], 'slab and on-slab swap ends together');

// a role with the flip off keeps its hue fixed, the library's default
const fixed = { roles: [{ key: 'neutral', base: '#8C8C90', inter: 0 }, { key: 'accent', base: '#5980A6' }] };
const fl = grab(fixed), fd = grab(Object.assign({ dark: true }, fixed));
assert.strictEqual(fd['--color-accent-04'], fl['--color-accent-04'], 'no flip, same shade in both themes');

// --- a user-added role: own name, five shades, and usable in the accent slot ---
const deck = themeOf({ roles: [{ key: 'neutral', base: '#8C8C90', inter: 0 }, { key: 'accent-2', base: '#728FAB' }] });
deck.accent = addRole(deck, { label: 'Brand', base: '#C6373A' }).key;
const extra = grab(deck);
assert.strictEqual(extra['--color-brand-02'], '#C6373A');
assert.strictEqual(extra['--color-brand-06'], undefined, 'a colour role stops at five shades');
assert.strictEqual(extra['--color-accent-02'], '#C6373A', 'the accent slot follows the chosen role');
assert.strictEqual(extra['--color-accent-2-02'], '#728FAB', 'the accent-2 role backs tag-accent-2');
console.log('theme: ok');
