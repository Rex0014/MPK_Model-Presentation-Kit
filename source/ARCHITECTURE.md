# How it works

A deck is a JSON object. The engine turns it into a three.js scene with HTML
slides floating in it. The editor is a second program that edits that JSON and
happens to embed the engine for its preview. Everything ships as one HTML file
that runs from `file://`.

```
         deck JSON  ──────────────┐
                                  ▼
   editor.js ──edits──▶ ED.deck ──▶ DeckEngine ──▶ WebGL model + CSS3D slides
       │                              ▲
       │  buildExport()               │
       ▼                              │
   one .html file  ─── player.js ─────┘
```

---

## 1. The build, and why there is one

`src/` is eight files. The deliverable is one. Browsers give a `file://` page no
server, and block ES modules and `fetch` on that origin, so nothing can stay a
separate request: `build.py` substitutes every source into placeholders in
`src/main.html` (`/*@RT_ENGINE@*/`, `/*@RT_CSS@*/`, …), base64-ing the fonts
into the CSS on the way.

There is a second reason, specific to this project. **The editor exports decks
by copying its own runtime out of its own DOM.** `editor.js` has one line that
makes the whole thing work:

```js
const rt = id => document.getElementById(id).textContent;
```

`buildExport()` reads `rt('rt-engine')`, `rt('rt-css')`, `rt('rt-player')` and
writes them straight into the file it produces. That is why `main.html` carries
the player as `<script type="text/plain">` — it is source text to be re-emitted,
not code to run. An editor that loaded its engine from a separate file could not
export a standalone deck at all.

```
cd source
python3 build.py          # → dist/Main.html
python3 build.py --test   # → also dist/test-demo.html (runtime only, no editor)
node test-theme.js        # the one self-check: the colour ramps
```

`dist/Main.html` is the editor. Copy it to the repo root to ship it.

---

## 2. The deck format

```jsonc
{
  "title": "…", "subtitle": "…",
  "settings": { "flightSeconds": 1.6, "showGrid": true, "ghosts": false, "fadeAngle": 35 },
  "theme":    { "dark": false, "surface": "neutral", "accent": "accent", "roles": [ … ] },
  "model":    { "files": [ { "asset": "a1b2c3", "name": "shaft.stl", "part": "shaft" } ],
                "upAxis": "z", "size": 9, "parts": { … }, "materials": { … } },
  "steps": [
    { "type": "card", "title": "…", "body": "<p>HTML</p>",
      "focus": ["input"], "highlight": [], "hide": [], "colors": {},
      "explode": 0, "cut": { "axis": "x", "at": 50 },
      "view": { "azimuth": -32, "elevation": 16, "distance": 15 },
      "side": "right", "behind": false, "accent": "warning", "notes": "…" }
  ]
}
```

Binary files (models, images) never live in the JSON. They go in an **asset
map**, `{ id: { name, mime, b64 | buf } }`, and steps refer to them by id. In the
editor that map is `ED.assets`; in an exported file each asset is a
`<script type="application/octet-stream" data-asset="…">` tag the player reads
back at startup. `usedAssets()` garbage-collects unreferenced ones at export.

---

## 3. The engine (`src/engine.js`)

One class, `DeckEngine(host, opts, onState)`. The editor and an exported deck
construct it with the same arguments; only `opts` differs. `onState` is the
only way out — the engine never touches a HUD, it hands a state object to its
caller and lets the caller render.

### Slide types

Two tables, side by side:

- `TYPES` — per type: design size `w`/`h` in CSS px, how it is placed (`side`,
  `center`, `pin`, `labels`), the share of screen width it may take.
- `RENDER` — per type: a function from a step to an HTML string.

Adding a slide type means an entry in each, a default in `samples.js`, a `case`
in `renderStepInspector`, and its CSS in `deck.css`. Nothing else knows the list
exists.

### The flight

A step's `view` is spherical: azimuth, elevation, distance, relative to the
centre of its `focus` parts. `viewFor()` resolves that into a camera position
and target; `fly()` interpolates between two of them in spherical coordinates so
the camera arcs rather than cutting a chord, with a small distance "bump"
proportional to the turn so it pulls back as it swings around. `goTo()` is
`applyStep()` (model state) plus `fly()` (camera).

### Model state

