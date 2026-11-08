import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { canonicalize, chartStates, decisionHash, draftHash, parseDraft, validateDraft } from '../lib/draft.mjs';
import { answersHash, applyAnswer, applyApproval, applyPlaceNote, deriveState, emptyAnswers, parseAnswers, placeList, writeAtomic } from '../lib/answers.mjs';
import { esc, html, journeyChart, renderPage } from '../public/view.mjs';
import { draftDirProblem, requestProblem, startServer } from '../scripts/serve.mjs';
import { briefLines, checkApproval, unseenLines } from '../scripts/check-approval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../fixture/draft.json');
const fixture = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const now = new Date('2026-11-01T10:00:00Z');

const derive = (draft, answers = emptyAnswers(), extra = {}) =>
  deriveState({ draft, live: true, answers, dir: '/d', ...extra });

const answerAll = (draft) => {
  let answers = emptyAnswers();
  for (const d of draft.decisions.filter((x) => x.tier === 'decide')) {
    answers = applyAnswer(answers, d, { pick: d.options[0].key }, now);
  }
  return answers;
};

describe('fixture', () => {
  test('is valid and carries the requested rule, doors and columns', () => {
    const draft = fixture();
    assert.deepEqual(validateDraft(draft), []);
    const rule = draft.rules.find((r) => r.id === 'OneOrderPerDay');
    assert.deepEqual(rule.rows.map((r) => r.door), ['Place order', 'Amend into this day', 'Late payment lands', 'Admin edit']);
    assert.deepEqual(rule.columns, ['Day free', 'Held by confirmed order', 'Held by unpaid order']);
  });

  test('has no em dashes', () => {
    assert.equal(readFileSync(FIXTURE, 'utf8').includes('—'), false);
  });
});

