#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, realpathSync, statSync, watch } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDraft } from '../lib/draft.mjs';
import { applyAnswer, applyApproval, applyPlaceNote, deriveState, emptyAnswers, parseAnswers, placeList, serializeAnswers, writeAtomic } from '../lib/answers.mjs';
import { renderPage, esc } from '../public/view.mjs';

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 64 * 1024;
const MAX_NOTE = 5000;
const HOST = '127.0.0.1';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const STATIC = {
  '/app.js': ['public/app.js', 'text/javascript'],
  '/mode.js': ['public/mode.js', 'text/javascript'],
  '/view.mjs': ['public/view.mjs', 'text/javascript'],
  '/style.css': ['public/style.css', 'text/css'],
  '/tokens.css': ['public/tokens.css', 'text/css'],
  '/base.css': ['public/base.css', 'text/css'],
  '/vendor/pele.js': ['vendor/pele/pele.js', 'text/javascript'],
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requestProblem({ method, host, origin }, port) {
  const hosts = [`${HOST}:${port}`, `localhost:${port}`];
  if (!hosts.includes(host)) return `Host ${host ?? '(none)'} is not this server`;
  if (method === 'GET' || method === 'HEAD') return null;
  if (origin !== undefined && !hosts.map((h) => `http://${h}`).includes(origin)) return `Origin ${origin} is not this server`;
  return null;
}

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// An installed skill is shared and may be replaced, so answers must never land in it.
// Real paths, because a linked install or a symlinked folder can hide where a path leads.
export function draftDirProblem(dir) {
  const root = realpathSync(SKILL_ROOT);
  const path = relative(root, realpathSync(dir));
  const outside = path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
  if (outside) return null;
  return `${dir} is inside the expectations-viewer skill at ${root}. The viewer writes answers.json beside the draft, so put draft.json in a folder outside the skill.`;
}

export async function startServer({ dir, port = 0, onApprove }) {
  const refused = draftDirProblem(dir);
  if (refused) throw new Error(refused);

  const draftFile = join(dir, 'draft.json');
  const answersFile = join(dir, 'answers.json');
  let lastGood = null;
  const clients = new Set();

  const loadDraft = () => {
    const raw = read(draftFile);
    if (raw === null) return { ok: false, title: 'draft.json is missing', details: [`Expected it at ${draftFile}`] };
    const result = parseDraft(raw);
    if (result.ok) lastGood = result.draft;
    return result;
  };

  const loadAnswers = () => {
    const raw = read(answersFile);
    return raw === null ? { ok: true, answers: emptyAnswers() } : parseAnswers(raw);
  };

  const snapshot = () => {
    const d = loadDraft();
    const a = loadAnswers();
    return deriveState({
      draft: d.ok ? d.draft : lastGood,
      live: d.ok,
      problem: d.ok ? null : { title: d.title, details: d.details },
      answers: a.ok ? a.answers : emptyAnswers(),
      answersProblem: a.ok ? null : a.message,
      dir,
    });
  };

  const writable = () => {
    const d = loadDraft();
    if (!d.ok) throw new HttpError(409, `${d.title}. Nothing was saved.`);
    const a = loadAnswers();
    if (!a.ok) throw new HttpError(409, `${a.message}. Nothing was saved, so your existing answers stay as they are.`);
    return { draft: d.draft, hash: d.hash, answers: a.answers };
  };

  const save = (answers) => writeAtomic(answersFile, serializeAnswers(answers));

  const postAnswer = (body) => {
    const { draft, answers } = writable();
    const decision = draft.decisions.find((d) => d.id === body.id);
    if (!decision) throw new HttpError(404, `No decision "${body.id}" in the draft.`);
    const { pick, note, decisionSha256 } = body;
    if (pick === undefined && note === undefined) throw new HttpError(400, 'Send a pick or a note.');
    if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE)) throw new HttpError(400, `A note is text of at most ${MAX_NOTE} characters.`);
    if (pick !== undefined) {
      if (!decision.options.some((o) => o.key === pick)) throw new HttpError(400, `Option "${pick}" is not on this decision.`);
      if (decisionSha256 !== snapshot().decisions.find((d) => d.id === body.id).sha256) {
        throw new HttpError(409, 'This decision changed while you were reading it. Read it again, then pick.');
      }
    }
    save(applyAnswer(answers, decision, { pick, note }, new Date()));
  };

  const postNote = ({ target, note }) => {
    const { draft, answers } = writable();
    if (typeof note !== 'string' || note.length > MAX_NOTE) throw new HttpError(400, `A note is text of at most ${MAX_NOTE} characters.`);
    if (!placeList(draft).some((p) => p.target === target)) throw new HttpError(404, `No place "${target}" in the draft.`);
    save(applyPlaceNote(answers, target, note, new Date()));
  };

  const postApprove = (body) => {
    const { draft, hash, answers } = writable();
    if (body.draftSha256 !== hash) throw new HttpError(409, 'The draft changed while you were reading it. Read it again, then approve.');
    const state = snapshot();
    if (!state.canApprove) throw new HttpError(409, `Cannot approve yet. ${state.blockers.join(' ')}`);
    save(applyApproval(answers, draft, new Date()));
  };

  const broadcast = () => {
    for (const res of clients) res.write('event: change\ndata: {}\n\n');
  };

  const send = (res, status, type, body) => {
    res.writeHead(status, {
      'Content-Type': `${type}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': CSP,
    });
    res.end(body);
  };
  const sendJson = (res, status, value) => send(res, status, 'application/json', JSON.stringify(value));

  const readBody = async (req) => {
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Send application/json.');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
      chunks.push(chunk);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body && typeof body === 'object') return body;
    } catch {}
    throw new HttpError(400, 'Request body is not a JSON object.');
  };

  const sendPage = (res) => {
    const state = snapshot();
    const page = readFileSync(join(SKILL_ROOT, 'public/index.html'), 'utf8')
      .replace('<title>Expectations viewer</title>', () => `<title>${esc(state.draft?.title ?? 'Expectations viewer')}</title>`)
      .replace('<!--APP-->', () => renderPage(state).toString());
    send(res, 200, 'text/html', page);
  };

  const server = createServer(async (req, res) => {
    const problem = requestProblem({ method: req.method, host: req.headers.host, origin: req.headers.origin }, server.address().port);
    if (problem) return sendJson(res, 403, { error: problem });

    const path = new URL(req.url, `http://${HOST}`).pathname;
    try {
      if (req.method === 'POST') {
        const handlers = { '/api/answer': postAnswer, '/api/note': postNote, '/api/approve': postApprove };
        if (!Object.hasOwn(handlers, path)) return sendJson(res, 404, { error: 'Not found.' });
        handlers[path](await readBody(req));
        // Hand back only after the page has its answer, so it can show the approval first.
        if (path === '/api/approve' && onApprove) res.once('finish', () => onApprove({ answersFile }));
        return sendJson(res, 200, snapshot());
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
      if (path === '/') return sendPage(res);
      if (path === '/api/state') return sendJson(res, 200, snapshot());
      if (path === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 1000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (path === '/favicon.ico') return send(res, 204, 'text/plain');
      const file = Object.hasOwn(STATIC, path) ? STATIC[path] : null;
      if (file) return send(res, 200, file[1], readFileSync(join(SKILL_ROOT, file[0])));
      sendJson(res, 404, { error: 'Not found.' });
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      sendJson(res, 500, { error: `The viewer hit an error: ${e.message}` });
    }
  });

  // Watching the folder survives an agent replacing draft.json by rename.
  let timer;
  let seen = `${read(draftFile)}\0${read(answersFile)}`;
  const watcher = watch(dir, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const now = `${read(draftFile)}\0${read(answersFile)}`;
      if (now === seen) return;
      seen = now;
      loadDraft();
      broadcast();
    }, 60);
  });

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': keep alive\n\n');
  }, 20000);
  heartbeat.unref();

  loadDraft();

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      resolvePromise({
        port: server.address().port,
        url: `http://${HOST}:${server.address().port}/`,
        close() {
          clearTimeout(timer);
          clearInterval(heartbeat);
          watcher.close();
          server.closeAllConnections();
          return new Promise((done) => server.close(done));
        },
      });
    });
  });
}

