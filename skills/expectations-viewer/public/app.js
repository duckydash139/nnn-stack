import { mount } from './vendor/pele.js';
import { journeyChart, renderPage } from './view.mjs';

const root = document.getElementById('app');
const flash = document.getElementById('flash');

const chartHost = document.createElement('div');
chartHost.id = 'chart-host';
const chartBox = document.createElement('div');
chartBox.className = 'chart-box';
chartBox.tabIndex = 0;
chartBox.setAttribute('role', 'region');
chartBox.setAttribute('aria-label', 'Flow chart');
const chartError = document.createElement('div');
chartError.className = 'chart-error';
chartError.hidden = true;
chartHost.append(chartBox, chartError);

let state = null;
let diagram = null;
let drawnSource = null;
let jumped = null;
let jumpTimer;
let flashTimer;
const journeyDiagrams = new Map();
const folds = new Map();
const noteDrafts = new Map();
const noteTimers = new Map();

function say(message, kind = 'info') {
  flash.textContent = message;
  flash.dataset.kind = kind;
  flash.hidden = !message;
  clearTimeout(flashTimer);
  if (kind === 'info') flashTimer = setTimeout(() => say(''), 4000);
}

function showChartError(source, error) {
  chartError.replaceChildren();
  const title = document.createElement('p');
  title.textContent = 'The chart couldn\'t be drawn. Its Mermaid text is below.';
  const message = document.createElement('pre');
  message.className = 'source';
  message.textContent = error?.message ?? String(error);
  const text = document.createElement('pre');
  text.className = 'source';
  text.textContent = source;
  chartError.append(title, message, text);
  chartError.hidden = false;
  chartBox.hidden = true;
}

// A shrunk chart draws nodes shorter than a finger. An invisible shape keeps the target tall.
function fitTapTarget(node, scale) {
  const box = node.querySelector('rect');
  if (!box || !scale) return;
  const width = box.width.baseVal.value;
  const height = Math.max(box.height.baseVal.value, 44 / scale);
  const hit = node.querySelector('.chart-hit') ?? document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('class', 'chart-hit');
  hit.setAttribute('fill', 'transparent');
  hit.setAttribute('d', `M${-width / 2} ${-height / 2}h${width}v${height}h${-width}z`);
  if (!hit.isConnected) node.prepend(hit);
}

function decorateChart() {
  const marks = new Map(state.marks.map((m) => [m.state, m]));
  const places = new Map(state.places.filter((p) => p.state).map((p) => [p.state, p]));
  const svg = chartBox.querySelector('svg');
  const scale = svg ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 0;
  for (const node of chartBox.querySelectorAll('[data-id]')) {
    const mark = marks.get(node.dataset.id);
    const place = places.get(node.dataset.id);
    node.classList.toggle('undecided', Boolean(mark?.undecided));
    node.classList.toggle('has-decision', Boolean(mark));
    node.classList.toggle('takes-note', Boolean(place && !mark));
    node.classList.toggle('has-note', Boolean(place?.note));
    if (mark) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'link');
      node.setAttribute('aria-label', `${node.textContent.trim()}, go to decision: ${mark.title}`);
      fitTapTarget(node, scale);
    } else if (place) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `${node.textContent.trim()}, ${place.note ? 'your note' : 'add note'}`);
      fitTapTarget(node, scale);
    } else {
      node.removeAttribute('tabindex');
      node.removeAttribute('role');
      node.removeAttribute('aria-label');
      node.querySelector('.chart-hit')?.remove();
    }
  }
}

function drawChart() {
  const slot = document.getElementById('chart-slot');
  if (!slot) return;
  slot.replaceWith(chartHost);
  const source = state.draft.chart;
  if (source === drawnSource) return decorateChart();
  drawnSource = source;
  chartError.hidden = true;
  chartBox.hidden = false;
  const onRender = () => {
    chartError.hidden = true;
    chartBox.hidden = false;
    decorateChart();
  };
  const onError = (error) => showChartError(drawnSource, error);
  try {
    if (diagram) diagram.update(source);
    else diagram = mount(chartBox, source, { links: false, images: false, onRender, onError });
  } catch (error) {
    showChartError(source, error);
  }
}

