// Starter deck + per-type defaults for the editor.
(function () {
const blank = {
  title: 'Untitled presentation', subtitle: '', settings: { showGrid: true, flightSeconds: 1.6 }, model: null,
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

window.DECK_SAMPLES = { blank, defaults };
})();
