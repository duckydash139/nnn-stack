class Safe {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

export const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const part = (v) => {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.text;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
};

// Every interpolated value is escaped unless it came from this same tag.
export function html(strings, ...values) {
  return new Safe(strings.reduce((out, s, i) => out + part(values[i - 1]) + s));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const disabledIf = (off) => (off ? html`disabled` : '');

// What still needs the human: an open decide item, or any answer whose wording changed.
const needsYou = (d) => d.status === 'recheck' || (d.tier === 'decide' && d.status !== 'answered');
const nextOpen = (s) => s.decisions.find((d) => d.status === 'recheck') ?? s.decisions.find(needsYou);
const rulesOf = (s, d) => s.draft.rules.filter((r) => r.rows.some((row) => row.cells.some((c) => typeof c === 'object' && c.decision === d.id)));

function statusLine(s) {
  const { decideLeft, recheck } = s.progress;
  if (s.approval.status === 'current') return 'Approved. Claude has your answers, so you can close this tab.';
  if (s.canApprove) return 'Ready to approve. Your answers save as you go.';
  if (recheck) return `${plural(recheck, 'answer')} to check again, because the wording changed.`;
  if (decideLeft) return `${plural(decideLeft, 'decision')} left before you can approve.`;
  return s.blockers[0] ?? '';
}

function bar(s) {
  const approved = s.approval.status === 'current';
  const label = s.approval.status === 'stale' ? 'Approve again' : approved ? 'Approved' : 'Approve';
  const blocked = !s.canApprove || approved;
  return html`
    <header class="bar">
      <div class="bar-title">
        <strong>${s.draft?.title ?? 'Expectations viewer'}</strong>
        <span>${s.draft?.milestone}</span>
      </div>
      <div class="bar-status" role="status">
        <strong class="num" id="progress">${s.progress.decided} of ${s.progress.total} decided</strong>
        <span id="status-line">${statusLine(s)}</span>
      </div>
      ${!approved && s.draft && nextOpen(s) && html`<a class="btn" id="next-open" href="#decision-${nextOpen(s).id}">Next open</a>`}
      <button type="button" class="btn" id="mode" data-action="mode">Theme</button>
      <button type="button" class="btn btn-primary" id="approve" data-action="approve" ${disabledIf(blocked)}>${label}</button>
    </header>`;
}

function banners(s) {
  const stale = s.approval.status === 'stale';
  const reasons = { draft: 'the draft changed', answers: 'an answer changed' };
  return html`
    ${s.problem && html`
      <section class="banner banner-bad" role="alert" id="draft-problem">
        <h2>${s.problem.title}</h2>
        <ul>${s.problem.details.map((d) => html`<li>${d}</li>`)}</ul>
        <p>${s.draft ? 'This is the last good version. Answers and approval are off until the file is fixed.' : 'Nothing to show yet. The page refreshes when the file is fixed.'}</p>
      </section>`}
    ${s.answersProblem && html`
      <section class="banner banner-bad" role="alert">
        <h2>The answers file has a problem</h2>
        <p>${s.answersProblem}</p>
        <p>Saving is off, so the file isn't overwritten. Fix or remove it.</p>
      </section>`}
    ${stale && html`
      <section class="banner" id="approval-stale">
        <h2>Your approval is out of date</h2>
        <p>You approved on ${when(s.approval.at)}. Since then, ${s.approval.reasons.map((r) => reasons[r]).join(' and ')}. Check what moved, then approve again.</p>
      </section>`}
    ${s.orphans.length > 0 && html`
      <section class="banner" id="orphans">
        <p>${plural(s.orphans.length, 'answer')} for decisions the draft no longer has. They're kept in answers.json and don't count.</p>
      </section>`}
    ${s.orphanNotes.length > 0 && html`
      <section class="banner" id="orphan-notes">
        <p>${plural(s.orphanNotes.length, 'note')} on places the draft no longer has. They're kept in answers.json.</p>
      </section>`}`;
}

function contextSection(s) {
  const c = s.draft.context;
  return html`
    <section id="context">
      <h2>Context</h2>
      <p class="preface">${c.summary}</p>
      <dl class="facts">
        <div><dt>Today</dt><dd>${c.today}</dd></div>
        <div><dt>What changes</dt><dd>${c.changes}</dd></div>
        <div><dt>Left out</dt><dd>${c.outOfScope.length ? html`<ul class="plain">${c.outOfScope.map((x) => html`<li>${x}</li>`)}</ul>` : 'Nothing.'}</dd></div>
      </dl>
    </section>`;
}

function placeNotes(s, id, title, places) {
  if (!places.length) return '';
  const off = !s.live || Boolean(s.answersProblem);
  const saved = places.filter((p) => p.note).length;
  return html`
    <details class="place-notes" id="${id}" ${saved ? html`open` : ''}>
      <summary><span class="step-name">${title}</span> ${saved > 0 && html`<span class="count num">${saved} saved</span>`}</summary>
      <div class="place-list">
        ${places.map((p) => html`
          <label class="place-note" for="place-note-${p.index}">
            <span>${p.label}</span>
            <textarea id="place-note-${p.index}" class="note" rows="1" maxlength="5000" data-note="${p.target}" ${disabledIf(off)}>${p.note}</textarea>
          </label>`)}
      </div>
    </details>`;
}

function chartSection(s) {
  const chart = s.draft.chart;
  const uses = (name) => new RegExp(`(^\\s*class\\s.*\\b${name}\\b)|(:::${name}\\b)`, 'm').test(chart);
  const open = s.marks.filter((m) => m.undecided).length;
  return html`
    <section id="flow">
      <h2>Flow</h2>
      <p class="preface">Each box is a state a person can see, and each arrow is what moves it on.</p>
      <p class="legend">
        <span class="key ${open ? 'key-undecided' : 'key-clear'}">${open ? `${plural(open, 'state')} waiting on you. Select one to go to its decision.` : 'No state is waiting on you.'}</span>
        ${uses('breaks') && html`<span class="key key-breaks">Breaks a rule</span>`}
        ${uses('mayBreak') && html`<span class="key key-maybreak">May break a rule</span>`}
        ${uses('bugPath') && html`<span class="key key-bugpath">Path to a bug</span>`}
        <span>Select any other state to leave a note on it.</span>
      </p>
      <div id="chart-slot"><pre class="source">${chart}</pre></div>
      ${placeNotes(s, 'state-notes', 'Notes on states', s.places.filter((p) => p.state))}
    </section>`;
}

function option(d, o, off) {
  const inputId = `pick-${d.id}-${o.key}`;
  const picked = d.answer?.pick === o.key;
  return html`
    <label class="option" for="${inputId}">
      <input type="radio" id="${inputId}" name="pick-${d.id}" value="${o.key}" data-decision="${d.id}" ${picked ? html`checked` : ''} ${disabledIf(off)}>
      <span class="option-key">${o.key}</span>
      <span class="option-text">${o.text}</span>
      ${d.proposed === o.key && html`<span class="tag tag-out">Proposed</span>`}
    </label>`;
}

function statusTag(d) {
  if (d.status === 'recheck') return html`<span class="tag tag-on">Check again</span>`;
  if (d.status === 'answered') return html`<span class="tag tag-in">Picked ${d.answer.pick}</span>`;
  return html`<span class="tag tag-out">${d.tier === 'glance' ? `Proposed ${d.proposed}` : 'Open'}</span>`;
}

function noteFold(d, off) {
  const saved = d.answer?.note ?? '';
  return html`
    <details class="note-fold" id="note-fold-${d.id}" ${saved ? html`open` : ''}>
      <summary class="note-toggle" id="note-toggle-${d.id}">${saved ? 'Your note' : 'Add note'}</summary>
      <textarea id="note-${d.id}" class="note" rows="2" maxlength="5000" data-note="${d.id}" aria-label="Note for the agent on: ${d.title}" ${disabledIf(off)}>${saved}</textarea>
    </details>`;
}

function decision(s, d) {
  const off = !s.live || Boolean(s.answersProblem);
  return html`
    <article class="decision" id="decision-${d.id}" tabindex="-1" data-status="${d.status}">
      <div class="decision-read">
        <p class="decision-meta">
          <span class="tag">${d.tier === 'decide' ? 'Decide' : 'Glance'}</span>
          ${statusTag(d)}
        </p>
        <h3>${d.title}</h3>
        <p class="story">${d.story}</p>
        ${d.stateLabels.length > 0 && html`<p class="touches">In the chart: <a href="#flow">${d.stateLabels.join(', ')}</a></p>`}
        ${rulesOf(s, d).length > 0 && html`<p class="touches">In the rules: ${rulesOf(s, d).map((r, i) => html`${i ? ', ' : ''}<a href="#rule-${r.id}">${r.statement}</a>`)}</p>`}
      </div>
      <div class="decision-act">
        ${d.status === 'recheck' && html`
          <p class="recheck">
            <span>The wording changed after you picked ${d.answer.pick}.</span>
            ${d.options.some((o) => o.key === d.answer.pick) && html`
              <button type="button" class="btn" data-action="keep" data-decision="${d.id}" data-pick="${d.answer.pick}" ${disabledIf(off)}>Keep ${d.answer.pick}</button>`}
          </p>`}
        <fieldset class="options">
          <legend class="visually-hidden">Options for ${d.title}</legend>
          ${d.options.map((o) => option(d, o, off))}
        </fieldset>
        ${noteFold(d, off)}
      </div>
    </article>`;
}

function decisionsSection(s) {
  const body = s.decisions.length
    ? s.decisions.map((d) => decision(s, d))
    : html`<p class="empty">Nothing needs a decision in this draft.</p>`;
  const intro = s.decisions.length > 0 && html`<p class="preface">Pick an option on each item marked Decide. An item marked Glance has a proposed answer, which stands unless you pick another. Add a note to anything you want changed.</p>`;
  return html`<section id="decisions"><h2>Decisions</h2>${intro}<div class="ruled">${body}</div></section>`;
}

function cell(s, value) {
  if (typeof value === 'string') return html`<td>${value}</td>`;
  const d = s.decisions.find((x) => x.id === value.decision);
  const settled = d.status === 'answered';
  const text = settled ? `Picked ${d.answer.pick}` : '?';
  const label = `${settled ? `Picked ${d.answer.pick} on` : 'Open decision'}: ${d.title}`;
  return html`<td><a class="cell-link ${settled ? '' : 'cell-open'}" href="#decision-${d.id}" aria-label="${label}">${text}</a></td>`;
}

function doorNote(s, rule, index) {
  const place = s.places.find((p) => p.rule === rule.id && p.row === index);
  return html`<button type="button" class="note-link" data-action="note" data-target="${place.target}">${place.note ? 'Your note' : 'Add note'}</button>`;
}

function rulesSection(s) {
  const body = s.draft.rules.length
    ? s.draft.rules.map((r) => html`
      <div class="rule" id="rule-${r.id}">
        <h3>${r.statement}</h3>
        <div class="table-box" tabindex="0" role="region" aria-label="Door table: ${r.statement}">
          <table>
            <thead><tr><th scope="col">Door</th>${r.columns.map((c) => html`<th scope="col">${c}</th>`)}</tr></thead>
            <tbody>
              ${r.rows.map((row, index) => html`
                <tr>
                  <th scope="row">${row.door}${row.cite && html`<code>${row.cite}</code>`}${doorNote(s, r, index)}</th>
                  ${row.cells.map((c) => cell(s, c))}
                </tr>`)}
            </tbody>
          </table>
        </div>
        ${placeNotes(s, `door-notes-${r.id}`, 'Notes on doors', s.places.filter((p) => p.rule === r.id))}
      </div>`)
    : html`<p class="empty">No rules in this draft.</p>`;
  const intro = s.draft.rules.length > 0 && html`<p class="preface">Each rule has a table. A row is a door: anything that can change what the rule protects, such as an action, a scheduled job, or another system. A column is a state that thing can be in. A cell says what happens, and a ? is a decision still open.</p>`;
  return html`<section id="rules"><h2>Rules</h2>${intro}${body}</section>`;
}

// Mermaid has no escape for these inside a label, so they become spaces.
const label = (text) => String(text).replace(/[\r\n"#;:]+/g, ' ').trim();

// Drawn from the steps, so the diagram can't drift from them or leave out a bad case.
export function journeyChart(j) {
  const states = [];
  const arrows = [];
  const bad = [];
  j.steps.forEach((st, k) => {
    states.push(`  state "${label(st.name)}" as step${k}`);
    arrows.push(`  ${k === 0 ? '[*]' : `step${k - 1}`} --> step${k}`);
    st.failures.forEach((f, m) => {
      const id = `bad${k}x${m}`;
      states.push(`  state "${label(f.then)}" as ${id}`);
      arrows.push(`  step${k} --> ${id} : ${label(f.when)}`);
      bad.push(`  class ${id} breaks`);
    });
  });
  if (j.steps.length) arrows.push(`  step${j.steps.length - 1} --> [*]`);
  return ['stateDiagram-v2', '  direction TB', ...states, ...arrows, ...bad].join('\n');
}

function step(j, jIndex, st, index) {
  return html`
    <li>
      <details id="step-${jIndex}-${index}">
        <summary><span class="step-name">${st.name}</span> <span class="count num">${plural(st.lines.length, 'line')}</span></summary>
        <ul class="lines">${st.lines.map((l) => html`<li>${l}</li>`)}</ul>
      </details>
      ${st.failures.length > 0 && html`
        <ul class="failures" aria-label="Bad cases for ${st.name}">
          ${st.failures.map((f) => html`<li><strong>If ${f.when}</strong> <span>${f.then}</span></li>`)}
        </ul>`}
    </li>`;
}

function journeysSection(s) {
  const body = s.draft.journeys.length
    ? s.draft.journeys.map((j, i) => html`
      <div class="journey" id="journey-${i}">
        <h3>${j.name}</h3>
        <dl class="facts">
          <div><dt>Who</dt><dd>${j.who}</dd></div>
          <div><dt>Starts from</dt><dd>${j.startsFrom}</dd></div>
          <div><dt>Wants</dt><dd>${j.wants}</dd></div>
        </dl>
        <p class="legend"><span class="key key-breaks">Bad case</span></p>
        <div data-journey-chart="${i}"><pre class="source">${journeyChart(j)}</pre></div>
        <ol class="steps">${j.steps.map((st, k) => step(j, i, st, k))}</ol>
        ${j.holds.length > 0 && html`
          <div class="holds">
            <h4>True at every step</h4>
            <ul>${j.holds.map((h) => html`<li>${h.rule ? html`<a href="#rule-${h.rule}">${h.text}</a>` : h.text}</li>`)}</ul>
          </div>`}
      </div>`)
    : html`<p class="empty">No journeys in this draft.</p>`;
  const intro = s.draft.journeys.length > 0 && html`<p class="preface">The main path for each goal. Open a step to read what the product must do there. Bad cases show what happens when the step goes wrong.</p>`;
  return html`<section id="journeys"><h2>Journeys</h2>${intro}${body}</section>`;
}

function lowStakesSection(s) {
  const n = s.draft.lowStakes.length;
  return html`
    <section id="low-stakes">
      <details id="low-stakes-fold">
        <summary><span class="step-name">${plural(n, 'line')} the agent decided</span></summary>
        <p class="preface">Small calls that follow the usual default. Add a note on a decision if one of these is wrong.</p>
        <ul class="lines">${s.draft.lowStakes.map((l) => html`<li>${l}</li>`)}</ul>
      </details>
    </section>`;
}

function outline(s) {
  const d = s.draft;
  const open = s.decisions.filter(needsYou).length;
  const dot = (x) => (needsYou(x) ? 'open' : x.status === 'answered' ? 'done' : 'glance');
  const said = { open: 'needs you', done: 'picked', glance: 'proposal stands' };
  const sub = (items) => items.length > 0 && html`<ol class="sub">${items}</ol>`;
  return html`
    <nav class="outline" aria-label="Sections">
      <ol>
        <li><a href="#context">Context</a></li>
        <li>
          <a href="#decisions">Decisions ${open > 0 ? html`<span class="count num">${open} open</span>` : html`<span class="count">done</span>`}</a>
          ${sub(s.decisions.map((x) => html`
            <li><a class="sub-link" href="#decision-${x.id}"><span class="dot dot-${dot(x)}" aria-hidden="true"></span><span class="clamp">${x.title}</span><span class="visually-hidden">, ${said[dot(x)]}</span></a></li>`))}
        </li>
        <li><a href="#flow">Flow</a></li>
        <li>
          <a href="#rules">Rules</a>
          ${sub(d.rules.map((r) => html`<li><a class="sub-link" href="#rule-${r.id}"><span class="clamp">${r.statement}</span></a></li>`))}
        </li>
        <li>
          <a href="#journeys">Journeys</a>
          ${sub(d.journeys.map((j, i) => html`<li><a class="sub-link" href="#journey-${i}"><span class="clamp">${j.name}</span></a></li>`))}
        </li>
        <li><a href="#low-stakes">Agent's calls <span class="count num">${d.lowStakes.length}</span></a></li>
      </ol>
    </nav>`;
}

export function renderPage(s) {
  return html`
    ${bar(s)}
    <div class="layout">
    ${s.draft && outline(s)}
    <main class="page">
      ${banners(s)}
      ${s.draft && html`
        ${contextSection(s)}
        ${decisionsSection(s)}
        ${chartSection(s)}
        ${rulesSection(s)}
        ${journeysSection(s)}
        ${lowStakesSection(s)}`}
    </main>
    </div>`;
}