`applyStep` sets four things from the step, and `tick()` eases every mesh toward
them each frame rather than snapping:

| step field | effect |
|---|---|
| `focus` / `highlight` | non-highlighted meshes fade to 0.16 opacity, highlighted ones get an emissive glow |
| `hide` | those parts fade out entirely |
| `colors` | per-part colour, `"*"` for all, `"original"` to restore |
| `explode` | each part moves along the vector from the model centre to its own centre |
| `cut` | one `THREE.Plane` shared by every material, animated to its position |

A **part** is just a name. `model.parts` maps a part name to substrings matched
case-insensitively against node names; one STL per file gets a part name from
the filename for free.

### Slides are DOM, and that has consequences

Slides are real HTML elements positioned in 3D by `CSS3DRenderer`, not textures.
Text stays selectable and sharp, and `deck.css` styles them like any web page.
Two consequences fall out of it, and both are handled in `layout()`:

**Depth.** DOM and WebGL cannot interleave by depth inside one layer. So there
are two CSS3D layers and the canvas sits between them:

```
host ─┬─ div   cssBack    ← slides with "behind": true
      ├─ canvas           ← the model, transparent background
      └─ div   css        ← everything else (default)
```

A step with `behind: true` is wholly behind the model. Occlusion is per slide,
not per pixel — a back slide never passes half-way through the gearbox — and it
cannot take clicks, because the canvas is above it.

**Rasterisation.** A CSS3D element is rasterised at its own CSS size and then
stretched by the 3D transform. A `section` slide is 760 px wide by design but
lands 1205 px wide on a 1080p screen: a 1.6× stretch of an already-painted
layer, which is exactly the soft text that shows on some types and not others.
Measured across the set, at 1080p it ran 1.10× (`split`) to 1.78× (`caption`).

The fix is `zoom`, which is a *layout*-level scale: the text re-lays out at the
larger size and re-rasterises instead of being stretched, leaving the 3D
transform scaling *down*, which was always sharp. But `zoom` also multiplies
the element's own transform, so it cannot go on the element CSS3DRenderer
drives. Hence the wrapper:

```
CSS3DObject ─▶ div.sl-wrap     width = designW × k     ← transformed, never zoomed
                 └─ div.sl     width = designW, zoom: k ← laid out and painted at k×
```

`place()` works out how wide the slide will actually land, picks `k`, and
divides the transform scale by it:

```js
zoomSlide(wrap, zoomFor(wW / (2 * d * tanH) * H / w));
obj.scale.setScalar(wW / (w * wrap.zoomK));
```

`k` is quantised to quarters so small camera moves don't force a repaint,
clamped to `[1, 3]` — scaling down never needed help — and pinned at 1 where
`zoom` is unsupported. The wrapper's height stays `auto`, so a slide whose
content outgrows its design height still sizes its own box. Opacity lives on
the wrapper too, so fading never touches the zoomed child.

### Which slides are visible

`showSlides()` is the single place that decides *which* slides are up, so
anything that changes the answer just calls it again rather than duplicating
the rule:

- **normally** — only the current step's. `ghosts` in deck settings brings back
  the faint floating others. Pinned types (`callout`, `labels`) stay hidden
  either way; a leader line off its own step points at nothing.
- **overview** (`O`) — all of them at once, pulled back to fit.
- **bare** (`M`, the *Model only* button) — none. The camera does not move: the
  point is to see what the slide you are on is covering. It is a mode, not a
  one-shot, so it stays on as you step through, and the button reads *Show
  slides* while it is.

It sets `sl.op`, a target, rather than a style. `tick()` eases each slide's
real opacity toward `sl.op × slideFade()` and writes it only on change. That
second factor is the automatic version of bare mode: `slideFade()` measures the
angle between where the camera is now and the step's own view, and ramps the
slide out from `settings.fadeAngle` degrees to half again as far. Orbit away to
look at the model and the slide gets out of the way by itself. It is off during
a flight (the camera is still on its way to the base view, so the deviation
means nothing) and in overview (no step view to deviate from).

Because the fade is continuous, opacity is eased in the frame loop rather than
by a CSS transition — a `transition` would fight a value that changes every
frame.

### Who owns the pointer

