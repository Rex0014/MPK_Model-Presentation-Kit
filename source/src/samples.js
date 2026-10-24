// Starter decks for the editor. The demo uses the built-in procedural gearbox and shows every slide type.
(function () {
const shiftSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 380" font-family="Barlow Condensed, sans-serif">' +
  '<rect width="640" height="380" fill="#f2f2f3"/><g stroke="#416180" stroke-width="10" stroke-linecap="square" fill="none">' +
  '<path d="M140 80v220M320 80v220M500 80v220M140 190h360"/></g>' +
  '<g fill="#1d2d3d" font-size="44" font-weight="600" text-anchor="middle"><text x="140" y="60">1</text><text x="140" y="350">2</text><text x="320" y="60">3</text><text x="320" y="350">4</text><text x="500" y="60">5</text><text x="500" y="350">6</text></g>' +
  '<circle cx="320" cy="190" r="18" fill="#5980a6"/><text x="560" y="200" font-size="22" fill="#5d5d60">N</text></svg>';
const SHIFT_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(shiftSvg);

const demo = {
  title: '6-Speed Manual Transaxle',
  subtitle: 'Design review · Rev C',
  settings: { autoSpin: true, showGrid: true, flightSeconds: 1.6 },
  // Four roles, all through the same ramp. Warning leaves the flip off: an open
  // item should read as the same amber whichever theme the deck is in. It is
  // used inline in the synchro callout and as the accent of the risks step.
  theme: { dark: false, surface: 'neutral', accent: 'accent', roles: [
    { key: 'neutral', label: 'Neutral', base: '#8C8C90', shades: 11, invert: true, inter: 0 },
    { key: 'accent', label: 'Accent', base: '#5980A6', shades: 5, invert: true },
    { key: 'accent-2', label: 'Accent 2', base: '#728FAB', shades: 5, invert: true },
    { key: 'warning', label: 'Warning', base: '#C98A1F', shades: 5, invert: false },
  ] },
  model: { builtin: 'gearbox' },
  steps: [
    { type: 'title', kicker: 'Design review · Rev C', title: '6-speed manual transaxle', side: 'right',
      body: 'Front-wheel-drive, two-shaft countershaft layout with an integrated final drive. This review walks the torque path from the clutch to the half shafts.',
      specs: [['Max input torque', '350 N·m'], ['Dry mass', '42 kg'], ['Shaft centre distance', '72 mm'], ['Oil fill', '2.1 L']],
      view: { azimuth: -32, elevation: 16, distance: 15 },
      notes: 'Welcome. Keep this under a minute: what it is, why we are reviewing it today.' },
    { type: 'section', kicker: 'Part 01', number: '01', title: 'Torque path', body: 'Clutch to half shafts in four stages.', view: { azimuth: -32, elevation: 22, distance: 13 } },
    { type: 'card', kicker: 'Torque path · 01', title: 'Input shaft & clutch', side: 'right', focus: ['input'], view: { azimuth: -70, elevation: 14 },
      body: '<p>A 240 mm single dry-plate clutch drives the splined input shaft. The constant-mesh pair at the bell-housing end transfers torque to the countershaft.</p>',
      specs: [['Clutch disc', 'Ø 240 mm'], ['Input spline', '26T, 1.27 module'], ['Bearings', 'Tapered roller, pre-loaded']] },
    { type: 'split', kicker: 'Torque path · 02', title: 'Gear train', side: 'left', focus: ['gears', 'counter'], view: { azimuth: 12, elevation: 34 },
      body: '<p>Six forward ratios on two parallel shafts. All pairs are helical and ground; the countershaft is hollow to save 1.8 kg.</p><p>Ratios were spread to keep the 2→3 drop under 1.5.</p>',
      body2: '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px 18px;font-variant-numeric:tabular-nums"><div><b>1st</b> 3.538</div><div><b>2nd</b> 2.060</div><div><b>3rd</b> 1.404</div><div><b>4th</b> 1.000</div><div><b>5th</b> 0.811</div><div><b>6th</b> 0.673</div></div>',
      specs: [['Spread', '5.26'], ['Gear type', 'Helical, ground'], ['Countershaft', 'Hollow, induction-hardened']] },
    { type: 'callout', kicker: 'Torque path · 03', title: 'Synchronizers & shift', side: 'right', focus: ['synchros'], highlight: ['synchros', 'shift'], view: { azimuth: 58, elevation: 30 },
      body: '<p>Triple-cone synchros on 1–2, single-cone on 3–4 and 5–6. Forks ride a single shift rail.</p><p style="color:var(--color-warning-04)"><b>Open:</b> 2→3 shift effort is 12% over target at −20 °C.</p>' },
    { type: 'labels', kicker: 'Overview', title: 'Main assemblies', highlight: [], view: { azimuth: -24, elevation: 24, distance: 15 },
      labels: [{ part: 'input', text: 'Input shaft', note: 'Clutch side' }, { part: 'shift', text: 'Shift mechanism', note: 'Single rail, 3 forks' },
        { part: 'diff', text: 'Final drive', note: 'Open differential' }, { part: 'counter', text: 'Countershaft' }] },
    { type: 'metrics', kicker: 'Targets', title: 'Performance against targets', side: 'left', view: { azimuth: 30, elevation: 18, distance: 15 }, highlight: [],
      stats: [{ label: 'Efficiency', value: '97.2', unit: '%', note: 'Target 97.0' }, { label: 'Mass', value: '42', unit: 'kg', note: '−3 kg vs Rev B' },
        { label: 'Shift effort', value: '+12', unit: '%', note: 'At −20 °C, open' }, { label: 'NVH', value: '−2.5', unit: 'dB', note: 'Gear whine, 3rd' }] },
    { type: 'table', kicker: 'Gear train', title: 'Ratio table', side: 'right', focus: ['gears'], view: { azimuth: -40, elevation: 28 },
      table: { columns: ['Gear', 'Ratio', 'Step', 'Speed @ 6500 rpm'], rows: [['1st', '3.538', '—', '52 km/h'], ['2nd', '2.060', '1.72', '89 km/h'], ['3rd', '1.404', '1.47', '131 km/h'], ['4th', '1.000', '1.40', '184 km/h'], ['5th', '0.811', '1.23', '227 km/h'], ['6th', '0.673', '1.21', '250 km/h']] } },
    { type: 'compare', kicker: 'Changes', title: 'Rev B → Rev C', side: 'left', focus: ['housing'], highlight: ['housing'], view: { azimuth: 150, elevation: 20 },
      columns: [{ title: 'Rev B', body: '<ul><li>Cast iron bell housing</li><li>Double-cone 1–2 synchro</li><li>Solid countershaft</li></ul>' },
        { title: 'Rev C', body: '<ul><li>Aluminium bell housing, ribbed</li><li>Triple-cone 1–2 synchro</li><li>Hollow countershaft</li></ul>' }] },
    { type: 'caption', kicker: 'Section view', title: 'Cut through the shafts', body: 'Housing removed and the assembly cut on the shaft plane: the constant-mesh pair and the synchro hubs line up on the main shaft.',
      hide: ['housing'], cut: { axis: 'z', at: 50 }, view: { azimuth: 8, elevation: 12, distance: 12 }, highlight: [] },
    { type: 'caption', kicker: 'Exploded view', title: 'Assembly order', body: 'Parts move apart from the centre so each assembly reads on its own. Drag to orbit.',
      explode: 0.9, hide: ['housing'], view: { azimuth: -38, elevation: 26, distance: 17 }, highlight: [] },
    { type: 'image', kicker: 'Shift', title: 'Shift pattern', side: 'right', image: SHIFT_IMG, imageAlt: 'H-pattern with six gears', focus: ['shift'], view: { azimuth: 70, elevation: 40 },
      body: 'Six-speed H-pattern, neutral gate between 3 and 4. Reverse sits behind a lift-ring lockout (not shown).' },
    { type: 'code', kicker: 'Verification', title: 'Synchro energy check', side: 'left', focus: ['synchros'], view: { azimuth: 40, elevation: 26 }, lang: 'python',
      code: 'def synchro_energy(J, w1, w2):\n    """Energy the cone must absorb per shift, in joules."""\n    return 0.5 * J * (w1 - w2) ** 2\n\n# 2->3 upshift at 6000 rpm, -20 C oil\nE = synchro_energy(J=0.012, w1=628, w2=428)\nassert E < 260, f"cone overload: {E:.0f} J"',
      body: 'Runs in CI against every ratio change. Currently passes with 6 % margin.' },
    { type: 'checklist', kicker: 'Next steps', title: 'Open items', side: 'right', focus: ['diff'], accent: 'warning', view: { azimuth: 128, elevation: 14 },
      items: [{ text: 'Ring-gear tooth contact pattern sign-off', status: 'done' }, { text: 'Shift effort fix (see step 5)', status: 'risk', note: 'Owner: shift team · due wk 46' },
        { text: 'Housing rib revision for NVH', status: 'open' }, { text: 'Supplier PPAP for synchro rings', status: 'blocked', note: 'Waiting on tooling' }] },
    { type: 'timeline', kicker: 'Plan', title: 'Release plan', view: { azimuth: -20, elevation: 20, distance: 14 }, highlight: [],
      milestones: [{ date: 'Jun', title: 'Rev C design freeze', status: 'done' }, { date: 'Oct', title: 'Design review', body: 'This meeting', status: 'current' },
        { date: 'Dec', title: 'Prototype build', body: '12 units', status: 'next' }, { date: 'Mar', title: 'Durability start', status: 'next' }, { date: 'Sep', title: 'SOP', status: 'next' }] },
    { type: 'end', kicker: 'End', title: 'Questions', body: 'Design team · transaxle-design@example.com', view: { azimuth: -32, elevation: 22, distance: 13 } },
  ],
};

const blank = {
  title: 'Untitled presentation', subtitle: '', settings: { autoSpin: true, showGrid: true, flightSeconds: 1.6 }, model: null,
  steps: [{ type: 'title', kicker: 'Kicker', title: 'Presentation title', body: 'Add a model in Deck settings, then add steps.', side: 'right', view: { azimuth: -30, elevation: 16, distance: 15 } }],
};

// Default content for a new step of each type.
const defaults = {
  title: { kicker: 'Kicker', title: 'Title', body: 'One or two sentences.', specs: [['Figure', 'Value']] },
  section: { kicker: 'Part', title: 'Section title', body: '' },
  card: { kicker: 'Kicker', title: 'Card title', body: '<p>Body text.</p>', specs: [] },
  split: { kicker: 'Kicker', title: 'Two columns', body: '<p>Left column.</p>', body2: '<p>Right column.</p>', specs: [] },
  callout: { kicker: 'Kicker', title: 'Callout', body: '<p>Short note.</p>' },
  labels: { title: 'Labels', labels: [{ part: '', text: 'Label', note: '' }], highlight: [] },
  metrics: { kicker: 'Kicker', title: 'Key figures', stats: [{ label: 'Metric', value: '42', unit: 'kg', note: '' }, { label: 'Metric', value: '97', unit: '%', note: '' }] },
  table: { kicker: 'Kicker', title: 'Table', table: { columns: ['Item', 'Value'], rows: [['A', '1'], ['B', '2']] } },
  compare: { kicker: 'Kicker', title: 'Compare', columns: [{ title: 'Before', body: '<ul><li>Point</li></ul>' }, { title: 'After', body: '<ul><li>Point</li></ul>' }] },
  checklist: { kicker: 'Kicker', title: 'Checklist', items: [{ text: 'Item', status: 'open' }, { text: 'Item', status: 'done' }] },
  code: { kicker: 'Kicker', title: 'Code', lang: 'python', code: 'print("hello")', body: '' },
  image: { kicker: 'Kicker', title: 'Image', image: '', body: 'Caption.' },
  timeline: { kicker: 'Plan', title: 'Timeline', milestones: [{ date: 'Q1', title: 'Milestone', status: 'done' }, { date: 'Q2', title: 'Milestone', status: 'current' }, { date: 'Q3', title: 'Milestone', status: 'next' }] },
  caption: { kicker: 'View', title: 'Model view', body: 'One-line caption.' },
  end: { kicker: 'End', title: 'Questions', body: '' },
};

window.DECK_SAMPLES = { demo, blank, defaults };
})();
