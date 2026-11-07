/* Self-check for the theme in engine.js: node test-theme.js
   The expected ramps come from theme-maker itself (TM_Theme-Maker/typescript,
   rampFromHex(base, shades, inter)), so this fails if the port here drifts from
   the library. Upstream, TM_Theme-Maker/check-ramps.py holds its three
   implementations to the same hexes. */
const assert = require('assert');
global.window = { THREE: new Proxy({}, { get: () => function () { } }), THREE_ADDONS: {} };
global.document = { documentElement: {} };
require('./src/engine.js');
const { ramp, themeOf, applyTheme, addRole, roleKey, surfaceShades, colourShades, minShades, maxShades } = window.DeckEngine.theme;

// applyTheme writes into anything with a style.setProperty; collect what it wrote.
const grab = t => { const e = { style: { v: {}, setProperty(k, x) { this.v[k] = x; } } }; applyTheme(e, t); return e.style.v; };

// --- the generator, against the library's own output ---
assert.deepStrictEqual(ramp('#8C8C90', 11),
  ['#EBEBEB', '#D8D8D9', '#C5C5C7', '#B2B2B4', '#9F9FA2', '#8C8C90', '#747477', '#5C5C5E', '#444446', '#2C2C2D', '#141414']);
assert.deepStrictEqual(ramp('#8C8C90', 11, 0),
  ['#FFFFFF', '#E8E8E9', '#D1D1D3', '#BABABC', '#A3A3A6', '#8C8C90', '#707073', '#545456', '#38383A', '#1C1C1D', '#000000'],
  'inter is how far short of pure white and black the ends stop');
assert.deepStrictEqual(ramp('#5980A6', 5, 20), ['#EBEBEB', '#A2B6C9', '#5980A6', '#374A5D', '#141414']);
assert.deepStrictEqual(ramp('#C6373A', 5, 20), ['#EBEBEB', '#D99193', '#C6373A', '#6D2627', '#141414']);

// the ramp spans the margins from any base, and the base is the middle shade
for (const [base, n] of [['#C6373A', 5], ['#494751', 11], ['#8C8C90', 11], ['#3B9C55', 7]]) {
  const r = ramp(base, n);
  assert.deepStrictEqual([r[0], r[n - 1]], ['#EBEBEB', '#141414'], base + ' reaches both margins');
  assert.strictEqual(r[(n - 1) / 2], base, base + ' sits in the middle of its own ramp');
}
assert.strictEqual(ramp('#5980A6', 4).indexOf('#5980A6'), -1, 'an even count straddles the base instead');

// --- role normalisation: the surface slot is what makes a role wide and invertible ---
assert.strictEqual(roleKey(' My Brand! '), 'my-brand');
const plain = themeOf({});
assert.deepStrictEqual(plain.roles.map(r => [r.key, r.shades, r.invert]),
  [['neutral', surfaceShades, true], ['accent', colourShades, true]]);
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
assert.strictEqual(grab(reg)['--color-warning-03'], '#C98A1F');

// --- published variables ---
const light = grab({}), dark = grab({ dark: true });
const SURF = ramp(window.DeckEngine.theme.defaults.roles[0].base, surfaceShades);
assert.strictEqual(light['--color-neutral-01'], SURF[0]);
assert.strictEqual(light['--color-neutral-11'], SURF[10]);
assert.strictEqual(light['--color-bg'], SURF[0], 'the page is the lightest surface shade');
assert.strictEqual(light['--color-text'], SURF[8]);
assert.strictEqual(dark['--color-bg'], SURF[10], 'dark reads the surface ramp backwards');
assert.strictEqual(dark['--color-text'], SURF[2], 'and lands on the mirror of the light theme\'s text shade');
// the workaround every pre-full-span deck carries is normalised away, or the page would be pure white
assert.strictEqual(grab({ roles: [{ key: 'neutral', base: '#8C8C90', inter: 0 }, { key: 'accent', base: '#C8AF4C' }] })['--color-bg'], SURF[0],
  'a stored inter of 0 on the surface role is dropped');