describe('hash', () => {
  test('ignores key order and formatting, follows content', () => {
    assert.equal(canonicalize({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
    const draft = fixture();
    const reordered = Object.fromEntries(Object.entries(draft).reverse());
    assert.equal(draftHash(reordered), draftHash(draft));
    assert.equal(parseDraft(JSON.stringify(draft, null, 8)).hash, draftHash(draft));
    assert.notEqual(draftHash({ ...draft, title: 'Other' }), draftHash(draft));
    assert.match(draftHash(draft), /^[0-9a-f]{64}$/);
  });

  test('approval is current, then stale when the draft changes', () => {
    const draft = fixture();
    const answers = applyApproval(answerAll(draft), draft, now);
    assert.equal(answers.approval.draftSha256, draftHash(draft));
    assert.equal(answers.approval.at, now.toISOString());
    assert.equal(derive(draft, answers).approval.status, 'current');

    const changed = { ...draft, title: 'Changed' };
    const stale = derive(changed, answers).approval;
    assert.equal(stale.status, 'stale');
    assert.deepEqual(stale.reasons, ['draft']);
  });

  test('approval goes stale when a pick changes afterwards', () => {
    const draft = fixture();
    const approved = applyApproval(answerAll(draft), draft, now);
    const changed = applyAnswer(approved, draft.decisions[0], { pick: 'B' }, now);
    const { status, reasons } = derive(draft, changed).approval;
    assert.equal(status, 'stale');
    assert.deepEqual(reasons, ['answers']);
  });

  test('re-saving the same answer later does not stale an approval', () => {
    const draft = fixture();
    const d = draft.decisions[0];
    const approved = applyApproval(answerAll(draft), draft, now);
    const again = applyAnswer(approved, d, { pick: approved.decisions[d.id].pick }, new Date('2026-11-02T00:00:00Z'));
    assert.equal(answersHash(again), answersHash(approved));
    assert.equal(derive(draft, again).approval.status, 'current');
  });

  test('approval is stale when the draft on disk is invalid', () => {
    const draft = fixture();
    const answers = applyApproval(answerAll(draft), draft, now);
    assert.equal(derive(draft, answers, { live: false }).approval.status, 'stale');
  });
});

describe('stale answers', () => {
  test('a changed story flags the answer and blocks approval', () => {
    const draft = fixture();
    const answers = answerAll(draft);
    assert.equal(derive(draft, answers).canApprove, true);

    const edited = structuredClone(draft);
    edited.decisions[0].story += ' Ann is on holiday.';
    const s = derive(edited, answers);
    const d = s.decisions.find((x) => x.id === edited.decisions[0].id);
    assert.equal(d.status, 'recheck');
    assert.equal(s.progress.recheck, 1);
    assert.equal(s.canApprove, false);
  });

  test('tier and chart state changes do not flag an answer', () => {
    const draft = fixture();
    const answers = answerAll(draft);
    const edited = structuredClone(draft);
    edited.decisions[0].states = [];
    assert.equal(derive(edited, answers).decisions[0].status, 'answered');
  });

  test('a note does not clear the flag, re-picking does', () => {
    const draft = fixture();
    const answers = answerAll(draft);
    const edited = structuredClone(draft);
    const d = edited.decisions[0];
    d.options[0].text = 'Reworded.';
    const withNote = applyAnswer(answers, d, { note: 'hm' }, now);
    assert.equal(derive(edited, withNote).decisions[0].status, 'recheck');
    const repicked = applyAnswer(withNote, d, { pick: 'A' }, now);
    const after = derive(edited, repicked).decisions[0];
    assert.equal(after.status, 'answered');
    assert.equal(after.answer.note, 'hm');
  });

  test('a removed option flags the answer', () => {
    const draft = fixture();
    const answers = applyAnswer(emptyAnswers(), draft.decisions[0], { pick: 'C' }, now);
    const edited = structuredClone(draft);
    edited.decisions[0].options.pop();
    assert.equal(derive(edited, answers).decisions[0].status, 'recheck');
  });

  test('an answer to a removed decision is listed and does not block', () => {
    const draft = fixture();
    const answers = answerAll(draft);
    const edited = structuredClone(draft);
    const removed = edited.decisions.pop();
    const extra = applyAnswer(answers, removed, { pick: 'A' }, now);
    const s = derive(edited, extra);
    assert.deepEqual(s.orphans, [removed.id]);
    assert.equal(s.canApprove, true);
  });
});

describe('derived page state', () => {
  test('decide items sort before glance, and draft order holds inside a tier', () => {
    const draft = fixture();
    draft.decisions.reverse();
    const tiers = derive(draft).decisions.map((d) => d.tier);
    assert.deepEqual(tiers, ['decide', 'decide', 'decide', 'glance', 'glance']);
    assert.equal(derive(draft).decisions[0].id, 'admin-into-held-day');
  });

  test('progress counts answers, marks follow open decisions', () => {
    const draft = fixture();
    const open = derive(draft);
    assert.deepEqual([open.progress.decided, open.progress.total, open.progress.decideLeft], [0, 5, 3]);
    assert.equal(open.marks.find((m) => m.state === 'LatePayment').undecided, true);

    const answers = applyAnswer(emptyAnswers(), draft.decisions[0], { pick: 'A' }, now);
    const one = derive(draft, answers);
    assert.equal(one.progress.decided, 1);
    assert.equal(one.marks.find((m) => m.state === 'LatePayment').undecided, false);
    const two = one.marks.find((m) => m.state === 'TwoOrders');
    assert.equal(two.undecided, true);
    assert.equal(two.decision, 'admin-into-held-day');
  });

  test('marks clear once the approval is current', () => {
    const draft = fixture();
    const s = derive(draft, applyApproval(answerAll(draft), draft, now));
    assert.equal(s.marks.some((m) => m.undecided), false);
  });
});

describe('colour modes', () => {
  const css = readFileSync(join(HERE, '../public/tokens.css'), 'utf8');
  const tokens = (block) => [...block.matchAll(/--[\w-]+:\s*[^;]+;/g)].map((m) => m[0]).sort();

  test('the system dark block and the toggle dark block set the same tokens', () => {
    const forced = css.slice(css.indexOf(':root[data-mode="dark"]'), css.indexOf('@media (prefers-color-scheme: dark)'));
    const system = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    assert.ok(tokens(forced).length > 15);
    assert.deepEqual(tokens(forced), tokens(system));
  });

  test('every colour token used by a chart mark has a dark value', () => {
    const dark = tokens(css.slice(css.indexOf(':root[data-mode="dark"]'))).join(' ');
    for (const name of ['breaks', 'breaks-soft', 'breaks-ink', 'maybreak', 'maybreak-soft', 'maybreak-ink', 'bugpath', 'accent', 'accent-soft', 'accent-soft-ink']) {
      assert.ok(dark.includes(`--color-${name}:`), name);
    }
  });

  test('all four chart marks override classDef colours in the stylesheet', () => {
    const style = readFileSync(join(HERE, '../public/style.css'), 'utf8');
    for (const mark of ['breaks', 'mayBreak', 'bugPath', 'undecided']) {
      assert.match(style, new RegExp(`\\.pele \\.${mark}[^{]* rect \\{[^}]*!important`), mark);
    }
  });
});

describe('invalid drafts', () => {
  test('bad JSON is reported, not thrown', () => {
    const r = parseDraft('{ nope');
    assert.equal(r.ok, false);
    assert.match(r.title, /not valid JSON/);
  });

  const broken = [
    ['missing title', (d) => delete d.title, /^title:/],
    ['chart is not a state diagram', (d) => { d.chart = 'flowchart LR\n A-->B'; }, /first line must be stateDiagram-v2/],
    ['bad tier', (d) => { d.decisions[0].tier = 'maybe'; }, /tier: must be decide or glance/],
    ['duplicate decision id', (d) => { d.decisions[1].id = d.decisions[0].id; }, /used twice/],
    ['glance with no proposal', (d) => { delete d.decisions[3].proposed; }, /glance items must name/],
    ['decide with a proposal', (d) => { d.decisions[0].proposed = 'A'; }, /only glance items/],
    ['row width', (d) => { d.rules[0].rows[0].cells.pop(); }, /has 2 cells for 3 columns/],
    ['cell points nowhere', (d) => { d.rules[0].rows[1].cells[2].decision = 'ghost'; }, /no decision with id "ghost"/],
    ['bad cite', (d) => { d.rules[0].rows[0].cite = 'somewhere'; }, /must look like file:line/],
    ['state not on chart', (d) => { d.decisions[0].states = ['Nowhere']; }, /chart has no state "Nowhere"/],
    ['journey rule points nowhere', (d) => { d.journeys[0].holds[0].rule = 'Ghost'; }, /no rule with id "Ghost"/],
    ['low stakes missing', (d) => { delete d.lowStakes; }, /^lowStakes:/],
    ['context missing', (d) => { delete d.context; }, /^context: must be an object/],
    ['context with no today', (d) => { d.context.today = ''; }, /^context\.today:/],
    ['context scope is not a list', (d) => { d.context.outOfScope = 'none'; }, /^context\.outOfScope:/],
    ['journey with no bad case', (d) => { for (const s of d.journeys[0].steps) s.failures = []; }, /journeys\[0\]\.steps: needs at least one bad case/],
  ];
  for (const [name, breakIt, expected] of broken) {
    test(name, () => {
      const d = fixture();
      breakIt(d);
      const errors = validateDraft(d);
      assert.ok(errors.some((e) => expected.test(e)), errors.join('\n') || 'no errors');
    });
  }

  test('non-object drafts do not throw', () => {
    for (const v of [null, 1, 'x', []]) assert.ok(validateDraft(v).length > 0);
  });

  test('chart state ids come from the real parser, composite states included', () => {
    const ids = chartStates('stateDiagram-v2\n  [*] --> A\n  state B {\n    C --> D\n  }\n  A --> B');
    assert.deepEqual([...ids.keys()].sort(), ['A', 'B', 'C', 'D']);
    assert.equal(chartStates('stateDiagram-v2\n  A --> --> B'), null);
  });
});

describe('escaping', () => {
  test('the tag escapes values and keeps nested markup', () => {
    assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    assert.equal(html`<p>${'<b>'}</p>${html`<i>${'&'}</i>`}`.toString(), '<p>&lt;b&gt;</p><i>&amp;</i>');
  });

  test('hostile text in every field never reaches the page raw', () => {
    const X = `<img src=x onerror=alert(1)>"'`;
    const d = fixture();
    d.title = X;
    d.milestone = X;
    d.context = { summary: X, today: X, changes: X, outOfScope: [X] };
    d.chart += `\n  %% ${X}`;
    for (const r of d.rules) {
      r.statement = X;
      r.columns = r.columns.map(() => X);
      for (const row of r.rows) {
        row.door = X;
        row.cells = row.cells.map((c) => (typeof c === 'string' ? X : c));
      }
    }
    for (const j of d.journeys) {
      Object.assign(j, { name: X, who: X, startsFrom: X, wants: X });
      for (const s of j.steps) {
        s.name = X;
        s.lines = [X];
        s.failures = [{ when: X, then: X }];
      }
      for (const h of j.holds) h.text = X;
    }
    for (const x of d.decisions) {
      Object.assign(x, { title: X, story: X });
      for (const o of x.options) o.text = X;
    }
    d.lowStakes = [X];
    assert.deepEqual(validateDraft(d), []);

    const answers = applyAnswer(emptyAnswers(), d.decisions[0], { pick: 'A', note: `</textarea>${X}` }, now);
    const out = renderPage(derive(d, answers, {
      problem: { title: X, details: [X] },
      answersProblem: X,
    })).toString();

    assert.equal(out.includes('<img'), false);
    assert.equal(out.includes('</textarea>&lt;') || out.includes('</textarea><img'), false);
    assert.ok(out.includes('&lt;/textarea&gt;&lt;img'));
    assert.equal(/<[a-z]+[^>]*\sonerror=/i.test(out.replace(/"[^"]*"/g, '""')), false);
    assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;'));
  });
});

describe('Host and Origin', () => {
  const check = (method, host, origin) => requestProblem({ method, host, origin }, 4848);

  test('accepts the local server', () => {
    assert.equal(check('POST', '127.0.0.1:4848', 'http://127.0.0.1:4848'), null);
    assert.equal(check('POST', 'localhost:4848', 'http://localhost:4848'), null);
    assert.equal(check('POST', '127.0.0.1:4848', undefined), null);
  });

  test('refuses other hosts and origins', () => {
    assert.match(check('POST', 'evil.example', undefined), /Host/);
    assert.match(check('POST', '127.0.0.1:9999', undefined), /Host/);
    assert.match(check('POST', undefined, undefined), /Host/);
    assert.match(check('POST', '127.0.0.1:4848', 'http://evil.example'), /Origin/);
    assert.match(check('POST', '127.0.0.1:4848', 'null'), /Origin/);
    assert.match(check('POST', '127.0.0.1:4848', 'http://127.0.0.1:9999'), /Origin/);
    assert.match(check('GET', 'evil.example', undefined), /Host/);
  });
});

describe('atomic write', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'viewer-atomic-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('replaces the file and leaves no temp file', () => {
    const file = join(dir, 'answers.json');
    writeFileSync(file, 'old');
    writeAtomic(file, 'new');
    assert.equal(readFileSync(file, 'utf8'), 'new');
    assert.deepEqual(readdirSync(dir), ['answers.json']);
  });

  test('a failed rename keeps the old file and cleans up', () => {
    const file = join(dir, 'answers.json');
    mkdirSync(file);
    assert.throws(() => writeAtomic(file, 'new'));
    assert.ok(statSync(file).isDirectory());
    assert.deepEqual(readdirSync(dir), ['answers.json']);
  });

  test('a reader running alongside a writer process only ever sees whole files', async () => {
    const file = join(dir, 'answers.json');
    const size = 3_000_000;
    writeAtomic(file, 'a'.repeat(size));
    const lib = new URL('../lib/answers.mjs', import.meta.url).href;
    const writer = spawn(process.execPath, ['--input-type=module', '-e', `
      import { writeAtomic } from ${JSON.stringify(lib)};
      for (let i = 0; i < 60; i++) writeAtomic(${JSON.stringify(file)}, (i % 2 ? 'b' : 'c').repeat(${size}));
    `], { stdio: 'ignore' });
    const finished = new Promise((resolve) => writer.once('exit', resolve));
    let running = true;
    finished.then(() => { running = false; });
    let reads = 0;
    const contents = new Set();
    while (running) {
      const text = await readFile(file, 'utf8');
      assert.equal(text.length, size);
      assert.equal(text.at(-1), text[0]);
      contents.add(text[0]);
      reads++;
    }
    assert.equal(await finished, 0);
    assert.ok(reads > 5 && contents.size > 1, `saw ${contents.size} versions in ${reads} reads`);
    assert.deepEqual(readdirSync(dir), ['answers.json']);
  });
});

describe('server', () => {
  let dir;
  let server;

  const request = (path, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.port, path, method, headers }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });

  const post = async (path, value, headers = {}) => {
    const res = await request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: server.url.slice(0, -1), ...headers },
      body: JSON.stringify(value),
    });
    return { status: res.status, json: JSON.parse(res.text) };
  };
  const state = async () => JSON.parse((await request('/api/state')).text);
  const answersFile = () => join(dir, 'answers.json');
  const pick = async (id, key) => {
    const s = await state();
    return post('/api/answer', { id, pick: key, decisionSha256: s.decisions.find((d) => d.id === id).sha256 });
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'viewer-server-'));
    copyFileSync(FIXTURE, join(dir, 'draft.json'));
    server = await startServer({ dir, port: 0 });
  });
  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('binds to 127.0.0.1 and serves the page with Pele and a CSP', async () => {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.text, /Noon Box team lunches/);
    assert.equal((await request('/mode.js')).status, 200);
    const pele = await request('/vendor/pele.js');
    assert.equal(pele.status, 200);
    assert.ok(pele.text.length > 100000);
  });

  test('does not serve files outside its list', async () => {
    for (const p of ['/draft.json', '/serve.mjs', '/../serve.mjs', '/public/app.js', '/constructor']) {
      assert.equal((await request(p)).status, 404, p);
    }
  });

  test('refuses a POST from another origin or host and writes nothing', async () => {
    const s = await state();
    const body = { id: s.decisions[0].id, pick: 'A', decisionSha256: s.decisions[0].sha256 };
    assert.equal((await post('/api/answer', body, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/api/answer', body, { Host: 'evil.example' })).status, 403);
    assert.equal(existsSync(answersFile()), false);
  });

  test('refuses a POST that is not JSON', async () => {
    const res = await request('/api/answer', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(res.status, 415);
  });

  test('saves a pick and a note into answers.json', async () => {
    assert.equal((await pick('amend-into-held-day', 'B')).status, 200);
    assert.equal((await post('/api/answer', { id: 'amend-into-held-day', note: 'Tell Ann.' })).status, 200);
    const saved = JSON.parse(readFileSync(answersFile(), 'utf8'));
    assert.equal(saved.decisions['amend-into-held-day'].pick, 'B');
    assert.equal(saved.decisions['amend-into-held-day'].note, 'Tell Ann.');
    assert.equal(saved.approval, null);
    assert.deepEqual(readdirSync(dir).sort(), ['answers.json', 'draft.json']);
  });

  test('refuses an unknown decision and an unknown option', async () => {
    assert.equal((await post('/api/answer', { id: 'ghost', pick: 'A' })).status, 404);
    const s = await state();
    const d = s.decisions[0];
    assert.equal((await post('/api/answer', { id: d.id, pick: 'Z', decisionSha256: d.sha256 })).status, 400);
  });

  test('refuses a pick made against text the human did not see', async () => {
    const s = await state();
    const d = s.decisions[0];
    const draft = fixture();
    draft.decisions[0].story = 'A different story.';
    writeFileSync(join(dir, 'draft.json'), JSON.stringify(draft));
    assert.equal((await post('/api/answer', { id: d.id, pick: 'A', decisionSha256: d.sha256 })).status, 409);
    assert.equal(existsSync(answersFile()), false);
  });

  test('refuses approval with an open decide item', async () => {
    await pick('late-payment-after-rival', 'A');
    await pick('amend-into-held-day', 'A');
    const s = await state();
    assert.equal(s.canApprove, false);
    const res = await post('/api/approve', { draftSha256: s.hash });
    assert.equal(res.status, 409);
    assert.match(res.json.error, /1 decision left/);
    assert.equal(JSON.parse(readFileSync(answersFile(), 'utf8')).approval, null);
  });

  test('approves once every decide item is answered, glance items may stay open', async () => {
    for (const id of ['late-payment-after-rival', 'amend-into-held-day', 'admin-into-held-day']) await pick(id, 'A');
    const s = await state();
    assert.equal(s.canApprove, true);
    const res = await post('/api/approve', { draftSha256: s.hash });
    assert.equal(res.status, 200);
    assert.equal(res.json.approval.status, 'current');
    const saved = JSON.parse(readFileSync(answersFile(), 'utf8'));
    assert.equal(saved.approval.draftSha256, s.hash);
    assert.ok(!Number.isNaN(Date.parse(saved.approval.at)));
  });

  test('calls onApprove after the approval is sent, and not for a pick', async () => {
    await server.close();
    const calls = [];
    server = await startServer({ dir, port: 0, onApprove: (info) => calls.push(info) });
    for (const id of ['late-payment-after-rival', 'amend-into-held-day', 'admin-into-held-day']) await pick(id, 'A');
    assert.equal(calls.length, 0);
    const res = await post('/api/approve', { draftSha256: (await state()).hash });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [{ answersFile: answersFile() }]);
  });

  test('does not call onApprove when approval is refused', async () => {
    await server.close();
    const calls = [];
    server = await startServer({ dir, port: 0, onApprove: (info) => calls.push(info) });
    const res = await post('/api/approve', { draftSha256: (await state()).hash });
    assert.equal(res.status, 409);
    assert.equal(calls.length, 0);
  });

  test('refuses approval of a draft other than the one on screen', async () => {
    for (const id of ['late-payment-after-rival', 'amend-into-held-day', 'admin-into-held-day']) await pick(id, 'A');
    const s = await state();
    const draft = fixture();
    draft.title = 'Changed underneath';
    writeFileSync(join(dir, 'draft.json'), JSON.stringify(draft));
    assert.equal((await post('/api/approve', { draftSha256: s.hash })).status, 409);
  });

  test('an invalid draft shows an error and keeps the last good render', async () => {
    writeFileSync(join(dir, 'draft.json'), '{ broken');
    const s = await state();
    assert.equal(s.live, false);
    assert.match(s.problem.title, /not valid JSON/);
    assert.equal(s.draft.title, 'Noon Box team lunches');
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(page.text, /not valid JSON/);
    assert.match(page.text, /Noon Box team lunches/);
    const d = s.decisions[0];
    assert.equal((await post('/api/answer', { id: d.id, pick: 'A', decisionSha256: d.sha256 })).status, 409);
    assert.equal(existsSync(answersFile()), false);
  });

  test('a missing draft shows a clear error, with no last good to fall back on', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'viewer-empty-'));
    const other = await startServer({ dir: empty, port: 0 });
    try {
      const res = await fetch(`${other.url}api/state`);
      const s = await res.json();
      assert.equal(s.draft, null);
      assert.match(s.problem.title, /missing/);
      const page = await (await fetch(other.url)).text();
      assert.match(page, /draft\.json is missing/);
    } finally {
      await other.close();
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('a corrupt answers file is reported and never overwritten', async () => {
    writeFileSync(answersFile(), 'not json');
    const s = await state();
    assert.match(s.answersProblem, /not valid JSON/);
    assert.equal(s.canApprove, false);
    const d = s.decisions[0];
    assert.equal((await post('/api/answer', { id: d.id, pick: 'A', decisionSha256: d.sha256 })).status, 409);
    assert.equal(readFileSync(answersFile(), 'utf8'), 'not json');
  });

  test('sends a server event when the draft is replaced by rename', async () => {
    const res = await fetch(`${server.url}api/events`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    await reader.read();
    const draft = fixture();
    draft.title = 'Renamed in';
    const tmp = join(dir, 'tmp-draft');
    writeFileSync(tmp, JSON.stringify(draft));
    const { renameSync } = await import('node:fs');
    renameSync(tmp, join(dir, 'draft.json'));
    let text = '';
    while (!text.includes('event: change')) text += decoder.decode((await reader.read()).value);
    await reader.cancel();
    assert.equal((await state()).draft.title, 'Renamed in');
  });
});

test('parseAnswers rejects a file with no decisions', () => {
  assert.equal(parseAnswers('{}').ok, false);
  assert.equal(parseAnswers('null').ok, false);
  assert.equal(parseAnswers('{"decisions":{}}').ok, true);
});

test('decision hash covers the words, not the chart states', () => {
  const d = fixture().decisions[0];
  assert.equal(decisionHash({ ...d, states: [] }), decisionHash(d));
  assert.notEqual(decisionHash({ ...d, title: 'Other' }), decisionHash(d));
});

describe('names on the page', () => {
  // The source block is the fallback under the chart, replaced as soon as the chart draws.
  const visible = (page) => page.toString().replace(/<pre class="source">[\s\S]*?<\/pre>/g, '').replace(/<[^>]*>/g, ' ');

  test('labels come from the chart, however the state was declared', () => {
    const states = chartStates('stateDiagram-v2\n  state "Quoted label" as Q\n  C: Colon label\n  Q --> C\n  C --> Bare');
    assert.deepEqual(Object.fromEntries(states), { Q: 'Quoted label', C: 'Colon label', Bare: '' });
  });

  test('the context comes before the flow chart', () => {
    const d = fixture();
    const out = renderPage(derive(d)).toString();
    assert.ok(out.indexOf('id="context"') < out.indexOf('id="flow"'));
    const page = visible(out);
    for (const text of [d.context.summary, d.context.today, d.context.changes, ...d.context.outOfScope]) assert.ok(page.includes(text), text);
  });

  test('a bad case stays on the page when its step is folded', () => {
    const d = fixture();
    d.journeys[0].steps[0].failures = [{ when: 'the card is declined', then: 'the hold stays.' }];
    const out = renderPage(derive(d)).toString();
    const fold = out.slice(out.indexOf('id="step-0-0"'), out.indexOf('</details>', out.indexOf('id="step-0-0"')));
    assert.ok(!fold.includes('the card is declined'));
    assert.ok(out.includes('the card is declined'));
  });

  test('a journey diagram has every step and every bad case, and parses', () => {
    for (const j of fixture().journeys) {
      const states = chartStates(journeyChart(j));
      assert.ok(states, 'Pele can parse it');
      const labels = [...states.values()].join('|');
      for (const s of j.steps) {
        assert.ok(labels.includes(s.name), s.name);
        for (const f of s.failures) assert.ok(journeyChart(j).includes(`: ${f.when.replace(/[:#;"]/g, ' ')}`), f.when);
      }
    }
  });

  test('characters Mermaid would choke on stay out of a journey diagram', () => {
    const j = fixture().journeys[0];
    j.steps[0].name = 'Pay: "now"; #1';
    j.steps[0].failures = [{ when: 'it: fails\nagain', then: 'say "no"; #2' }];
    assert.ok(chartStates(journeyChart(j)));
  });

  test('a decision shows chart labels, not state ids', () => {
    const page = visible(renderPage(derive(fixture())));
    assert.match(page, /In the chart:\s+Late payment waiting, Two orders on one day/);
    assert.doesNotMatch(page, /Chart states/);
  });

  test('the outline lists every decision, rule, and journey, and a decision links to its rules', () => {
    const d = fixture();
    const out = renderPage(derive(d)).toString();
    const nav = out.slice(out.indexOf('<nav class="outline"'), out.indexOf('</nav>'));
    for (const x of d.decisions) assert.ok(nav.includes(`href="#decision-${x.id}"`), x.id);
    for (const r of d.rules) assert.ok(nav.includes(`href="#rule-${r.id}"`), r.id);
    d.journeys.forEach((j, i) => assert.ok(out.includes(`id="journey-${i}"`) && nav.includes(`href="#journey-${i}"`), j.name));
    const decision = out.slice(out.indexOf('id="decision-late-payment-after-rival"'));
    assert.match(decision.slice(0, decision.indexOf('</article>')), /In the rules: <a href="#rule-OneOrderPerDay">/);
  });

  test('Next open points at the first decide item still open, and leaves once all are answered', () => {
    const d = fixture();
    const first = derive(d).decisions.find((x) => x.tier === 'decide');
    assert.match(renderPage(derive(d)).toString(), new RegExp(`id="next-open" href="#decision-${first.id}"`));
    assert.doesNotMatch(renderPage(derive(d, answerAll(d))).toString(), /id="next-open"/);
  });

  test('a state with no label is left off the line', () => {
    const d = fixture();
    d.chart += '\n  HeldConfirmed --> Bare';
    d.decisions[0].states = ['Bare'];
    const page = visible(renderPage(derive(d)));
    assert.doesNotMatch(page, /\bBare\b/);
  });

  test('decision, state, and rule ids stay out of visible text but remain anchors', () => {
    const d = fixture();
    const answers = applyAnswer(answerAll(d), { id: 'gone-decision', options: [] }, { note: 'old' }, now);
    const out = renderPage(derive(d, answers)).toString();
    const page = visible(out);
    const stateIds = [...chartStates(d.chart).keys()].filter((id) => /[A-Z]/.test(id.slice(1)));
    for (const id of [...d.decisions.map((x) => x.id), ...d.rules.map((r) => r.id), ...stateIds, 'gone-decision']) {
      assert.ok(!page.includes(id), `${id} is visible`);
    }
    assert.match(out, /id="decision-late-payment-after-rival"/);
    assert.match(out, /id="rule-OneOrderPerDay"/);
    assert.match(out, /href="#rule-OneOrderPerDay"/);
  });
});

describe('place notes', () => {
  const STATE = 'state:LatePayment';
  const ROW = 'row:OneOrderPerDay:Admin edit';

  test('lists every chart state and door, with readable labels', () => {
    const d = fixture();
    const places = placeList(d);
    assert.equal(places.find((p) => p.target === STATE).label, 'Late payment waiting');
    assert.equal(places.find((p) => p.target === ROW).label, 'Admin edit');
    assert.equal(places.filter((p) => p.state).length, [...chartStates(d.chart).values()].filter(Boolean).length);
    assert.equal(places.filter((p) => p.rule).length, d.rules.flatMap((r) => r.rows).length);
    assert.equal(new Set(places.map((p) => p.target)).size, places.length);
  });

  test('a repeated door gets its own target', () => {
    const d = fixture();
    d.rules[0].rows[1].door = d.rules[0].rows[0].door;
    const doors = placeList(d).filter((p) => p.rule === d.rules[0].id).map((p) => p.target);
    assert.equal(new Set(doors).size, doors.length);
    assert.ok(doors[1].endsWith('#2'));
  });

  test('a note follows its door when the rows move', () => {
    const d = fixture();
    const answers = applyPlaceNote(emptyAnswers(), ROW, 'Warn admins.', now);
    d.rules[0].rows.reverse();
    const place = placeList(d, answers.notes).find((p) => p.note);
    assert.equal(place.label, 'Admin edit');
    assert.equal(place.row, 0);
  });

  test('a hostile target cannot reach the object prototype', () => {
    assert.equal(placeList(fixture(), JSON.parse('{"__proto__":{"note":"x"}}')).some((p) => p.note), false);
  });

  test('an answers file from before notes keeps its hash and its approval', () => {
    const d = fixture();
    const approved = applyApproval(answerAll(d), d, now);
    const { notes, ...old } = approved;
    assert.equal(answersHash(old), answersHash(approved));
    const parsed = parseAnswers(JSON.stringify(old));
    assert.deepEqual(parsed.answers.notes, {});
    assert.equal(derive(d, parsed.answers).approval.status, 'current');
  });

  test('a note added after approval makes the approval stale, and clearing it restores it', () => {
    const d = fixture();
    const approved = applyApproval(answerAll(d), d, now);
    const noted = applyPlaceNote(approved, STATE, 'Wait a day?', now);
    assert.equal(derive(d, noted).approval.status, 'stale');
    assert.deepEqual(derive(d, noted).approval.reasons, ['answers']);
    assert.equal(derive(d, applyPlaceNote(noted, STATE, '  ', now)).approval.status, 'current');
  });

  test('notes never block approval', () => {
    const d = fixture();
    assert.equal(derive(d, applyPlaceNote(answerAll(d), STATE, 'x', now)).canApprove, true);
  });

  test('a note on a place no longer in the draft is counted, not lost', () => {
    const d = fixture();
    const out = derive(d, applyPlaceNote(emptyAnswers(), 'state:Gone', 'old', now));
    assert.deepEqual(out.orphanNotes, ['state:Gone']);
    assert.match(renderPage(out).toString(), /1 note on places the draft no longer has/);
  });

  test('parseAnswers refuses notes that are not an object', () => {
    assert.equal(parseAnswers('{"decisions":{},"notes":[]}').ok, false);
  });

  test('the page shows the saved text, opens its fold, and escapes it', () => {
    const d = fixture();
    const out = renderPage(derive(d, applyPlaceNote(emptyAnswers(), ROW, '</textarea><img src=x>', now))).toString();
    assert.match(out, /<details class="place-notes" id="door-notes-OneOrderPerDay" open>/);
    assert.match(out, /<details class="place-notes" id="state-notes" >/);
    assert.match(out, /Your note/);
    assert.equal(out.includes('<img'), false);
  });

  test('state ids stay out of visible text', () => {
    const d = fixture();
    const page = renderPage(derive(d)).toString().replace(/<pre class="source">[\s\S]*?<\/pre>/g, '').replace(/<[^>]+>/g, ' ');
    assert.equal(page.includes('LatePayment'), false);
    assert.match(page, /Late payment waiting/);
  });

  describe('over HTTP', () => {
    let dir;
    let server;
    const send = async (path, body) => {
      const res = await fetch(new URL(path, server.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, json: await res.json() };
    };
    const saved = () => JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8'));

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), 'viewer-notes-'));
      copyFileSync(FIXTURE, join(dir, 'draft.json'));
      server = await startServer({ dir, port: 0 });
    });
    afterEach(async () => {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    });

    test('saves, replaces, and removes a note', async () => {
      assert.equal((await send('/api/note', { target: STATE, note: 'one' })).status, 200);
      assert.equal((await send('/api/note', { target: STATE, note: 'two' })).status, 200);
      assert.equal(saved().notes[STATE].note, 'two');
      const res = await send('/api/note', { target: STATE, note: '' });
      assert.equal(res.status, 200);
      assert.deepEqual(saved().notes, {});
      assert.equal(res.json.places.find((p) => p.target === STATE).note, '');
    });

    test('refuses an unknown place, a bad note, and writes nothing', async () => {
      assert.equal((await send('/api/note', { target: 'state:Ghost', note: 'x' })).status, 404);
      assert.equal((await send('/api/note', { target: '__proto__', note: 'x' })).status, 404);
      assert.equal((await send('/api/note', { target: STATE, note: 7 })).status, 400);
      assert.equal((await send('/api/note', { target: STATE, note: 'x'.repeat(5001) })).status, 400);
      assert.equal(existsSync(join(dir, 'answers.json')), false);
    });

    test('a pick and a note on a place live side by side', async () => {
      await send('/api/note', { target: ROW, note: 'Warn admins.' });
      const state = await (await fetch(new URL('/api/state', server.url))).json();
      const d = state.decisions[0];
      await send('/api/answer', { id: d.id, pick: 'A', decisionSha256: d.sha256 });
      assert.equal(saved().notes[ROW].note, 'Warn admins.');
      assert.equal(saved().decisions[d.id].pick, 'A');
    });

    test('an approval that carries a note passes check-approval', async () => {
      await send('/api/note', { target: STATE, note: 'Wait a day?' });
      for (const d of fixture().decisions.filter((x) => x.tier === 'decide')) {
        const s = await (await fetch(new URL('/api/state', server.url))).json();
        await send('/api/answer', { id: d.id, pick: 'A', decisionSha256: s.decisions.find((x) => x.id === d.id).sha256 });
      }
      const s = await (await fetch(new URL('/api/state', server.url))).json();
      assert.equal((await send('/api/approve', { draftSha256: s.hash })).status, 200);
      assert.equal(checkApproval(dir).ok, true);
      writeFileSync(join(dir, 'answers.json'), JSON.stringify({ ...saved(), notes: { [STATE]: { note: 'Changed.' } } }));
      assert.equal(checkApproval(dir).ok, false);
    });
  });
});