// The page repaints from scratch, so each diagram lives outside it and moves back into its slot.
function drawJourneys() {
  for (const slot of root.querySelectorAll('[data-journey-chart]')) {
    const index = slot.dataset.journeyChart;
    const journey = state.draft.journeys[index];
    const source = journeyChart(journey);
    let entry = journeyDiagrams.get(index);
    if (!entry) {
      const box = document.createElement('div');
      box.className = 'chart-box';
      box.tabIndex = 0;
      box.setAttribute('role', 'region');
      entry = { box };
      journeyDiagrams.set(index, entry);
    }
    entry.box.setAttribute('aria-label', `Journey diagram: ${journey.name}`);
    slot.replaceWith(entry.box);
    if (entry.source === source) continue;
    entry.source = source;
    const onError = () => {
      entry.box.textContent = source;
    };
    try {
      if (entry.diagram) entry.diagram.update(source);
      else entry.diagram = mount(entry.box, source, { links: false, images: false, onError });
    } catch {
      onError();
    }
  }
}

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const currentMode = () => document.documentElement.dataset.mode ?? (systemDark.matches ? 'dark' : 'light');

function labelMode() {
  const button = document.getElementById('mode');
  if (!button) return;
  const next = currentMode() === 'dark' ? 'light' : 'dark';
  button.textContent = next === 'dark' ? 'Dark' : 'Light';
  button.setAttribute('aria-label', `Switch to ${next} mode`);
}

// Landing back on the system's own mode drops the override, so the page follows the system again.
function toggleMode() {
  const next = currentMode() === 'dark' ? 'light' : 'dark';
  const followsSystem = next === (systemDark.matches ? 'dark' : 'light');
  if (followsSystem) delete document.documentElement.dataset.mode;
  else document.documentElement.dataset.mode = next;
  try {
    if (followsSystem) localStorage.removeItem('viewer-mode');
    else localStorage.setItem('viewer-mode', next);
  } catch {}
  labelMode();
}

systemDark.addEventListener('change', labelMode);

function openNote(target) {
  const area = root.querySelector(`textarea[data-note="${CSS.escape(target)}"]`);
  if (!area) return;
  const fold = area.closest('details');
  fold.open = true;
  folds.set(fold.id, true);
  area.focus();
}

function jumpTo(id) {
  const target = document.getElementById(id);
  if (!target) return;
  jumped = id;
  history.replaceState(null, '', `#${id}`);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
  paintJump();
  clearTimeout(jumpTimer);
  jumpTimer = setTimeout(() => {
    jumped = null;
    paintJump();
  }, 2400);
}

function paintJump() {
  for (const el of document.querySelectorAll('.jumped')) el.classList.remove('jumped');
  if (jumped) document.getElementById(jumped)?.classList.add('jumped');
}

function paint() {
  const active = document.activeElement;
  const keep = active?.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;

  root.innerHTML = renderPage(state).toString();
  document.title = state.draft?.title ?? 'Expectations viewer';

  for (const [id, open] of folds) {
    const fold = document.getElementById(id);
    if (fold) fold.open = open;
  }
  for (const area of root.querySelectorAll('textarea[data-note]')) {
    if (noteDrafts.has(area.dataset.note)) area.value = noteDrafts.get(area.dataset.note);
  }
  drawChart();
  drawJourneys();
  paintJump();
  labelMode();
  spy();

  const again = keep && document.getElementById(keep.id);
  if (again && !again.disabled) {
    again.focus({ preventScroll: true });
    if (again.tagName === 'TEXTAREA') again.setSelectionRange(keep.start, keep.end);
  }
}

