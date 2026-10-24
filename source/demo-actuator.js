// The shipped example deck: the telescopic actuator (assets/actuator.glb), one step of every slide type.
// `python3 build.py --demo` renders this to the Demo HTML at the repo root.
(function () {
const strokeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 380" font-family="Barlow Condensed, sans-serif">' +
  '<rect width="640" height="380" fill="#f2f2f3"/>' +
  '<g fill="#5980a6"><rect x="40" y="63" width="120" height="54" rx="5"/><rect x="40" y="163" width="120" height="54" rx="5"/><rect x="40" y="263" width="120" height="54" rx="5"/></g>' +
  '<g fill="#8c8c90"><rect x="160" y="75" width="40" height="30"/><rect x="160" y="175" width="110" height="30"/><rect x="160" y="275" width="110" height="30"/></g>' +
  '<g fill="#b4b7bb"><rect x="200" y="80" width="30" height="20"/><rect x="270" y="180" width="30" height="20"/><rect x="270" y="280" width="100" height="20"/></g>' +
  '<g fill="#1d2d3d" font-size="30" font-weight="600"><text x="252" y="100">0</text><text x="322" y="200">120</text><text x="392" y="300">240</text></g>' +
  '<g fill="#5d5d60" font-size="22"><text x="300" y="100">mm · retracted</text><text x="400" y="200">mm · stage 1 out</text><text x="470" y="300">mm · both out</text></g></svg>';
const STROKE_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(strokeSvg);

const demo = {
  title: 'Telescopic Linear Actuator',
  subtitle: 'Design review · Rev B',
  settings: { showGrid: true, flightSeconds: 1.6 },
  // Four roles, all through the same ramp. Warning leaves the flip off: an open
  // item should read as the same amber whichever theme the deck is in. It is
  // used inline in the guide-rail callout and as the accent of the risks step.
  theme: { dark: false, surface: 'neutral', accent: 'accent', roles: [
    { key: 'neutral', label: 'Neutral', base: '#8C8C90', shades: 11, invert: true, inter: 0 },
    { key: 'accent', label: 'Accent', base: '#5980A6', shades: 5, invert: true },
    { key: 'accent-2', label: 'Accent 2', base: '#728FAB', shades: 5, invert: true },
    { key: 'warning', label: 'Warning', base: '#C98A1F', shades: 5, invert: false },
  ] },
  model: {
    files: [{ asset: 'actuator', name: 'actuator.glb' }],
    size: 9,
    parts: { housing: 'housing', bearings: 'bearings', screw: 'screw', carriage: 'carriage', stage1: 'stage1', stage2: 'stage2', rodend: 'rodend', guides: 'guides' },
    materials: {
      housing: { color: '#6E7B88', metalness: 0.5, roughness: 0.45 },
      bearings: { color: '#4F5A64', metalness: 0.9, roughness: 0.35 },
      screw: { color: '#C9A227', metalness: 0.9, roughness: 0.3 },
      carriage: { color: '#8C9AA6', metalness: 0.7, roughness: 0.35 },
      stage1: { color: '#C4C8CD', metalness: 0.8, roughness: 0.3 },
      stage2: { color: '#B6BBC1', metalness: 0.8, roughness: 0.28 },
      guides: { color: '#9AA3AC', metalness: 0.7, roughness: 0.4 },
      rodend: { color: '#7E8894', metalness: 0.6, roughness: 0.45 },
    },
  },
  steps: [
    { type: 'title', kicker: 'Design review · Rev B', title: 'Telescopic linear actuator', side: 'right',
      body: 'A two-stage electric column: a ball screw in the head drives a carriage, the carriage pushes one tube out of the next. This review walks the load path from the screw to the rod eye.',
      specs: [['Stroke', '240 mm'], ['Retracted length', '289 mm'], ['Dynamic load', '2.5 kN'], ['Mass', '2.3 kg']],
      view: { azimuth: -32, elevation: 10, distance: 21, shift: 0.3 },
      notes: 'Welcome. Keep this under a minute: what it is, why we are reviewing it today.' },
    { type: 'section', kicker: 'Part 01', number: '01', title: 'Load path', body: 'Screw to rod eye in four stages.', view: { azimuth: -32, elevation: 14, distance: 20 } },
    { type: 'card', kicker: 'Load path · 01', title: 'Head & screw support', side: 'right', focus: ['housing', 'bearings'], view: { azimuth: -70, elevation: 16, fit: 1.7 },
      body: '<p>The motor flange sits on top of the head. A pair of Ø14 × Ø20 thin-section bearings, 16 balls each, take the screw thrust in both directions; the head casting carries the reaction into the mounting lugs.</p>',
      specs: [['Bearing pair', 'Ø14 × Ø20, 16 balls'], ['Head envelope', '53 × 58 × 136 mm'], ['Preload', 'Shim-set, 40 N']] },
    { type: 'split', kicker: 'Load path · 02', title: 'Screw & carriage', side: 'left', highlight: ['screw', 'carriage'], view: { azimuth: 14, elevation: 20, distance: 22, shift: 0.28 },
      body: '<p>A Ø16 screw runs the full length of the head. The carriage rides it and takes the whole axial load; the tubes hang off the carriage flange.</p><p>Lead was set to keep the no-load speed under 60 mm/s at motor rating.</p>',
      body2: '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px 18px;font-variant-numeric:tabular-nums"><div><b>Screw</b> Ø16</div><div><b>Lead</b> 5 mm</div><div><b>Efficiency</b> 0.9</div><div><b>Speed</b> 50 mm/s</div><div><b>Thrust</b> 2.5 kN</div><div><b>Backlash</b> &lt; 0.05 mm</div></div>',
      specs: [['Screw', 'Ø16 × 5 mm lead'], ['Nut', 'Preloaded ball nut'], ['Carriage', 'Aluminium, anodised']] },
    { type: 'callout', kicker: 'Load path · 03', title: 'Guide rails & anti-rotation', side: 'right', focus: ['guides'], highlight: ['guides', 'stage1'], view: { azimuth: 58, elevation: 22, fit: 1.15 },
      body: '<p>Two external rails carry the side load and stop the tubes rotating under torque. They are bolted to the head with M2 cap screws.</p><p style="color:var(--color-warning-04)"><b>Open:</b> rail deflection is 0.4 mm at the 150 N side-load case, 0.1 mm over target.</p>' },
    { type: 'labels', kicker: 'Overview', title: 'Main assemblies', highlight: [], view: { azimuth: -24, elevation: 12, distance: 21 },
      labels: [{ part: 'housing', text: 'Head', note: 'Motor flange, bearings' }, { part: 'guides', text: 'Guide rails', note: 'Anti-rotation' },
        { part: 'stage2', text: 'Stage 2 tube', note: 'Ø24' }, { part: 'rodend', text: 'Rod eye', note: 'Ø18 bore' }] },
    { type: 'metrics', kicker: 'Targets', title: 'Performance against targets', side: 'left', view: { azimuth: 30, elevation: 12, distance: 21, shift: 0.3 }, highlight: [],
      stats: [{ label: 'Thrust', value: '2.5', unit: 'kN', note: 'Target 2.4' }, { label: 'Mass', value: '2.3', unit: 'kg', note: '−0.4 kg vs Rev A' },
        { label: 'Rail deflection', value: '0.4', unit: 'mm', note: 'At 150 N, open' }, { label: 'Backlash', value: '0.04', unit: 'mm', note: 'Measured, 3 units' }] },
    { type: 'table', kicker: 'Duty', title: 'Load and speed table', side: 'right', focus: ['screw', 'carriage'], view: { azimuth: -40, elevation: 24, fit: 2.6 },
      table: { columns: ['Case', 'Load', 'Speed', 'Stroke time'], rows: [['No load', '0 N', '58 mm/s', '4.1 s'], ['Nominal', '1.2 kN', '52 mm/s', '4.6 s'], ['Rated', '2.5 kN', '41 mm/s', '5.9 s'], ['Hold', '3.0 kN', '—', 'Brake on'], ['Static limit', '6.0 kN', '—', '—']] } },
    { type: 'compare', kicker: 'Changes', title: 'Rev A → Rev B', side: 'left', highlight: ['housing'], view: { azimuth: 150, elevation: 14, distance: 22, shift: 0.28 },
      columns: [{ title: 'Rev A', body: '<ul><li>Steel head, machined from bar</li><li>Single deep-groove bearing</li><li>One guide rail</li></ul>' },
        { title: 'Rev B', body: '<ul><li>Cast aluminium head</li><li>Thin-section pair, preloaded</li><li>Two rails, bolted</li></ul>' }] },
    { type: 'caption', kicker: 'Section view', title: 'Cut through the screw', body: 'Head removed and the assembly cut on the screw plane: the bearing pair, the carriage and the two tube shoulders line up on the axis.',
      hide: ['housing'], cut: { axis: 'z', at: 50 }, view: { azimuth: 8, elevation: 6, distance: 19 }, highlight: [] },
    { type: 'caption', kicker: 'Exploded view', title: 'Assembly order', body: 'Parts move apart from the centre so each assembly reads on its own. Drag to orbit.',
      explode: 1.5, hide: ['housing'], rotate: { z: 90 }, view: { azimuth: -38, elevation: 16, distance: 30 }, highlight: [] },
    { type: 'image', kicker: 'Stroke', title: 'Extension sequence', side: 'right', image: STROKE_IMG, imageAlt: 'Three columns: retracted, stage 1 out, both stages out', focus: ['stage1', 'stage2'], view: { azimuth: 70, elevation: 18, fit: 1.9 },
      body: 'Stage 1 goes out first and bottoms on its shoulder, then stage 2 follows. 120 mm each, 240 mm total.' },
    { type: 'code', kicker: 'Verification', title: 'Column buckling check', side: 'left', highlight: ['stage2'], view: { azimuth: 40, elevation: 14, distance: 22, shift: 0.28 }, lang: 'python',
      code: 'def buckling_load(E, I, L, k=2.0):\n    """Euler critical load for a column fixed one end, free the other."""\n    return (3.14159 ** 2) * E * I / (k * L) ** 2\n\n# Stage 2 tube: 24 x 20 steel, fully extended\nI = 3.14159 / 64 * (24e-3 ** 4 - 20e-3 ** 4)\nF = buckling_load(E=210e9, I=I, L=0.29)\nassert F > 3 * 2500, f"margin too thin: {F / 2500:.1f}x"',
      body: 'Runs in CI against every tube size change. Currently passes at 3.4× the rated load.' },
    { type: 'checklist', kicker: 'Next steps', title: 'Open items', side: 'right', focus: ['rodend'], accent: 'warning', view: { azimuth: 128, elevation: 12, fit: 2.2 },
      items: [{ text: 'Rod eye fatigue sign-off at 2.5 kN', status: 'done' }, { text: 'Rail deflection fix (see step 5)', status: 'risk', note: 'Owner: structures · due wk 46' },
        { text: 'IP54 seal at the stage 2 gland', status: 'open' }, { text: 'Supplier PPAP for the ball nut', status: 'blocked', note: 'Waiting on tooling' }] },
    { type: 'timeline', kicker: 'Plan', title: 'Release plan', view: { azimuth: -20, elevation: 12, distance: 21 }, highlight: [],
      milestones: [{ date: 'Jun', title: 'Rev B design freeze', status: 'done' }, { date: 'Oct', title: 'Design review', body: 'This meeting', status: 'current' },
        { date: 'Dec', title: 'Prototype build', body: '12 units', status: 'next' }, { date: 'Mar', title: 'Life test start', status: 'next' }, { date: 'Sep', title: 'SOP', status: 'next' }] },
    { type: 'end', kicker: 'End', title: 'Questions', body: 'Design team · actuator-design@example.com', view: { azimuth: -32, elevation: 14, distance: 20 } },
  ],
};

window.DEMO_DECK = demo;
})();