// A session with no browser, such as one over SSH, still has the printed URL, so a failure only says so.
function openBrowser(url) {
  const [command, ...args] = {
    darwin: ['open', url],
    win32: ['cmd', '/c', 'start', '""', url],
  }[process.platform] ?? ['xdg-open', url];
  const failed = () => console.log(`Could not open a browser. Open ${url} by hand.`);
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.once('error', failed);
  child.once('exit', (code) => code && failed());
  child.unref();
}

function parseArgs(argv) {
  let dir;
  let port = 4848;
  let keepRunning = false;
  let open = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i]);
    else if (argv[i] === '--keep-running') keepRunning = true;
    else if (argv[i] === '--open') open = true;
    else if (!dir && !argv[i].startsWith('--')) dir = argv[i];
    else return null;
  }
  return dir && Number.isInteger(port) && port >= 0 && port < 65536 ? { dir: resolve(dir), port, keepRunning, open } : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: node scripts/serve.mjs <draft-dir> [--port N] [--keep-running] [--open]');
    process.exit(2);
  }
  if (!existsSync(args.dir) || !statSync(args.dir).isDirectory()) {
    console.error(`No such folder: ${args.dir}`);
    process.exit(2);
  }
  try {
    // Exiting on approval wakes an agent that started the server as a background process.
    let stop;
    const onApprove = args.keepRunning
      ? ({ answersFile }) => console.log(`Approved. Answers in ${answersFile}`)
      : ({ answersFile }) => {
          console.log(`Approved. Answers in ${answersFile}`);
          stop().then(() => process.exit(0));
        };
    const { url, close } = await startServer({ dir: args.dir, port: args.port, onApprove });
    stop = close;
    console.log(`Expectations viewer at ${url}\nReading ${join(args.dir, 'draft.json')}`);
    if (args.open) openBrowser(url);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => close().then(() => process.exit(0)));
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `Port ${args.port} is in use. Pick another with --port N.` : e.message);
    process.exit(1);
  }
}
