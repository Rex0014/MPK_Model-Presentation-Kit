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
node test-theme.js        # the colour ramps, against theme-maker
node test-groups.js       # part/group name resolution
node test-stress.js       # the stress point-cloud join (--bench for timings)
node test-smooth.js       # auto-smooth: crease angle, in degrees
node test-links.js        # step links by id, and the in-place re-tag
```

`dist/Main.html` is the editor. Copy it to the repo root to ship it.

---

## 2. The deck format

```jsonc
{
  "title": "…", "subtitle": "…",
  "settings": { "flightSeconds": 1.6, "showGrid": true, "ghosts": false, "fadeAngle": 35,
                "resolution": 2 },
  "theme":    { "dark": false, "surface": "neutral", "accent": "accent", "roles": [ … ] },
  "model":    { "files": [ { "asset": "a1b2c3", "name": "shaft.stl", "part": "shaft" } ],
                "upAxis": "z", "size": 9, "smooth": 30,
                "parts": { … }, "groups": { … }, "materials": { … } },
  "steps": [
    { "id": "p4f2a1", "type": "card", "title": "…", "body": "<p>HTML</p>",
      "focus": ["input"], "highlight": [], "hide": [], "colors": {},
      "explode": 0, "cut": { "axis": "x", "at": 50 }, "rotate": { "z": 90 },
      "view": { "azimuth": -32, "elevation": 16, "distance": 15 },
      "side": "right", "behind": false, "accent": "warning", "notes": "…",
      "size": 1.2, "dx": 0, "dy": -4,
      "imageH": 240, "imageW": 70, "imageAlign": "center", "imageTop": false,
      "imageRatio": "16/9", "fit": "cover",
      "slideW": 900, "slideH": 520, "fitH": false, "vAlign": "middle",
      "links": [ { "to": "p9c0b3", "label": "The drive train" } ] }
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

That bump has a floor, which is why `fly()` asks `sameView` first. Two steps
can differ only in their slide — same focus, same view, same rotation — and
flying between those is not a short flight but a pointless one: the radius
swells by the floor at the midpoint and comes back, so the camera drifts out
and in across the whole of `flightSeconds` while the orbit controls sit
disabled. When the step's view is the one already on screen, `fly()` takes the
instant path instead: nothing moves, and the controls stay live. Position and
target settle it between them — the spherical pair the flight interpolates in
cannot differ if those two do not — and the shift is in the comparison because
it is part of where the camera looks, so a slide swapping sides over a focused
part still flies. Orbit away first and the camera is no longer at that view, so
the next step flies back to it as it always did.

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
| `rotate` | degrees about x/y/z: the model turns for this step while the floor and camera stay put. Mesh boxes are re-measured at the target angles, so focus framing, label anchors and the cut plane follow it |

A **part** is just a name. `model.parts` maps a part name to substrings matched
case-insensitively against node names; one STL per file gets a part name from
the filename for free.

None of this costs a model reload. The reload key in `setConfig` is geometry
only — files, up axis, size, smooth, edges — because `parts`, `groups`,
`materials` and `fields` are names, lists and colours: `retagMeshes` re-derives
them on the meshes already loaded, from the node names and the `mat0` each mesh
kept from its file. Naming a part used to go through the key, so every keystroke
re-parsed the model and re-smoothed it, and the editor pane was rebuilt under the
caret each time. `onModel` now fires only when the part list actually moves.

A **group** is a name for several parts: `model.groups` maps a group name to a
list of part names. Nothing in the table above knows groups exist. At load time
each mesh gets `tags` — its own part name first, then every group holding it —
and the four places that resolve a name (`partBox`, the highlight/hide pass in
`tick`, `applyColors`, the base-material lookup) ask `tags` instead of `part`.
So a group works wherever a part does, and because the part's own name comes
first in `tags`, a per-part setting wins over its group's. Groups do not nest.
`node test-groups.js` checks that order.

### Stress fields (experimental)

A stress map is a scalar per *vertex*, and the reason that works is that the
FEA mesh is the mesh being displayed. So this is a positional **join**, not an
interpolation: every point in the cloud already sits on a vertex that exists,
and a lookup is needed only because exporters renumber and split vertices (STL
writes three per triangle, GLB splits at normal seams). The tolerance is a weld
tolerance, not an influence radius.

The work happens once, in the editor (`src/stress.js`, which the exported deck
does not carry), because the input does not fit anywhere else:

```
  X Y Z value, 10^7 lines, 10^8 bytes        ← never leaves the editor
            │  streamed through
            ▼
  voxel hash over the MESH vertices (10^5)   ← the bounded side gets the index
            │
            ▼
  Uint16 per vertex over [lo,hi]  →  asset   ← 2 bytes a vertex is what ships
```

Indexing the mesh rather than the cloud is what keeps memory flat — nothing
ever holds the whole file — and it discards the interior nodes of a solid mesh
for free, since only surface vertices ask. `coverage` (matched vertices over
total) is the diagnostic: 100% means the two exports agree, 12% means they do
not, and it says so before anyone believes a picture. Scalar 0 is reserved for
"not measured", which paints grey.

`model.fields[name]` holds `{ asset, lo, hi, unit, vertices }`; a step points at
one with `"stress": { "field": "vonmises", "min": 0, "max": 320 }`. At playback
`setStress()` writes a vertex-colour attribute and sets `material.color` white,
so opacity, the clip plane, explode and the highlight fade all keep working
untouched. The array's length against `vertexCount` is the integrity check — a
different count means a different model, and the field is ignored rather than
painted onto geometry it was not baked for. `model.fields` is excluded from the
model key in `setConfig`, so editing a field never reloads the model.

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
not per pixel — a back slide never passes half-way through the model — and it
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

### Links between steps

A step may carry `links: [{ to, label }]`. `to` is the target step's `id`, so
moving or inserting steps cannot silently re-aim a button; a numeric `to` is
still read as an index for a hand-written deck. `linksHtml` appends an `<a
data-goto="N">` row to the slide (and to a callout's box), `stepIndexOf` resolves
it, and the slide's own click handler intercepts the anchor before its "go to
this slide" behaviour. `<a>` is also what opts the button back into the pointer:
`.sl a` is the one thing on a slide the camera does not own. A link whose target
is gone renders nothing rather than a dead button.

### Placement

Three per-step knobs sit on top of whatever a type does by itself, all of them
no-ops when unset so an old deck is unchanged:

| | |
|---|---|
| `size` | multiplies the slide's share of the frame in `layout()` (0.4–2.5) |
| `dx` / `dy` | nudge across and up, in percent of the visible frame |
| `imageH` / `imageW` / `imageAlign` | the figure's box, written by `figVars` as `--fig-h` / `--fig-w` / `--fig-al`; `deck.css` reads them with the type's design size as the fallback |
| `imageRatio` / `fit` | the figure's shape, the same way: `--fig-ar` / `--fig-fit`. A ratio is the second way to size a figure, so it also writes `--fig-h: auto` and `--fig-flex: none` to get the height and the flex-grow out of its own way |
| `slideW` / `slideH` / `fitH` | the slide's own design box, resolved by `sizeOf`. The box is what `layout()` turns into the on-screen one, and what the element is laid out at — so a narrower box is bigger text in the same frame, not a smaller slide |
| `vAlign` | where the content sits in a slide taller than it needs to be: `--sl-just` on the element. It also writes `--sl-auto: 0`, because the blocks that push themselves down with `margin-top: auto` eat the free space before `justify-content` can see it |

`imageTop` swaps the figure in front of the text on `card` and `split`.

**`fitH` is the only one of these that costs a measurement.** Every other knob
is arithmetic on numbers already in the deck, but a slide that fits its content
has no design height to lay out against, so `layout()` reads the one the element
actually has. It reads it as a *share of the element's own width* rather than as
a raw `offsetHeight`, because the supersampling `zoom` scales both equally and
therefore cancels out of the ratio. `layout()` runs on a resize, on a config
change and once `document.fonts.ready` resolves — never per frame — so the
reflow it forces is not in the frame loop.

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

Because it is the one place that knows which slide is up, it is also where a
`video` slide's element is played and paused — overview included, where every
slide is visible but only one step is current.

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
| middle | the hex you picked — `-03` of 5 shades, `-06` of 11 |

The ramp spans from a near-white end to a near-black one through the base, so
the position of a shade is also roughly its lightness: `-01` is always close to
white and `-NN` close to black, whatever base the role was given. `inter`
(default 20) is how far short of pure white and black the ends stop; MPK no
longer sets it, and `themeOf` drops a stored `inter: 0`, which is what every
deck built before the full-span ramp carries on its surface role.

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
| change how a step is placed | `layout()` in `engine.js` (`size`, `dx`, `dy`), `figVars` + `.sl-fig`/`.sl-bigfig` in `deck.css` for the figure box |
| change the exported file | `buildExport()` in `editor.js`, `src/player.html`, `src/player.js` |

Licences: three.js (MIT), Draco decoder (Apache-2.0), Barlow (OFL).
