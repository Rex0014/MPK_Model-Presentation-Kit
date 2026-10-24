// Player for an exported deck: reads the embedded deck data and assets, starts the engine, drives the HUD.
(function () {
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
let cfg, assets = {};
try {
  cfg = JSON.parse($('deck-data').textContent);
  document.querySelectorAll('script[data-asset]').forEach(s => { assets[s.dataset.asset] = { name: s.dataset.name, mime: s.dataset.mime, b64: s.textContent.trim() }; });
} catch (e) {
  $('loading').hidden = true; $('error').hidden = false; $('error-msg').textContent = 'The deck data in this file is damaged: ' + e.message;
  return;
}
let built = false, notesOn = false;
function render(st, p) {
  $('loading').hidden = !st.loading;
  $('error').hidden = !st.error; $('error-msg').textContent = st.error || '';
  $('title').textContent = st.title; $('subtitle').textContent = st.subtitle;
  $('reset').hidden = !st.orbited;
  $('notice').hidden = !st.notice; $('notice').textContent = st.notice || '';
  $('overview').textContent = st.overview ? 'Back to step' : 'Overview';
  $('bare').textContent = st.bare ? 'Show slides' : 'Model only';
  const list = $('steps');
  if (!built && st.steps.length) {
    built = true;
    list.classList.toggle('compact', st.steps.length > 8);
    st.steps.forEach((s, i) => {
      const b = document.createElement('button'); b.className = 'step-btn'; b.title = s.title || '';
      b.innerHTML = '<span class="step-num">' + pad(i + 1) + '</span><span class="step-t"></span>';
      b.lastChild.textContent = s.title || '';
      b.addEventListener('click', () => p.goTo(i)); list.appendChild(b);
    });
    $('notes-btn').hidden = !st.steps.some(s => s.notes);
  }
  [...list.children].forEach((b, i) => b.setAttribute('aria-current', !st.overview && i === st.current ? 'step' : 'false'));
  const note = (st.steps[st.current] || {}).notes || '';
  $('notes').hidden = !notesOn || !note || st.overview; $('notes-text').textContent = note;
  if (!st.loading && history.replaceState && !st.overview) try { history.replaceState(null, '', '#' + (st.current + 1)); } catch (e) { }
}
const deck = new DeckEngine($('stage'), { config: cfg, assets, remember: true, themeRoot: document.documentElement }, render);
const fs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
const notes = () => { notesOn = !notesOn; render(deck.state, deck); };
addEventListener('keydown', e => {
  if (e.key === 'f' || e.key === 'F') fs();
  else if (e.key === 'n' || e.key === 'N') notes();
});
$('prev').addEventListener('click', () => deck.prev());
$('next').addEventListener('click', () => deck.next());
$('overview').addEventListener('click', () => deck.toggleOverview());
$('bare').addEventListener('click', () => deck.toggleBare());
$('reset').addEventListener('click', () => deck.resetView());
$('fs').addEventListener('click', fs);
$('notes-btn').addEventListener('click', notes);
document.title = cfg.title || document.title;
deck.start();
window.deck = deck;
})();