// the default accent, through the same generator, rather than a hex copied by hand
const ACC = ramp(window.DeckEngine.theme.defaults.roles[1].base, colourShades);
assert.strictEqual(light['--color-accent-03'], ACC[2], 'the hex the user picked is the middle shade');
assert.strictEqual(light['--color-accent'], light['--color-accent-04'], '--color-accent is an alias, not a colour of its own');
assert.strictEqual(light['--color-accent-04'], ACC[3], 'trim reads dark against a light page');
assert.strictEqual(dark['--color-accent-04'], ACC[1], 'and light against a dark one, because the role flips');
assert.strictEqual(dark['--color-accent-05'], light['--color-accent-01'], 'slab and on-slab swap ends together');

// a role with the flip off keeps its hue fixed, the library's default
const fixed = { roles: [{ key: 'neutral', base: '#8C8C90' }, { key: 'accent', base: '#5980A6' }] };
const fl = grab(fixed), fd = grab(Object.assign({ dark: true }, fixed));
assert.strictEqual(fd['--color-accent-04'], fl['--color-accent-04'], 'no flip, same shade in both themes');

// --- a user-added role: own name, five shades, and usable in the accent slot ---
const deck = themeOf({ roles: [{ key: 'neutral', base: '#8C8C90' }, { key: 'accent-2', base: '#728FAB' }] });
deck.accent = addRole(deck, { label: 'Brand', base: '#C6373A' }).key;
const extra = grab(deck);
assert.strictEqual(extra['--color-brand-03'], '#C6373A');
assert.strictEqual(extra['--color-brand-06'], undefined, 'a colour role stops at five shades');
assert.strictEqual(extra['--color-accent-03'], '#C6373A', 'the accent slot follows the chosen role');
assert.strictEqual(extra['--color-accent-2-03'], '#728FAB', 'the accent-2 role backs tag-accent-2');
// --- a role's own shade count ---
const counted = themeOf({ roles: [{ key: 'neutral', base: '#8C8C90', inter: 0, shades: 7 }, { key: 'accent', base: '#5980A6', shades: 9 }] });
assert.deepStrictEqual(counted.roles.map(r => r.shades), [7, 9], 'a count given by the deck is kept, slot or not');
assert.strictEqual(themeOf({ roles: [{ key: 'neutral', base: '#8C8C90', shades: 99 }] }).roles[0].shades, maxShades, 'clamped at the top');
assert.strictEqual(themeOf({ roles: [{ key: 'neutral', base: '#8C8C90', shades: 1 }] }).roles[0].shades, minShades, 'and at the bottom');

/* Published under its own name a role gets exactly the count it asked for.
   The two slots are also published under the alias names the stylesheets use
   (--color-neutral-NN, --color-accent-NN), and those keep their canonical
   length — resampled from the shorter ramp, so no position is ever missing. */
const named = themeOf({ surface: 'paper', accent: 'brand', roles: [{ key: 'paper', base: '#8C8C90', shades: 7 }, { key: 'brand', base: '#5980A6', shades: 9 }] });
const few = grab(named), paper = ramp('#8C8C90', 7), brand = ramp('#5980A6', 9);
assert.strictEqual(few['--color-paper-07'], paper[6], 'the role publishes exactly what it asked for');
assert.strictEqual(few['--color-paper-08'], undefined, 'and no more');
assert.strictEqual(few['--color-brand-09'], brand[8]);
assert.strictEqual(few['--color-neutral-11'], paper[6], 'the neutral alias still reaches -11, resampled');
assert.strictEqual(few['--color-neutral-01'], paper[0]);
assert.strictEqual(few['--color-accent-05'], brand[8], 'same for the five the accent alias promises');
assert.strictEqual(few['--color-bg'], paper[0], 'and the page still comes off the surface ramp');

console.log('theme: ok');