The camera does, over the whole view. Every slide layer is transparent to
hit-testing so orbit, pan and zoom work everywhere, slide included; only the
HUD and `<a>` links inside slides opt back in, plus whole slides in overview
(via a `.pickable` class on the wrapper) where clicking one means "go to that
step".

This needs one line of defence: `CSS3DObject`'s constructor sets
`element.style.pointerEvents = 'auto'` *inline*, which outranks any stylesheet
rule. `buildSlides` clears it right after construction. Miss that and every
hidden slide's wrapper — laid out in 3D all around the model, invisible at
opacity 0 — silently eats clicks across most of the screen.

---

## 4. Colour (`engine.js`, theme block)

Every colour in a deck is a **role** that went through theme-maker's ramp —
one base hex in, a ramp of shades out, no hand-picked values anywhere.

```
role {key, label, base, shades, invert}  ──ramp()──▶  --color-<key>-01 … -NN
```

The **surface** role has 11 shades and always inverts. Every other role has 5
and carries its own `invert` flag. Positions mean the same thing in every role:

| | |
|---|---|
| `-04` | trim that reads against the page — kickers, rules, headings. `--color-accent` aliases this |
| `-05` | a slab — section backgrounds, code blocks |
| `-01` | what sits on that slab |
| `-02` | the hex you picked |

`invert` reads the ramp backwards on a dark deck, which is how a position keeps
its job when the page flips: `-04` stays readable trim, `-05` stays a slab. A
colour that must mean the same hue in both themes — a warning, a pass/fail —
leaves it off.

Two **slots** alias a role into the names the stylesheets use: `surface` →
`--color-neutral-NN` plus `--color-bg`/`-surface`/`-text`/`-divider`, and
`accent` → `--color-accent-NN`. A step can point the accent slot somewhere else
for itself (`"accent": "warning"`), which `slideAccent()` does by re-declaring
those variables on that one slide element.

`applyTheme(el, theme)` writes the lot as inline custom properties. **Where it
writes is what keeps the two palettes apart:** `<html>` in an exported deck,
`#stage` in the editor. The editor's own chrome is a fixed greyscale declared at
the top of `editor.css` on `:root`, flipped by `data-ed-theme` — the deck's
palette is scoped inside `#stage` and never reaches it, and the editor's never
reaches the slides.

---

## 5. The editor (`src/editor.js`)

Plain DOM, one `h()` helper, no framework. State is one object:

```js
ED = { deck, assets, sel, hist, fut, cur, savedSnap, fileName, handle, info, engine, … }
```

`ED.sel` is the selected step index, or `-1` for deck settings. Every edit
handler mutates `ED.deck` in place and calls `changed()`, which debounces three
things: pushing the config to the engine (140 ms), committing an undo snapshot
(450 ms), and redrawing the step list (60 ms). Undo is whole-deck JSON
snapshots in `ED.hist` — a deck is small, and this is the thing that never has
bugs.

The preview is not a simulation. It is the same `DeckEngine` the exported file
runs, mounted on `#stage` with `keys: false` and an `onSlideClick` callback.
What you see is what the file does.

Three other pieces worth knowing:

- **Drafts.** `saveDraftSoon()` writes the whole deck plus assets to IndexedDB
  1.2 s after the last edit, and `boot()` offers it back on next open.
- **Export.** `buildExport()` concatenates runtime strings pulled from the DOM
  with the JSON and the base64 assets, and writes it through the File System
  Access API when available, a download otherwise.
- **Import.** `Open…` takes an exported `.html` back apart — it reads the
  `#deck-data` script and the `data-asset` tags — so the exported file is also
  the project file.

---

## 6. Where to change what

| you want to… | touch |
|---|---|
| add a slide type | `TYPES` + `RENDER` in `engine.js`, defaults in `samples.js`, a `case` in `renderStepInspector`, CSS in `deck.css` |
| change how slides look | `src/deck.css` — address colours as `--color-<role>-NN` only |
| change how the editor looks | `src/editor.css` — the two fixed ramps at the top are the whole palette |
| change camera behaviour | `viewFor`, `fly`, `layout` in `engine.js` |
| change the colour system | the theme block at the top of `engine.js`; `node test-theme.js` guards it against the library |
| change the exported file | `buildExport()` in `editor.js`, `src/player.html`, `src/player.js` |

Licences: three.js (MIT), Draco decoder (Apache-2.0), Barlow (OFL).