describe('--open', () => {
  const SERVE = join(HERE, '../scripts/serve.mjs');
  let dir;
  let bin;
  let child;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'viewer-open-'));
    bin = mkdtempSync(join(tmpdir(), 'viewer-open-bin-'));
    copyFileSync(FIXTURE, join(dir, 'draft.json'));
  });
  afterEach(() => {
    child?.kill();
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  // Stands in for the system's opener, so the suite never opens a real browser.
  const opener = (body) => {
    for (const name of ['open', 'xdg-open']) {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    }
  };

  const run = (args, until) =>
    new Promise((resolve, reject) => {
      let out = '';
      child = spawn(process.execPath, [SERVE, dir, '--port', '0', ...args], { env: { ...process.env, PATH: bin } });
      const timer = setTimeout(() => reject(new Error(`timed out with: ${out}`)), 5000);
      child.stdout.on('data', (chunk) => {
        out += chunk;
        if (!until(out)) return;
        clearTimeout(timer);
        resolve(out);
      });
    });

  test('hands the page URL to the system opener', async () => {
    const seen = join(dir, 'opened');
    opener(`echo "$1" > "${seen}.tmp" && /bin/mv "${seen}.tmp" "${seen}"`);
    const out = await run(['--open'], (text) => text.includes('Reading'));
    for (let i = 0; i < 100 && !existsSync(seen); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(readFileSync(seen, 'utf8').trim(), out.match(/at (\S+)/)[1]);
  });

  test('without the flag nothing opens', async () => {
    const seen = join(dir, 'opened');
    opener(`touch "${seen}"`);
    await run([], (text) => text.includes('Reading'));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(existsSync(seen), false);
  });

  test('a failed opener says so and the server keeps serving', async () => {
    opener('exit 3');
    const out = await run(['--open'], (text) => text.includes('Could not open'));
    const url = out.match(/at (\S+)/)[1];
    assert.match(out, /Open http:\S+ by hand/);
    assert.equal((await fetch(url)).status, 200);
  });

  test('a missing opener says so and the server keeps serving', async () => {
    const out = await run(['--open'], (text) => text.includes('Could not open'));
    assert.equal((await fetch(out.match(/at (\S+)/)[1])).status, 200);
  });
});

describe('note collapsing', () => {
  const fold = (page, id) => page.match(new RegExp(`<details class="note-fold" id="note-fold-${id}"[^>]*>[\\s\\S]*?</details>`))[0];

  test('a decision with no note starts closed behind Add note', () => {
    const d = fixture();
    const id = d.decisions[0].id;
    const out = fold(renderPage(derive(d)).toString(), id);
    assert.doesNotMatch(out.split('>')[0], /\bopen\b/);
    assert.match(out, />Add note</);
    assert.match(out, /<textarea id="note-[^"]+"[^>]*data-note=/);
  });

  test('a saved note opens by itself and shows its text', () => {
    const d = fixture();
    const target = d.decisions[0];
    const answers = applyAnswer(emptyAnswers(), target, { note: 'Tell <Ann> today' }, now);
    const out = fold(renderPage(derive(d, answers)).toString(), target.id);
    assert.match(out.split('>')[0], /\bopen\b/);
    assert.match(out, />Your note</);
    assert.match(out, /Tell &lt;Ann&gt; today<\/textarea>/);
  });

  test('a pick with an empty note stays closed', () => {
    const d = fixture();
    const target = d.decisions[0];
    const answers = applyAnswer(emptyAnswers(), target, { pick: target.options[0].key }, now);
    assert.doesNotMatch(fold(renderPage(derive(d, answers)).toString(), target.id).split('>')[0], /\bopen\b/);
  });
});

describe('running from the skill folder', () => {
  const skill = join(HERE, '..');

  test('refuses a draft folder inside the skill, with a clear message', async () => {
    for (const dir of [skill, join(skill, 'fixture')]) {
      assert.match(draftDirProblem(dir), /inside the expectations-viewer skill/);
      await assert.rejects(startServer({ dir, port: 0 }), /put draft\.json in a folder outside the skill/);
    }
    assert.equal(existsSync(join(skill, 'fixture/answers.json')), false);
  });

  test('sees through a symlink into the skill, and allows a folder that only shares a prefix', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'viewer-link-'));
    const near = `${skill.replace(/\/$/, '')}-sibling-${process.pid}`;
    mkdirSync(near);
    try {
      symlinkSync(join(skill, 'fixture'), join(scratch, 'link'));
      assert.match(draftDirProblem(join(scratch, 'link')), /inside the expectations-viewer skill/);
      assert.equal(draftDirProblem(scratch), null);
      assert.equal(draftDirProblem(near), null);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      rmSync(near, { recursive: true, force: true });
    }
  });

  test('the command line refuses it too and exits with an error', async () => {
    const child = spawn(process.execPath, [join(skill, 'scripts/serve.mjs'), join(skill, 'fixture'), '--port', '0']);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    const code = await new Promise((done) => child.on('exit', done));
    assert.equal(code, 1);
    assert.match(stderr, /inside the expectations-viewer skill/);
  });

  test('needs no install: no dependencies, and Pele sits in the skill with its licence', () => {
    const pkg = JSON.parse(readFileSync(join(skill, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.vendored.pele.version, '1.12.0');
    assert.ok(statSync(join(skill, 'vendor/pele/pele.js')).size > 100000);
    assert.match(readFileSync(join(skill, 'vendor/pele/LICENSE'), 'utf8'), /^MIT License/);
    for (const folder of ['lib', 'public', 'scripts']) {
      for (const file of readdirSync(join(skill, folder))) {
        const bare = readFileSync(join(skill, folder, file), 'utf8').match(/from '(?!node:|\.)[^']+'/);
        assert.equal(bare, null, `${folder}/${file}`);
      }
    }
  });
});