function adopt(next) {
  const changed = state && state.hash && next.hash !== state.hash;
  state = next;
  paint();
  if (changed) say(`Draft updated at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
}

async function refresh() {
  const res = await fetch('/api/state');
  adopt(await res.json());
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) {
    say(data.error, 'bad');
    await refresh();
    return false;
  }
  adopt(data);
  return true;
}

async function saveNote(id) {
  clearTimeout(noteTimers.get(id));
  noteTimers.delete(id);
  if (!noteDrafts.has(id)) return;
  const note = noteDrafts.get(id);
  // Decision ids can't hold a colon, and place targets always do.
  const saved = await (id.includes(':') ? post('/api/note', { target: id, note }) : post('/api/answer', { id, note }));
  if (saved && noteDrafts.get(id) === note) noteDrafts.delete(id);
}

const decisionById = (id) => state.decisions.find((d) => d.id === id);

root.addEventListener('change', (e) => {
  const input = e.target;
  if (input.type !== 'radio') return;
  const id = input.dataset.decision;
  post('/api/answer', { id, pick: input.value, decisionSha256: decisionById(id).sha256 });
});

root.addEventListener('input', (e) => {
  const id = e.target.dataset?.note;
  if (!id) return;
  noteDrafts.set(id, e.target.value);
  clearTimeout(noteTimers.get(id));
  noteTimers.set(id, setTimeout(() => saveNote(id), 500));
});

root.addEventListener('focusout', (e) => {
  const id = e.target.dataset?.note;
  if (id) saveNote(id);
});

root.addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action]');
  if (button?.dataset.action === 'mode') return toggleMode();
  if (button?.dataset.action === 'note') return openNote(button.dataset.target);
  if (button?.dataset.action === 'approve') {
    await Promise.all([...noteDrafts.keys()].map(saveNote));
    await post('/api/approve', { draftSha256: state.hash });
    return;
  }
  if (button?.dataset.action === 'keep') {
    const id = button.dataset.decision;
    post('/api/answer', { id, pick: button.dataset.pick, decisionSha256: decisionById(id).sha256 });
    return;
  }
  const toggle = e.target.closest('summary.note-toggle');
  if (toggle) {
    e.preventDefault();
    const fold = toggle.parentElement;
    fold.open = !fold.open;
    folds.set(fold.id, fold.open);
    if (fold.open) fold.querySelector('textarea').focus();
    return;
  }
  const link = e.target.closest('a[href^="#"]');
  if (link) {
    e.preventDefault();
    jumpTo(link.getAttribute('href').slice(1));
  }
});

root.addEventListener('toggle', (e) => {
  if (e.target.tagName !== 'DETAILS') return;
  folds.set(e.target.id, e.target.open);
}, true);

function chartAction(e) {
  const id = e.target.closest?.('[data-id]')?.dataset.id;
  const mark = state.marks.find((m) => m.state === id);
  if (mark) return () => jumpTo(`decision-${mark.decision}`);
  const place = state.places.find((p) => p.state === id);
  return place ? () => openNote(place.target) : null;
}

chartBox.addEventListener('click', (e) => chartAction(e)?.());

chartBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const action = chartAction(e);
  if (!action) return;
  e.preventDefault();
  action();
});

const events = new EventSource('/api/events');
events.addEventListener('change', refresh);
events.onopen = () => {
  if (flash.dataset.kind === 'lost') say('');
  refresh();
};
events.onerror = () => {
  // The server stops on purpose after an approval, so that is not a lost connection.
  if (state?.approval.status === 'current') {
    events.close();
    return say('Approved. Claude has your answers, so you can close this tab.');
  }
  say('The viewer server stopped. Answers won\'t save until it\'s back.', 'lost');
};

// Marks the section and the item under the top bar in the outline.
function spy() {
  const line = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h')) + 48;
  const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
  let top = null;
  let sub = null;
  for (const a of document.querySelectorAll('.outline a')) {
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (!el || (el.getBoundingClientRect().top > line && !(atEnd && !a.classList.contains('sub-link')))) continue;
    if (a.classList.contains('sub-link')) sub = a;
    else {
      top = a;
      sub = null;
    }
  }
  for (const a of document.querySelectorAll('.outline [aria-current]')) a.removeAttribute('aria-current');
  top?.setAttribute('aria-current', 'true');
  sub?.setAttribute('aria-current', 'true');
}

let spyFrame = 0;
addEventListener('scroll', () => {
  cancelAnimationFrame(spyFrame);
  spyFrame = requestAnimationFrame(spy);
}, { passive: true });
addEventListener('resize', spy);

await refresh();
if (location.hash) jumpTo(location.hash.slice(1));