describe('check-approval', () => {
  test('passes only when the approval matches the current draft', () => {
    const dir = mkdtempSync(join(tmpdir(), 'viewer-approval-'));
    try {
      const draft = fixture();
      writeFileSync(join(dir, 'draft.json'), JSON.stringify(draft));
      assert.equal(checkApproval(dir).ok, false);
      const approved = applyApproval(emptyAnswers(), draft, now);
      writeFileSync(join(dir, 'answers.json'), JSON.stringify(approved));
      assert.equal(checkApproval(dir).ok, true);
      writeFileSync(join(dir, 'draft.json'), JSON.stringify({ ...draft, title: `${draft.title} changed` }));
      assert.match(checkApproval(dir).message, /older draft/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('finds brief lines the approved draft never showed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-brief-'));
    try {
      const draft = fixture();
      writeFileSync(join(dir, 'draft.json'), JSON.stringify(draft));
      const shown = draft.journeys[0].steps[0].lines[0];
      const brief = join(dir, 'brief.md');
      writeFileSync(
        brief,
        [
          '# Brief: Lunch',
          '## Glossary',
          '- Hold: A day kept for one order.',
          '## New',
          '### orders (ORD)',
          `- ${shown}`,
          '## Changes',
          `- Replace ORD-3: ${shown}`,
          '- WHEN an order is cancelled, THE SYSTEM SHALL free its day.',
          '## Not expectations',
          '- Every path: ORD-3',
        ].join('\n'),
      );
      assert.deepEqual(briefLines(readFileSync(brief, 'utf8')), ['Hold: A day kept for one order.', shown, 'WHEN an order is cancelled, THE SYSTEM SHALL free its day.']);
      assert.deepEqual(unseenLines(dir, brief), ['Hold: A day kept for one order.', 'WHEN an order is cancelled, THE SYSTEM SHALL free its day.']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
